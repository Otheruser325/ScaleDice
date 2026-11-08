import { createClient } from '@supabase/supabase-js';
import { getStorageConfig } from './storageMode.js';

// Online accounts use Supabase when the server has both server-only
// credentials. Otherwise they live in this process's memory and are discarded on
// restart, matching the local online mode.
const PUBLIC_FIELDS = ['id', 'name', 'type', 'avatar', 'oauthProvider', 'createdAt', 'updatedAt', 'country'];
const LOOKUP_FIELDS = new Set(['id', 'name', 'oauthProvider', 'oauthProviderId']);

function withTimeout(promise, timeoutMs, operationName) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function makeSupabaseClient(config) {
  if (!config?.url || !config?.key) {
    throw new Error('Supabase storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function toUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    type: row.type || 'guest',
    guestPassword: row.guest_password ?? row.guestPassword ?? null,
    oauthProvider: row.oauth_provider ?? row.oauthProvider ?? null,
    oauthProviderId: row.oauth_provider_id ?? row.oauthProviderId ?? null,
    avatar: row.avatar ?? null,
    country: row.country ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function toRow(user) {
  if (!user?.id) throw new Error('User must include an id');
  const now = new Date().toISOString();
  return {
    id: String(user.id),
    name: String(user.name || 'Player').slice(0, 32),
    type: String(user.type || 'guest'),
    guest_password: user.guestPassword ?? null,
    oauth_provider: user.oauthProvider ?? null,
    oauth_provider_id: user.oauthProviderId == null ? null : String(user.oauthProviderId),
    avatar: user.avatar ?? null,
    country: user.country ?? null,
    created_at: user.createdAt || now,
    updated_at: user.updatedAt || now
  };
}

function escapeLike(value) {
  return String(value).replace(/([\\%_])/g, '\\$1');
}

function storageError(action, error) {
  const detail = error?.message ? `: ${error.message}` : '';
  return new Error(`[userStorage] Supabase ${action} failed${detail}`);
}

export function createUserStore(options = {}) {
  const config = options.config || getStorageConfig();
  const mode = options.mode || config.mode;
  const timeoutMs = Number(options.timeoutMs || config.operationTimeoutMs || 5000);
  const client = options.supabase ?? (mode === 'supabase' ? makeSupabaseClient(config) : null);
  if (mode === 'supabase' && !client) throw new Error('Supabase storage is active but no client is available');

  const memory = new Map();

  async function supabaseCall(action, build) {
    try {
      const { data, error } = await withTimeout(build(), timeoutMs, action);
      if (error) throw error;
      return data;
    } catch (err) {
      if (err?.message?.startsWith('[userStorage]')) throw err;
      throw storageError(action, err);
    }
  }

  return {
    mode,
    persistent: mode === 'supabase',

    async findById(id) {
      if (!id) return null;
      if (client) {
        const data = await supabaseCall('findById', () => (
          client.from('users').select('*').eq('id', String(id)).maybeSingle()
        ));
        return toUser(data);
      }
      return memory.get(String(id)) || null;
    },

    async findByField(field, value) {
      if (!LOOKUP_FIELDS.has(field) || value === undefined || value === null) return [];
      const expected = String(value).toLowerCase();

      if (client) {
        let query;
        if (field === 'name') {
          query = client.from('users').select('*').ilike('name', escapeLike(value));
        } else if (field === 'oauthProviderId') {
          query = client.from('users').select('*').eq('oauth_provider_id', String(value));
        } else if (field === 'oauthProvider') {
          query = client.from('users').select('*').eq('oauth_provider', String(value));
        } else {
          query = client.from('users').select('*').eq('id', String(value));
        }
        const data = await supabaseCall(`findByField(${field})`, () => query);
        return (data || [])
          .map(toUser)
          .filter((user) => user && (field !== 'name' || String(user.name || '').toLowerCase() === expected));
      }

      return [...memory.values()].filter(
        (user) => user && String(user[field] ?? '').toLowerCase() === expected
      );
    },

    async save(user) {
      if (!user?.id) throw new Error('User must include an id');
      if (client) {
        const data = await supabaseCall('save', () => (
          client.from('users').upsert([toRow(user)], { onConflict: 'id' }).select('*').single()
        ));
        if (!data) throw new Error('[userStorage] Supabase save did not return the saved account');
        const saved = toUser(data);
        if (!saved) throw new Error('[userStorage] Supabase save returned an empty account');
        return saved;
      }

      const saved = { ...user, id: String(user.id) };
      memory.set(saved.id, saved);
      return saved;
    },

    async count() {
      if (client) {
        try {
          const { count, error } = await withTimeout(
            client.from('users').select('id', { count: 'exact', head: true }),
            timeoutMs,
            'count'
          );
          if (error) throw error;
          return Number(count) || 0;
        } catch (err) {
          throw storageError('count', err);
        }
      }
      return memory.size;
    }
  };
}

const defaultStore = createUserStore();

if (defaultStore.persistent) {
  console.log('[userStorage] mode=supabase');
} else {
  if (defaultStore.mode === 'memory' && getStorageConfig().incompleteSupabase) {
    console.warn('[userStorage] Supabase credentials are incomplete; using in-memory accounts');
  }
  console.log('[userStorage] mode=memory (accounts are discarded on restart)');
}

export const userStorageMode = defaultStore.mode;
export const userStore = defaultStore;
export const findUserById = (id) => defaultStore.findById(id);
export const findUsersByField = (field, value) => defaultStore.findByField(field, value);
export const saveUser = (user) => defaultStore.save(user);

// Never return password hashes or provider tokens to a browser.
export function publicUser(user) {
  if (!user) return null;
  const safe = {};
  for (const field of PUBLIC_FIELDS) {
    if (user[field] !== undefined && user[field] !== null) safe[field] = user[field];
  }
  return safe;
}

export default {
  createUserStore,
  userStore,
  userStorageMode,
  findUserById,
  findUsersByField,
  saveUser,
  publicUser
};
