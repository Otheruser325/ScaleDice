import './env.js';
import express from 'express';
import crypto from 'node:crypto';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import DiscordStrategy from 'passport-discord';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from './utils/passwords.js';
import { findUserById, findUsersByField, saveUser, publicUser } from './utils/userStorage.js';
import {
  isAllowedOrigin,
  isAllowedRequestOrigin,
  getPublicServerOrigin,
  getClientRedirectBase,
  normalizeOrigin
} from './utils/origins.js';

export const router = express.Router();
router.use(express.json({ limit: '32kb' }));

const INVALID_CREDENTIALS = 'Invalid username or password';
const GUEST_NAME_PATTERN = /^guest\d{6,12}$/i;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
let guestRegistrationQueue = Promise.resolve();

const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const discordConfigured = !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const buckets = new Map();
const MAX_BUCKETS = 2000;
let lastBucketSweep = 0;

function clientIp(req) {
  return String(req?.ip || req?.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

function pruneBuckets(now) {
  if (buckets.size < MAX_BUCKETS && now - lastBucketSweep < 30 * 1000) return;
  lastBucketSweep = now;
  for (const [key, bucket] of buckets) {
    if (!bucket || now - bucket.startedAt >= 60 * 1000) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    let overflow = buckets.size - MAX_BUCKETS;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (--overflow <= 0) break;
    }
  }
}

function isRateLimited(req, key, limit, windowMs = 60 * 1000) {
  if (process.env.AUTH_RATE_LIMIT_DISABLED === '1') return false;

  const now = Date.now();
  pruneBuckets(now);
  const bucketKey = `${key}:${clientIp(req)}`;
  const bucket = buckets.get(bucketKey);

  if (!bucket || now - bucket.startedAt >= windowMs) {
    if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value);
    buckets.set(bucketKey, { startedAt: now, count: 1 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

function rejectRateLimited(res) {
  res.setHeader('Retry-After', '60');
  return res.status(429).json({
    ok: false,
    error: 'Too many authentication attempts. Please wait a minute and try again.'
  });
}

// SameSite=None cookies are used in production, so a cross-site form could
// otherwise reach these endpoints with the player's cookie attached. Unsafe
// methods must prove a same-origin Origin (or Referer) even when a client
// deliberately omits it.
function requireTrustedOrigin(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  let origin = req.headers.origin;
  if (!origin && req.headers.referer) {
    try {
      origin = new URL(String(req.headers.referer)).origin;
    } catch (err) {
      origin = null;
    }
  }
  if (!origin || !isAllowedRequestOrigin(origin, req)) {
    return res.status(403).json({ ok: false, error: 'Request origin not allowed' });
  }
  return next();
}

router.use(requireTrustedOrigin);

// ---------------------------------------------------------------------------
// Passport session
// ---------------------------------------------------------------------------

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    done(null, (await findUserById(id)) || false);
  } catch (err) {
    done(err, false);
  }
});

function sanitizeDisplayName(value, fallback = 'Player') {
  if (typeof value !== 'string') return fallback;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  return name || fallback;
}

export async function upsertOAuthUser(provider, providerId, displayName, avatar) {
  if (!providerId) throw new Error('OAuth provider did not return an id');

  const matches = await findUsersByField('oauthProviderId', providerId);
  const existing = matches.find((user) => user.oauthProvider === provider);
  const now = new Date().toISOString();

  if (existing) {
    return saveUser({
      ...existing,
      name: sanitizeDisplayName(displayName, existing.name),
      avatar: avatar || existing.avatar || null,
      type: provider,
      oauthProvider: provider,
      updatedAt: now
    });
  }

  return saveUser({
    id: crypto.randomUUID(),
    name: sanitizeDisplayName(displayName, `${provider} player`),
    type: provider,
    oauthProvider: provider,
    oauthProviderId: String(providerId),
    avatar: avatar || null,
    createdAt: now,
    updatedAt: now
  });
}

// ---------------------------------------------------------------------------
// Optional OAuth providers
// ---------------------------------------------------------------------------

const googleCallbackPath = '/auth/google/callback';
const discordCallbackPath = '/auth/discord/callback';

function callbackUrl(provider, explicit, pathName) {
  if (explicit) return explicit;
  return `${getPublicServerOrigin()}${pathName}`;
}

if (googleConfigured) {
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: callbackUrl('google', process.env.GOOGLE_CALLBACK_URL, googleCallbackPath),
      scope: ['profile']
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const avatar = profile?.photos?.[0]?.value || null;
        const user = await upsertOAuthUser(
          'google',
          profile?.id,
          profile?.displayName || profile?.name?.givenName,
          avatar
        );
        done(null, user);
      } catch (err) {
        console.error('[auth] Google sign in failed:', err?.message || err);
        done(err);
      }
    }
  ));
} else {
  console.warn('[auth] Google OAuth disabled (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)');
}

