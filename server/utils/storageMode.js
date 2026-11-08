import '../env.js';

const VALID_MODES = new Set(['auto', 'supabase', 'memory', 'local']);

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

function timeoutMs(env) {
  const parsed = Number(env.SUPABASE_OPERATION_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed < 250) return 5000;
  return Math.min(30000, parsed);
}

/**
 * Resolve the online storage backend from the environment.
 *
 * `auto` (the default) uses Supabase only when both server-only credentials are
 * present. Otherwise online data lives in the process memory and is intentionally
 * discarded on restart. An explicit `STORAGE_MODE=supabase` without credentials
 * fails loudly instead of silently mixing backends.
 */
export function getStorageConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const requested = String(env.STORAGE_MODE || env.USER_STORAGE_MODE || 'auto').trim().toLowerCase();

  if (!VALID_MODES.has(requested)) {
    throw new Error(`Unsupported STORAGE_MODE "${requested}". Use auto, supabase, or memory.`);
  }

  if (url && !isHttpUrl(url)) {
    throw new Error('SUPABASE_URL must be an http(s) URL');
  }

  const hasCredentials = Boolean(url && key);
  let mode;

  if (requested === 'memory' || requested === 'local') {
    mode = 'memory';
  } else if (requested === 'supabase') {
    if (!hasCredentials) {
      throw new Error('STORAGE_MODE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }
    mode = 'supabase';
  } else {
    mode = hasCredentials ? 'supabase' : 'memory';
  }

  return {
    mode,
    requested,
    hasCredentials,
    url,
    key,
    operationTimeoutMs: timeoutMs(env),
    // Incomplete credentials are a common deployment mistake; surface it without
    // printing either value or silently treating a half-configured Supabase as active.
    incompleteSupabase: Boolean(url || key) && !hasCredentials
  };
}

export const storageConfig = getStorageConfig();

export default getStorageConfig;
