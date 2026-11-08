import { fetchApi, getServerUrl } from './SocketManager.js';

const REDIRECT_PARAMS = ['auth', 'provider', 'error', 'timestamp'];

async function readJson(response) {
  try {
    return await response.json();
  } catch (err) {
    return null;
  }
}

async function postJson(path, body) {
  try {
    const response = await fetchApi(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await readJson(response);
    return {
      ok: response.ok && !!data?.ok,
      status: response.status,
      user: data?.user || null,
      error: data?.error || null
    };
  } catch (err) {
    return { ok: false, status: 0, user: null, error: 'Could not reach the server' };
  }
}

export async function fetchMe() {
  try {
    const response = await fetchApi('/auth/me');
    const data = await readJson(response);
    return data?.ok && data.user ? data.user : null;
  } catch (err) {
    return null;
  }
}

export async function fetchProviders() {
  try {
    const response = await fetchApi('/auth/providers');
    const data = await readJson(response);
    return data || { guest: true, google: false, discord: false };
  } catch (err) {
    return { guest: true, google: false, discord: false };
  }
}

export function guestRegister(password) {
  return postJson('/auth/guest/register', { password });
}

export function guestLogin(username, password) {
  return postJson('/auth/guest/login', { username, password });
}

export async function logout() {
  try {
    const response = await fetchApi('/auth/logout', { method: 'POST' });
    return response.ok;
  } catch (err) {
    return false;
  }
}

export function oauthUrl(provider) {
  return `${getServerUrl().replace(/\/$/, '')}/auth/${provider}`;
}

// Reads and strips ?auth=success|error after an OAuth redirect. The notice is
// only for UI feedback; the session itself is always re-checked with /auth/me.
export function consumeAuthRedirect() {
  try {
    if (typeof window === 'undefined' || !window.location) return null;
    const url = new URL(window.location.href);
    const status = url.searchParams.get('auth');
    if (status !== 'success' && status !== 'error') return null;

    const notice = {
      status,
      provider: url.searchParams.get('provider') || null,
      error: url.searchParams.get('error') || null
    };

    REDIRECT_PARAMS.forEach((key) => url.searchParams.delete(key));
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (window.history?.replaceState) window.history.replaceState({}, '', next);
    return notice;
  } catch (err) {
    return null;
  }
}

export default {
  fetchMe,
  fetchProviders,
  guestRegister,
  guestLogin,
  logout,
  oauthUrl,
  consumeAuthRedirect
};
