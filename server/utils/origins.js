// Origin policy shared by CORS, Socket.IO handshakes and the auth router.
// Browsers can set Origin arbitrarily, so every value that arrives here is
// validated instead of trusted.

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function normalizeOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch (err) {
    return null;
  }
}

export function configuredOrigins() {
  const raw = typeof process.env.CLIENT_ORIGINS === 'string' ? process.env.CLIENT_ORIGINS : '';
  const configured = raw
    .split(',')
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter(Boolean);

  // A single canonical client URL is also accepted for small deployments.
  const single = normalizeOrigin(process.env.CLIENT_URL);
  return [...new Set([...configured, ...(single ? [single] : [])])];
}

export function isLoopbackOrigin(origin) {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch (err) {
    return false;
  }
}

export function isAllowedOrigin(origin) {
  // Requests without an Origin header are same-origin or non-browser clients.
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (configuredOrigins().includes(normalized)) return true;

  // Development keeps the dynamic-port convenience, including preview hosts on
  // the machine (they still have to present an Origin the server accepts).
  if (process.env.NODE_ENV !== 'production') {
    if (isLoopbackOrigin(normalized)) return true;
    try {
      const hostname = new URL(normalized).hostname.toLowerCase();
      if (hostname.endsWith('.style.dev')) return true;
    } catch (err) {
      return false;
    }
  }

  return false;
}

// A page served by this same process is same-origin even if the deployment did
// not list itself in CLIENT_ORIGINS. Comparing the Host header is safe here
// because a forged Host already means the attacker reached this server directly.
export function isSameOriginRequest(origin, req) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  try {
    return new URL(normalized).host.toLowerCase() === String(req?.headers?.host || '').toLowerCase();
  } catch (err) {
    return false;
  }
}

export function isAllowedRequestOrigin(origin, req) {
  if (!origin) return true;
  return isAllowedOrigin(origin) || isSameOriginRequest(origin, req);
}

export function getPublicServerOrigin() {
  const explicit = normalizeOrigin(process.env.PUBLIC_SERVER_URL);
  if (explicit) return explicit;
  return `http://localhost:${Number(process.env.PORT) || 8080}`;
}

export function getClientRedirectBase() {
  const explicit = normalizeOrigin(process.env.CLIENT_URL)
    || normalizeOrigin(process.env.AUTH_SUCCESS_REDIRECT_URL)
    || configuredOrigins()[0];
  if (explicit) return explicit;
  return getPublicServerOrigin();
}

export default {
  normalizeOrigin,
  configuredOrigins,
  isAllowedOrigin,
  isSameOriginRequest,
  isAllowedRequestOrigin,
  getPublicServerOrigin,
  getClientRedirectBase
};
