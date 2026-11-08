import './env.js';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import session from 'express-session';
import { createClient } from 'redis';
import RedisStore from 'connect-redis';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authMiddleware, authRouter, passport } from './auth.js';
import LobbyManager from './lobbyManager.js';
import { isAllowedRequestOrigin } from './utils/origins.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.join(__dirname, '..', 'client');

const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const REDIS_CONNECT_TIMEOUT_MS = positiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 1500);
const REDIS_CONNECT_MAX_RETRIES = positiveInt(process.env.REDIS_CONNECT_MAX_RETRIES, 1);
const SESSION_RELOAD_TIMEOUT_MS = positiveInt(process.env.SESSION_RELOAD_TIMEOUT_MS, 5000);

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveTrustProxy() {
  const raw = typeof process.env.TRUST_PROXY === 'string' ? process.env.TRUST_PROXY.trim() : '';
  if (!raw) return 0;

  const value = raw.toLowerCase();
  if (['loopback', 'linklocal', 'uniquelocal'].includes(value)) return value;
  if (['0', 'false', 'no', 'off'].includes(value)) return 0;
  if (['1', 'true', 'yes', 'on'].includes(value)) return 1;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  console.warn(`[Server] Ignoring invalid TRUST_PROXY value: ${raw}`);
  return 0;
}

function requestAddress(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req?.headers?.['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof raw === 'string' && raw.trim()) {
      return raw.split(',')[0].trim().replace(/^::ffff:/, '');
    }
  }
  return String(req?.socket?.remoteAddress || req?.ip || 'unknown').replace(/^::ffff:/, '');
}

function sessionSecret(explicit, isProduction) {
  const configured = explicit || (typeof process.env.SESSION_SECRET === 'string' ? process.env.SESSION_SECRET.trim() : '');
  if (configured) return configured;

  if (isProduction) {
    throw new Error('SESSION_SECRET is required in production');
  }

  const generated = crypto.randomBytes(48).toString('base64url');
  console.warn('[Server] SESSION_SECRET is not set; using a random per-process secret (sessions end on restart)');
  return generated;
}

