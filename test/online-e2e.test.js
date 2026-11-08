import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SESSION_SECRET = 'e2e-session-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

const { createOnlineServer } = await import('../server/app.js');

let running = null;
const sockets = [];

function once(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function makeSocket(base, cookie) {
  const socket = ioClient(base, {
    autoConnect: false,
    transports: ['polling'],
    withCredentials: true,
    extraHeaders: cookie ? { Cookie: cookie } : undefined
  });
  sockets.push(socket);
  return socket;
}

function sessionCookie(response) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const raw = cookies.find((cookie) => cookie.startsWith('scaledice.sid='));
  return raw ? raw.split(';')[0] : null;
}

before(async () => {
  running = await createOnlineServer({
    lobby: {
      rateLimit: false,
      pruneIntervalMs: 0,
      startDelayMs: 5,
      rollDelayMs: 5,
      rollGraceMs: 100,
      cleanupDelayMs: 20
    }
  });
  await running.lobbyManager.init();
  await new Promise((resolve) => running.httpServer.listen(0, '127.0.0.1', resolve));
  running.base = `http://127.0.0.1:${running.httpServer.address().port}`;
});

after(async () => {
  for (const socket of sockets) socket.close();
  if (running) {
    running.lobbyManager.dispose();
    running.io.close();
    running.httpServer.closeAllConnections?.();
    await new Promise((resolve) => running.httpServer.close(resolve));
  }
});

test('a socket from an unauthenticated browser cannot create a lobby', async () => {
  const socket = makeSocket(running.base);
  const required = once(socket, 'auth-required');
  const failed = once(socket, 'create-failed');

  socket.connect();
  await once(socket, 'connect');
  socket.emit('create-lobby', { players: 2, rounds: 10 });

  assert.equal((await required).event, 'create-lobby');
  assert.equal((await failed).reason, 'unauthenticated');
});

test('the HTTP session authenticates the socket and creates a lobby', async () => {
  const response = await fetch(`${running.base}/auth/guest/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: running.base },
    body: JSON.stringify({ password: 'socket-password' })
  });
  const body = await response.json();
  const cookie = sessionCookie(response);
  assert.ok(cookie);

  const socket = makeSocket(running.base, cookie);
  const auth = once(socket, 'auth-success');
  const connected = once(socket, 'connect');
  socket.connect();
  await connected;
  const authPayload = await auth;
  assert.equal(authPayload.user.id, body.user.id);

  const created = once(socket, 'lobby-created');
  socket.emit('create-lobby', { players: 2, rounds: 10 });
  const lobby = await created;
  assert.match(lobby.code, /^[A-HJ-NP-Z2-9]{6}$/);
});

test('a forged auth-user payload is rejected instead of becoming an identity', async () => {
  const response = await fetch(`${running.base}/auth/guest/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: running.base },
    body: JSON.stringify({ password: 'forged-identity-password' })
  });
  const cookie = sessionCookie(response);
  const socket = makeSocket(running.base, cookie);
  const auth = once(socket, 'auth-success');
  const connected = once(socket, 'connect');
  socket.connect();
  await connected;
  await auth;

  const failed = once(socket, 'auth-failed');
  socket.emit('auth-user', { id: 'attacker-chosen-id', name: 'Not me' });
  const payload = await failed;

  assert.equal(payload.reason, 'identity_mismatch');
});

test('two authenticated sessions can start and play a server-verified turn', async () => {
  async function registerGuest(password) {
    const response = await fetch(`${running.base}/auth/guest/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: running.base },
      body: JSON.stringify({ password })
    });
    const body = await response.json();
    return { user: body.user, cookie: sessionCookie(response) };
  }

  const hostAccount = await registerGuest('e2e-host-password');
  const guestAccount = await registerGuest('e2e-guest-password');

  const host = makeSocket(running.base, hostAccount.cookie);
  const guest = makeSocket(running.base, guestAccount.cookie);
  const hostAuth = once(host, 'auth-success');
  const guestAuth = once(guest, 'auth-success');
  host.connect();
  guest.connect();
  await Promise.all([hostAuth, guestAuth]);

  const created = once(host, 'lobby-created');
  host.emit('create-lobby', { players: 2, rounds: 10 });
  const { code } = await created;

  const joined = once(guest, 'join-success');
  guest.emit('join-lobby', code);
  await joined;

  host.emit('toggle-ready', code);
  guest.emit('toggle-ready', code);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const starting = once(guest, 'game-starting');
  const firstTurn = once(guest, 'turn-start');
  host.emit('start-game', code);
  await starting;
  const turn = await firstTurn;
  assert.equal(turn.playerIndex, 0);

  const result = once(guest, 'turn-result');
  host.emit('player-roll', { code });
  const roll = await result;
  assert.equal(roll.dice.length, 1);
  assert.equal(roll.scores[0], roll.scored);

  const nextTurn = once(guest, 'turn-start');
  host.emit('player-end-turn', { code });
  assert.equal((await nextTurn).playerIndex, 1);

  host.close();
  guest.close();
});

test('logging out revokes the session and disconnects its socket', async () => {
  const response = await fetch(`${running.base}/auth/guest/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: running.base },
    body: JSON.stringify({ password: 'logout-socket-password' })
  });
  const cookie = sessionCookie(response);
  assert.ok(cookie);

  const socket = makeSocket(running.base, cookie);
  const connected = once(socket, 'connect');
  const auth = once(socket, 'auth-success');
  socket.connect();
  await connected;
  await auth;

  const disconnected = once(socket, 'disconnect', 5000);
  const logout = await fetch(`${running.base}/auth/logout`, {
    method: 'POST',
    headers: { origin: running.base, cookie }
  });
  assert.equal(logout.status, 200);
  assert.ok(await disconnected);
});
