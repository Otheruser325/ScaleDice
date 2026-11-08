import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

// Keep the regression suite on the local in-memory backend; no Supabase traffic
// or account files should be created by tests.
process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SESSION_SECRET = 'test-session-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

const { createOnlineServer } = await import('../server/app.js');
const { upsertOAuthUser } = await import('../server/auth.js');

let running = null;

async function start() {
  const server = await createOnlineServer();
  await server.lobbyManager.init();
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = server.httpServer.address();
  running = { ...server, base: `http://127.0.0.1:${port}` };
  return running;
}

async function stop() {
  if (!running) return;
  running.lobbyManager.dispose();
  running.io.close();
  running.httpServer.closeAllConnections?.();
  await new Promise((resolve) => running.httpServer.close(resolve));
  running = null;
}

function sessionCookie(response) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const raw = cookies.find((cookie) => cookie.startsWith('scaledice.sid='));
  return raw ? raw.split(';')[0] : null;
}

async function api(pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(`${running.base}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      origin: running.base,
      ...(cookie ? { cookie } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await response.json();
  } catch (err) {
    json = null;
  }
  return { response, json, cookie: sessionCookie(response) };
}

before(start);
after(stop);

test('health endpoint responds before auth', async () => {
  const { response, json } = await api('/health');
  assert.equal(response.status, 200);
  assert.equal(json.status, 'healthy');
});

test('guest registration creates a server session and hides the password hash', async () => {
  const { response, json, cookie } = await api('/auth/guest/register', {
    method: 'POST',
    body: { password: 'hunter2-secret' }
  });

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.match(json.user.name, /^Guest\d{9}$/);
  assert.equal(json.user.type, 'guest');
  assert.equal(json.user.guestPassword, undefined);
  assert.ok(cookie);

  const me = await api('/auth/me', { cookie });
  assert.equal(me.json.ok, true);
  assert.equal(me.json.user.id, json.user.id);
});

test('short guest passwords are rejected', async () => {
  const { response, json } = await api('/auth/guest/register', {
    method: 'POST',
    body: { password: '123' }
  });
  assert.equal(response.status, 400);
  assert.equal(json.ok, false);
});

test('logout destroys the session and clears the account', async () => {
  const registered = await api('/auth/guest/register', {
    method: 'POST',
    body: { password: 'logout-password' }
  });
  const cookie = registered.cookie;

  const loggedOut = await api('/auth/logout', { method: 'POST', cookie });
  assert.equal(loggedOut.json.ok, true);

  const me = await api('/auth/me', { cookie });
  assert.equal(me.json.ok, false);
});

test('guest login accepts the full name and the numeric shorthand', async () => {
  const registered = await api('/auth/guest/register', {
    method: 'POST',
    body: { password: 'login-password' }
  });
  const name = registered.json.user.name;
  const digits = name.replace(/^Guest/, '');

  await api('/auth/logout', { method: 'POST', cookie: registered.cookie });

  const byName = await api('/auth/guest/login', {
    method: 'POST',
    body: { username: name, password: 'login-password' }
  });
  assert.equal(byName.json.ok, true);
  assert.equal(byName.json.user.id, registered.json.user.id);

  await api('/auth/logout', { method: 'POST', cookie: byName.cookie });

  const byDigits = await api('/auth/guest/login', {
    method: 'POST',
    body: { username: digits, password: 'login-password' }
  });
  assert.equal(byDigits.json.ok, true);
  assert.equal(byDigits.json.user.id, registered.json.user.id);
});

test('wrong passwords return the same generic error as unknown accounts', async () => {
  const registered = await api('/auth/guest/register', {
    method: 'POST',
    body: { password: 'right-password' }
  });
  await api('/auth/logout', { method: 'POST', cookie: registered.cookie });

  const wrong = await api('/auth/guest/login', {
    method: 'POST',
    body: { username: registered.json.user.name, password: 'wrong-password' }
  });
  const missing = await api('/auth/guest/login', {
    method: 'POST',
    body: { username: 'Guest999999999', password: 'whatever' }
  });

  assert.equal(wrong.response.status, 401);
  assert.equal(missing.response.status, 401);
  assert.equal(wrong.json.error, missing.json.error);
});

test('auth reports which sign-in methods are configured', async () => {
  const { json } = await api('/auth/providers');
  assert.equal(json.guest, true);
  assert.equal(json.google, false);
  assert.equal(json.discord, false);

  const google = await api('/auth/google');
  assert.equal(google.response.status, 503);
});

test('OAuth accounts are auto-provisioned and reused by provider id', async () => {
  const first = await upsertOAuthUser(
    'google',
    'oauth-test-google-1',
    'Google Tester',
    'https://example.com/google-avatar.png'
  );
  assert.equal(first.type, 'google');
  assert.equal(first.oauthProvider, 'google');
  assert.equal(first.oauthProviderId, 'oauth-test-google-1');
  assert.equal(first.avatar, 'https://example.com/google-avatar.png');

  const returning = await upsertOAuthUser(
    'google',
    'oauth-test-google-1',
    'Updated Google Tester',
    null
  );
  assert.equal(returning.id, first.id);
  assert.equal(returning.name, 'Updated Google Tester');
  assert.equal(returning.avatar, 'https://example.com/google-avatar.png');

  const otherProvider = await upsertOAuthUser(
    'discord',
    'oauth-test-google-1',
    'Discord Tester',
    null
  );
  assert.notEqual(otherProvider.id, first.id);
  assert.equal(otherProvider.type, 'discord');
  assert.equal(otherProvider.oauthProvider, 'discord');
});

test('unsafe auth requests from a foreign origin are rejected', async () => {
  const { response, json } = await api('/auth/guest/register', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: { password: 'csrf-password' }
  });
  assert.equal(response.status, 403);
  assert.equal(json.ok, false);
});

test('unsafe auth requests without an origin or referer are rejected', async () => {
  const response = await fetch(`${running.base}/auth/guest/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'missing-origin-password' })
  });
  const json = await response.json();
  assert.equal(response.status, 403);
  assert.equal(json.ok, false);
});
