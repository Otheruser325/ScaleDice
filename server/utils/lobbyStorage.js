import { createClient } from '@supabase/supabase-js';
import { getStorageConfig } from './storageMode.js';
import { normalizeConfig } from './gameConfig.js';

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

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function toIso(value) {
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function toMillis(value) {
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toLobby(row) {
  if (!row) return null;
  const players = (Array.isArray(row.players) ? row.players : [])
    .filter((player) => player && player.id && !player.left)
    .map((player) => ({
      id: String(player.id),
      name: String(player.name || 'Player').slice(0, 32),
      type: player.type || 'guest',
      avatar: player.avatar || null,
      team: player.team === 'red' ? 'red' : player.team === 'blue' ? 'blue' : null,
      ready: false,
      left: false,
      connected: false
    }));

  return {
    code: normalizeCode(row.code),
    hostUserId: row.host_user_id == null ? null : String(row.host_user_id),
    // A restored lobby has no live sockets until players reconnect.
    hostSocketId: null,
    players,
    config: normalizeConfig(row.config || {}),
    starting: false,
    finished: !!row.finished,
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at)
  };
}

function toRow(lobby) {
  if (!lobby?.code) throw new Error('Lobby must include a code');
  return {
    code: normalizeCode(lobby.code),
    host_user_id: String(lobby.hostUserId || ''),
    host_socket_id: lobby.hostSocketId || null,
    players: Array.isArray(lobby.players) ? lobby.players : [],
    config: normalizeConfig(lobby.config || {}),
    starting: !!lobby.starting,
    finished: !!lobby.finished,
    created_at: toIso(lobby.createdAt),
    updated_at: toIso(lobby.updatedAt)
  };
}

function snapshotLobby(lobby) {
  return toLobby(toRow(lobby));
}

function storageError(action, error) {
  const detail = error?.message ? `: ${error.message}` : '';
  return new Error(`[lobbyStorage] Supabase ${action} failed${detail}`);
}

/**
 * Lobby snapshots are persisted for discovery/recovery. Live turn state remains
 * in LobbyManager memory; it is not written to the database on every roll.
 */
export function createLobbyStore(options = {}) {
  const config = options.config || getStorageConfig();
  const mode = options.mode || config.mode;
  const timeoutMs = Number(options.timeoutMs || config.operationTimeoutMs || 5000);
  const client = options.supabase ?? (mode === 'supabase' ? makeSupabaseClient(config) : null);
  if (mode === 'supabase' && !client) throw new Error('Supabase lobby storage is active but no client is available');

  // The local online mode is deliberately process-memory only. LobbyManager owns
  // the authoritative live map; this second map makes the adapter contract clear
  // and gives tests a real in-memory database to exercise.
  const memory = new Map();

  async function supabaseCall(action, build) {
    try {
      const { data, error } = await withTimeout(build(), timeoutMs, action);
      if (error) throw error;
      return data;
    } catch (err) {
      if (err?.message?.startsWith('[lobbyStorage]')) throw err;
      throw storageError(action, err);
    }
  }

  return {
    mode,
    persistent: mode === 'supabase',

    async loadAll() {
      if (client) {
        const data = await supabaseCall('loadAll', () => client.from('lobbies').select('*'));
        const map = {};
        for (const row of data || []) {
          const lobby = toLobby(row);
          if (lobby?.code) map[lobby.code] = lobby;
        }
        return map;
      }

      const map = {};
      for (const [code, lobby] of memory.entries()) {
        map[code] = snapshotLobby(lobby);
      }
      return map;
    },

    async save(lobby) {
      if (!lobby?.code) throw new Error('Lobby must include a code');
      if (client) {
        const data = await supabaseCall('save', () => (
          client.from('lobbies').upsert([toRow(lobby)], { onConflict: 'code' }).select('*').single()
        ));
        if (!data) throw new Error('[lobbyStorage] Supabase save did not return the saved lobby');
        return toLobby(data);
      }

      const snapshot = snapshotLobby(lobby);
      if (snapshot) memory.set(snapshot.code, snapshot);
      return snapshot;
    },

    async delete(code) {
      const normalized = normalizeCode(code);
      if (!normalized) return;
      if (client) {
        await supabaseCall('delete', () => client.from('lobbies').delete().eq('code', normalized));
        return;
      }
      memory.delete(normalized);
    }
  };
}

export default createLobbyStore;