async function connectRedisSessionStore({ isProduction, allowMemorySessions }) {
  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) {
    if (isProduction && !allowMemorySessions) {
      throw new Error('A Redis session store is required in production; set REDIS_URL, or set ALLOW_MEMORY_SESSIONS=1 only for a single-instance deployment that accepts non-durable sessions');
    }
    if (isProduction) {
      console.warn('[Session] ALLOW_MEMORY_SESSIONS=1: production sessions are process-local and will be lost on restart');
    }
    return { store: null, client: null };
  }

  const client = createClient({
    url,
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => {
        if (retries >= REDIS_CONNECT_MAX_RETRIES) return false;
        return Math.min((retries + 1) * 150, 1000);
      }
    }
  });

  client.on('error', (err) => {
    console.warn('[Redis] Connection error:', err?.message || err?.code || String(err));
  });
  client.on('connect', () => console.log('[Redis] Connected successfully'));

  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Redis connect timed out after ${REDIS_CONNECT_TIMEOUT_MS}ms`)), REDIS_CONNECT_TIMEOUT_MS).unref();
      })
    ]);
    if (!client.isReady) throw new Error('Redis client did not reach ready state');
    console.log('[Session] Using Redis for session storage');
    return { store: new RedisStore({ client }), client };
  } catch (err) {
    console.warn('[Redis] Failed to connect, falling back to memory store:', err?.message || err);
    try {
      if (client.isOpen) await client.disconnect();
    } catch (disconnectErr) {
      console.warn('[Redis] Cleanup after failed connect:', disconnectErr?.message || disconnectErr);
    }
    if (isProduction && !allowMemorySessions) {
      throw new Error('A Redis session store is required in production; set REDIS_URL, or set ALLOW_MEMORY_SESSIONS=1 only for a single-instance deployment that accepts non-durable sessions');
    }
    return { store: null, client: null };
  }
}

/**
 * Builds the whole online stack without listening, so tests and embedders can
 * reuse it. `server/index.js` is the only place that binds a port.
 */
export async function createOnlineServer(options = {}) {
  const app = express();
  const httpServer = createServer(app);
  const isProduction = (options.env || process.env.NODE_ENV) === 'production';
  const allowMemorySessions = process.env.ALLOW_MEMORY_SESSIONS === '1';
  const trustProxy = resolveTrustProxy();

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000');

    // The JSON API is never framed. The game HTML is intentionally not given
    // X-Frame-Options because the hosted preview runs it inside an iframe.
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', API_CONTENT_SECURITY_POLICY);
      return sendJson(body);
    };
    next();
  });

  // A self-hosted deployment usually puts the game and API on one origin. The
  // configured origins cover a separately hosted client.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedRequestOrigin(origin, req)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (req.method === 'OPTIONS') {
      const allowed = !origin || isAllowedRequestOrigin(origin, req);
      return res.sendStatus(allowed ? 204 : 403);
    }
    if (origin && !isAllowedRequestOrigin(origin, req)) {
      return res.status(403).json({ ok: false, error: 'Origin not allowed by CORS policy' });
    }
    next();
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  const { store: sessionStore, client: redisClient } = await connectRedisSessionStore({
    isProduction,
    allowMemorySessions
  });

  const sessionConfig = {
    name: 'scaledice.sid',
    secret: sessionSecret(options.sessionSecret, isProduction),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: trustProxy !== 0,
    cookie: {
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction,
      maxAge: 24 * 60 * 60 * 1000
    }
  };
  if (sessionStore) sessionConfig.store = sessionStore;
  else console.log('[Session] Using memory store (not recommended for production)');

  const sessionMiddleware = session(sessionConfig);
  app.use(sessionMiddleware);

  authMiddleware(app);

  app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: 'healthy',
      service: 'scaledice-online',
      runtime: process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME ? 'serverless' : 'persistent',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  app.use('/auth', authRouter);

  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        // The handshake has no Express request, so use a permissive predicate
        // here; allowRequest below applies the full same-origin check.
        callback(null, origin || true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS']
    },
    allowRequest: (req, callback) => {
      callback(null, isAllowedRequestOrigin(req.headers.origin, req));
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e6,
    serveClient: false
  });

  const wrap = (middleware) => (socket, next) => middleware(socket.request, {}, next);
  io.use(wrap(sessionMiddleware));
  io.use(wrap(passport.initialize()));
  io.use(wrap(passport.session()));

  io.use((socket, next) => {
    if (socket.request.sessionID) socket.join(`session:${socket.request.sessionID}`);
    next();
  });

  // A socket's handshake user is only a snapshot. Reload the backing session
  // before every packet so logout, expiry or revocation cannot leave an already
  // open socket authorized. Checks are serialized so slow stores cannot reorder
  // game actions.
  io.use((socket, next) => {
    const originalUserId = socket.request.user?.id;
    let checks = Promise.resolve();
    if (!originalUserId) return next();

    socket.use((event, nextPacket) => {
      checks = checks.then(() => new Promise((resolve) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) nextPacket(error);
          else nextPacket();
          resolve();
        };
        const timer = setTimeout(() => {
          if (socket.connected) socket.disconnect(true);
          finish(new Error('Session check timed out'));
        }, SESSION_RELOAD_TIMEOUT_MS);
        timer.unref?.();

        const currentSession = socket.request?.session;
        if (!socket.connected || !currentSession || typeof currentSession.reload !== 'function') {
          if (socket.connected) socket.disconnect(true);
          return finish(new Error('Session unavailable'));
        }

        currentSession.reload((err) => {
          const current = socket.request?.session;
          const expires = current?.cookie?.expires ? new Date(current.cookie.expires).getTime() : null;
          const valid = !err && socket.connected &&
            current?.passport?.user &&
            String(current.passport.user) === String(originalUserId) &&
            (expires === null || (Number.isFinite(expires) && expires > Date.now()));
          if (!valid) {
            if (socket.connected) socket.disconnect(true);
            return finish(new Error('Session expired'));
          }
          return finish();
        });
      }));
    });

    next();
  });

  app.set('revokeSessionSockets', (sessionId) => {
    if (sessionId) io.in(`session:${sessionId}`).disconnectSockets(true);
  });

  const lobbyManager = new LobbyManager(io, options.lobby || {});

  const MAX_SOCKETS_PER_IP = positiveInt(process.env.SOCKET_MAX_PER_IP, 60);
  const MAX_SOCKET_CONNECTS_PER_MINUTE = positiveInt(process.env.SOCKET_CONNECT_LIMIT_PER_MINUTE, 120);
  const MAX_TOTAL_SOCKETS = positiveInt(process.env.SOCKET_MAX_TOTAL, 2000);
  const socketConnectionsByIp = new Map();
  const socketConnectBuckets = new Map();

  function consumeSocketConnect(address, now) {
    let bucket = socketConnectBuckets.get(address);
    if (!bucket || now - bucket.startedAt >= 60 * 1000) {
      if (socketConnectBuckets.size >= 5000) {
        const oldest = socketConnectBuckets.keys().next();
        if (!oldest.done) socketConnectBuckets.delete(oldest.value);
      }
      bucket = { startedAt: now, count: 0 };
      socketConnectBuckets.set(address, bucket);
    }
    bucket.count += 1;
    return bucket.count > MAX_SOCKET_CONNECTS_PER_MINUTE;
  }

  io.use((socket, next) => {
    const address = requestAddress(socket.request, trustProxy);
    const active = socketConnectionsByIp.get(address) || 0;
    if (active >= MAX_SOCKETS_PER_IP) return next(new Error('Too many connections from this address'));
    if (io.engine.clientsCount >= MAX_TOTAL_SOCKETS) return next(new Error('Server connection capacity reached'));
    if (consumeSocketConnect(address, Date.now())) return next(new Error('Too many connection attempts'));
    socket.data.connectionKey = address;
    next();
  });

  io.on('connection', (socket) => {
    const address = socket.data.connectionKey;
    if (address) {
      socketConnectionsByIp.set(address, (socketConnectionsByIp.get(address) || 0) + 1);
      socket.once('disconnect', () => {
        const count = socketConnectionsByIp.get(address) || 0;
        if (count <= 1) socketConnectionsByIp.delete(address);
        else socketConnectionsByIp.set(address, count - 1);
      });
    }

    socket.data.clientKey = address;
    socket.data.lastHeartbeat = Date.now();
    console.log(`[Socket] connected ${socket.id} (${address || socket.handshake.address})`);
    lobbyManager.registerSocket(socket);

    socket.on('error', (err) => {
      console.warn(`[Socket] error on ${socket.id}:`, err?.message || err);
    });
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] disconnected ${socket.id} (${reason})`);
    });
  });

  // Serve the game itself so `npm start` is enough for local play. The root is
  // the Phaser page; relative asset paths resolve against /assets.
  app.use(express.static(CLIENT_DIR, { index: false, maxAge: isProduction ? '1h' : 0 }));
  // The repository's static entry point redirects to /client/index.html; keep
  // that URL working when the same client is served by Express.
  app.use('/client', express.static(CLIENT_DIR, { index: false, maxAge: isProduction ? '1h' : 0 }));
  app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });
  app.get(/^\/(?!auth|health|socket\.io).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = Number(err?.status || err?.statusCode) || 500;
    if (status >= 400 && status < 500) {
      return res.status(status).json({ ok: false, error: status === 413 ? 'Payload too large' : 'Bad request' });
    }
    console.error('[Server] Unhandled error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  });

  return {
    app,
    httpServer,
    io,
    lobbyManager,
    sessionMiddleware,
    redisClient,
    async closeRedis() {
      if (!redisClient) return;
      try {
        if (redisClient.isOpen) await redisClient.quit();
      } catch (err) {
        console.warn('[Redis] Shutdown error:', err?.message || err);
      }
    }
  };
}

export default createOnlineServer;
