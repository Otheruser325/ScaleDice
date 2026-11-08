// Online transport helpers.
//
// The game is normally served by the same Express process that hosts the
// Socket.IO server, so the default is the current origin. A separately hosted
// client can point at its API with ?server=https://api.example.com or by
// setting window.__SCALEDICE_SERVER__ before the game boots.

let socket = null;
let serverUrl = null;
let listenersAttached = false;

function normalize(url) {
  return String(url || '').replace(/\/+$/, '');
}

function queryServer() {
  try {
    if (typeof window === 'undefined') return null;
    const value = new URLSearchParams(window.location.search).get('server');
    return value ? normalize(value) : null;
  } catch (err) {
    return null;
  }
}

export function getServerUrl() {
  if (serverUrl) return serverUrl;

  const explicit = queryServer()
    || (typeof window !== 'undefined' ? window.__SCALEDICE_SERVER__ : null);
  if (explicit) {
    serverUrl = normalize(explicit);
    return serverUrl;
  }

  try {
    if (typeof window !== 'undefined' && window.location &&
        (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
      serverUrl = normalize(window.location.origin);
      return serverUrl;
    }
  } catch (err) {
    // fall through to localhost
  }

  serverUrl = 'http://localhost:8080';
  return serverUrl;
}

export function connectTo(url) {
  if (url) serverUrl = normalize(url);
  if (socket) {
    try { socket.close(); } catch (err) { /* ignore */ }
    socket = null;
    listenersAttached = false;
  }
  return getSocket();
}

export function getSocket() {
  if (typeof window === 'undefined' || typeof window.io !== 'function') {
    // Offline stub keeps menu scenes usable when the CDN script is unavailable.
    return {
      connected: false,
      id: null,
      data: {},
      on() {},
      once() {},
      off() {},
      emit() {},
      close() {}
    };
  }

  if (socket) return socket;

  socket = window.io(getServerUrl(), {
    autoConnect: true,
    withCredentials: true,
    transports: ['websocket', 'polling']
  });

  if (!listenersAttached) {
    listenersAttached = true;
    socket.on('connect_error', (err) => {
      console.warn('[Socket] connect_error:', err?.message || err);
    });
    socket.on('disconnect', (reason) => {
      console.info('[Socket] disconnected:', reason);
    });
  }

  return socket;
}

export function waitForConnection(timeoutMs = 8000, target = null) {
  const sock = target || getSocket();
  if (!sock || typeof sock.on !== 'function') return Promise.resolve(false);
  if (sock.connected) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.off?.('connect', onConnect);
      sock.off?.('connect_error', onError);
      resolve(value);
    };
    const onConnect = () => finish(true);
    const onError = () => { /* keep waiting until the timeout */ };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.on('connect', onConnect);
    sock.on('connect_error', onError);
  });
}

export async function probeHealth(timeoutMs = 1200) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${getServerUrl()}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch (err) {
    return false;
  }
}

export async function fetchApi(pathname, options = {}) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return fetch(`${getServerUrl()}${path}`, {
    credentials: 'include',
    ...options
  });
}

// The socket's identity is its HTTP session. This only asks the server to
// confirm the session user; the server rejects mismatched ids.
export function emitAuthUser(user) {
  if (!user || !user.id) return false;
  try {
    const sock = getSocket();
    sock.emit('auth-user', {
      id: user.id,
      name: user.name,
      type: user.type,
      avatar: user.avatar || null
    });
    return true;
  } catch (err) {
    return false;
  }
}

export function closeSocket() {
  if (!socket) return;
  try { socket.close(); } catch (err) { /* ignore */ }
  socket = null;
  listenersAttached = false;
}

export default {
  getServerUrl,
  connectTo,
  getSocket,
  waitForConnection,
  probeHealth,
  fetchApi,
  emitAuthUser,
  closeSocket
};