if (discordConfigured) {
  passport.use(new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: callbackUrl('discord', process.env.DISCORD_CALLBACK_URL, discordCallbackPath),
      scope: ['identify']
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const discriminator = profile?.discriminator && profile.discriminator !== '0' ? `#${profile.discriminator}` : '';
        const avatar = profile?.avatar
          ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
          : null;
        const user = await upsertOAuthUser(
          'discord',
          profile?.id,
          `${profile?.username || 'Discord player'}${discriminator}`,
          avatar
        );
        done(null, user);
      } catch (err) {
        console.error('[auth] Discord sign in failed:', err?.message || err);
        done(err);
      }
    }
  ));
} else {
  console.warn('[auth] Discord OAuth disabled (missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET)');
}

function providerEnabled(provider) {
  return provider === 'google' ? googleConfigured : provider === 'discord' ? discordConfigured : false;
}

function oauthRedirect(params = {}) {
  const base = normalizeOrigin(getClientRedirectBase()) || getClientRedirectBase();
  // Both the bundled server and a separately hosted game client answer at the
  // origin root; the client strips these parameters after reading them.
  const url = new URL('/', base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function oauthFailure(req, res, provider, message) {
  if (String(req.headers.accept || '').includes('application/json')) {
    return res.status(401).json({ ok: false, provider, error: message });
  }
  return res.redirect(oauthRedirect({
    auth: 'error',
    provider,
    error: message,
    timestamp: Date.now()
  }));
}

// One-time state value bound to this browser session prevents login CSRF: a
// callback minted for another session cannot complete here.
function issueOAuthState(req, provider) {
  const nonce = crypto.randomBytes(24).toString('base64url');
  req.session.oauthState = { nonce, provider, createdAt: Date.now() };
  return nonce;
}

function consumeOAuthState(req, provider) {
  const state = req.session?.oauthState;
  req.session.oauthState = undefined;
  if (!state || state.provider !== provider || typeof req.query?.state !== 'string') return false;
  if (Date.now() - Number(state.createdAt || 0) > OAUTH_STATE_TTL_MS) return false;
  const a = Buffer.from(state.nonce);
  const b = Buffer.from(req.query.state);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function startOAuth(provider) {
  return (req, res, next) => {
    if (!providerEnabled(provider)) {
      return res.status(503).json({
        ok: false,
        error: `${provider === 'google' ? 'Google' : 'Discord'} sign in is not configured on this server.`
      });
    }
    if (isRateLimited(req, `oauth-start-${provider}`, 20)) return rejectRateLimited(res);

    const state = issueOAuthState(req, provider);
    req.session.save((err) => {
      if (err) return res.status(500).json({ ok: false, error: 'Could not start sign in' });
      return passport.authenticate(provider, { session: false, state })(req, res, next);
    });
  };
}

function finishOAuth(provider) {
  return (req, res, next) => {
    if (!providerEnabled(provider)) {
      return res.status(503).json({ ok: false, error: 'Provider is not configured' });
    }
    if (!consumeOAuthState(req, provider)) {
      return oauthFailure(req, res, provider, 'Sign in session expired. Please try again.');
    }

    passport.authenticate(provider, { session: false }, (err, user) => {
      if (err || !user) {
        console.warn(`[auth] ${provider} callback failed:`, err?.message || err || 'no user');
        return oauthFailure(req, res, provider, 'Sign in was cancelled or failed.');
      }

      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error(`[auth] ${provider} session login failed:`, loginErr?.message || loginErr);
          return oauthFailure(req, res, provider, 'Sign in failed. Please try again.');
        }
        req.session.save((saveErr) => {
          if (saveErr) console.warn(`[auth] ${provider} session save failed:`, saveErr?.message || saveErr);
          return res.redirect(oauthRedirect({
            auth: 'success',
            provider,
            timestamp: Date.now()
          }));
        });
      });
    })(req, res, next);
  };
}

router.get('/google', startOAuth('google'));
router.get('/google/callback', finishOAuth('google'));
router.get('/discord', startOAuth('discord'));
router.get('/discord/callback', finishOAuth('discord'));

// ---------------------------------------------------------------------------
// Guest accounts and session endpoints
// ---------------------------------------------------------------------------

router.post('/guest/register', async (req, res) => {
  try {
    if (isRateLimited(req, 'guest-register', 6)) return rejectRateLimited(res);

    const { password } = req.body || {};
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return res.status(400).json({ ok: false, error: 'Password must be between 6 and 128 characters' });
    }

    // Serialize allocation and save within this process. Two simultaneous
    // registrations must not both observe the same unused guest name.
    const account = guestRegistrationQueue.catch(() => {}).then(async () => {
      let name;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const candidate = `Guest${crypto.randomInt(100000000, 1000000000)}`;
        if ((await findUsersByField('name', candidate)).length === 0) {
          name = candidate;
          break;
        }
      }
      if (!name) {
        const err = new Error('Could not allocate a guest name');
        err.status = 503;
        throw err;
      }

      const now = new Date().toISOString();
      return saveUser({
        id: crypto.randomUUID(),
        name,
        type: 'guest',
        guestPassword: await hashPassword(password),
        createdAt: now,
        updatedAt: now
      });
    });
    guestRegistrationQueue = account.catch(() => {});
    const saved = await account;

    req.login(saved, (err) => {
      if (err) {
        console.error('[auth] session login failed after guest register:', err?.message || err);
        return res.status(500).json({ ok: false, error: 'Account created, but sign in failed' });
      }
      req.session.save((saveErr) => {
        if (saveErr) console.warn('[auth] session save failed after guest register:', saveErr?.message || saveErr);
        return res.json({ ok: true, user: publicUser(saved) });
      });
    });
  } catch (err) {
    console.error('[auth] guest register failed:', err?.message || err);
    const status = Number(err?.status) || 500;
    res.status(status).json({ ok: false, error: 'Account storage is unavailable. Please try again later.' });
  }
});

router.post('/guest/login', async (req, res) => {
  try {
    if (isRateLimited(req, 'guest-login', 20)) return rejectRateLimited(res);

    const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!rawUsername || !password || rawUsername.length > 64 || password.length > 256) {
      return res.status(400).json({ ok: false, error: INVALID_CREDENTIALS });
    }

    // A plain number is shorthand for the Guest username that owns it.
    const username = /^\d+$/.test(rawUsername) ? `Guest${rawUsername}` : rawUsername;
    if (isRateLimited(req, `guest-login-user:${username.toLowerCase()}`, 10)) return rejectRateLimited(res);

    const candidates = (await findUsersByField('name', username)).filter((user) => user.type === 'guest');
    if (candidates.length === 0) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ ok: false, error: INVALID_CREDENTIALS });
    }

    const verified = [];
    for (const candidate of candidates) {
      if (await verifyPassword(password, candidate.guestPassword)) verified.push(candidate);
    }
    if (verified.length !== 1) return res.status(401).json({ ok: false, error: INVALID_CREDENTIALS });

    const user = verified[0];
    req.login(user, (err) => {
      if (err) {
        console.error('[auth] session login failed:', err?.message || err);
        return res.status(500).json({ ok: false, error: 'Sign in failed' });
      }
      req.session.save((saveErr) => {
        if (saveErr) console.warn('[auth] session save failed:', saveErr?.message || saveErr);
        return res.json({ ok: true, user: publicUser(user) });
      });
    });
  } catch (err) {
    console.error('[auth] guest login failed:', err?.message || err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.get('/me', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.user) res.json({ ok: true, user: publicUser(req.user) });
  else res.json({ ok: false, user: null });
});

router.get('/providers', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ guest: true, google: googleConfigured, discord: discordConfigured });
});

router.post('/logout', (req, res) => {
  const oldSessionId = req.sessionID;
  req.logout((logoutErr) => {
    if (logoutErr) return res.status(500).json({ ok: false, error: 'Logout failed' });

    // A socket keeps the identity it loaded at handshake; disconnect every
    // socket that belongs to the session being destroyed.
    try {
      req.app.get('revokeSessionSockets')?.(oldSessionId);
    } catch (err) {
      console.warn('[auth] socket revocation failed:', err?.message || err);
    }

    if (req.session && typeof req.session.destroy === 'function') {
      req.session.destroy(() => res.json({ ok: true }));
      return;
    }
    res.json({ ok: true });
  });
});

// Provider availability for clients that support OAuth sign-in.
router.get('/methods', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ guest: true, google: googleConfigured, discord: discordConfigured });
});

export function authMiddleware(app) {
  app.use(passport.initialize());
  app.use(passport.session());
}

export { passport };
export const authRouter = router;
export default router;
