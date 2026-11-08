import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeIO } from './support/fakeIo.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { getStorageConfig } = await import('../server/utils/storageMode.js');
const { createUserStore, publicUser } = await import('../server/utils/userStorage.js');
const { createLobbyStore } = await import('../server/utils/lobbyStorage.js');
const { default: LobbyManager } = await import('../server/lobbyManager.js');

class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.op = null;
    this.rows = [];
    this.filters = [];
    this.options = {};
  }

  select(columns, options = {}) {
    // Supabase keeps the mutation operation when .select() is used to return
    // the upserted/deleted rows; only a standalone select starts a read.
    if (!this.op) this.op = 'select';
    this.columns = columns;
    this.options = options;
    return this;
  }

  upsert(rows, options = {}) {
    this.op = 'upsert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    this.conflict = options.onConflict || 'id';
    return this;
  }

  delete() {
    this.op = 'delete';
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: 'eq', column, value: String(value) });
    return this;
  }

  ilike(column, value) {
    this.filters.push({ type: 'ilike', column, value: String(value) });
    return this;
  }

  maybeSingle() {
    return this.execute().then(({ data, error }) => ({
      data: Array.isArray(data) ? data[0] ?? null : data,
      error
    }));
  }

  single() {
    return this.execute().then(({ data, error }) => ({
      data: Array.isArray(data) ? data[0] ?? null : data,
      error
    }));
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  matches(row) {
    return this.filters.every((filter) => {
      const actual = String(row[filter.column] ?? '').toLowerCase();
      if (filter.type === 'ilike') {
        const expected = filter.value.replace(/\\([\\%_])/g, '$1').toLowerCase();
        return actual === expected;
      }
      return actual === filter.value.toLowerCase();
    });
  }

  async execute() {
    const table = this.db.tables[this.table];
    if (!table) return { data: null, error: { message: `relation "${this.table}" does not exist` } };

    if (this.op === 'upsert') {
      for (const row of this.rows) {
        const key = String(row[this.conflict] ?? '');
        if (!key) return { data: null, error: { message: 'missing conflict key' } };
        table.set(key, { ...row });
      }
      return { data: this.rows.map((row) => ({ ...row })), error: null };
    }

    if (this.op === 'delete') {
      for (const [key, row] of table.entries()) {
        if (this.matches(row)) table.delete(key);
      }
      return { data: null, error: null };
    }

    const rows = [...table.values()].filter((row) => this.matches(row));
    if (this.options?.head) return { data: null, error: null, count: rows.length };
    return { data: rows.map((row) => ({ ...row })), error: null };
  }
}

function fakeSupabase() {
  return {
    tables: {
      users: new Map(),
      lobbies: new Map()
    },
    from(table) {
      return new FakeQuery(this, table);
    }
  };
}

test('storage mode selects Supabase only when complete credentials are present', () => {
  assert.equal(getStorageConfig({}).mode, 'memory');
  assert.equal(
    getStorageConfig({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    }).mode,
    'supabase'
  );
  assert.equal(
    getStorageConfig({
      STORAGE_MODE: 'memory',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    }).mode,
    'memory'
  );
  assert.throws(() => getStorageConfig({ STORAGE_MODE: 'supabase' }), /requires SUPABASE_URL/);
  assert.equal(
    getStorageConfig({
      SUPABASE_URL: 'https://example.supabase.co'
    }).incompleteSupabase,
    true
  );
});

test('local user storage is process-memory only and hides password hashes', async () => {
  const store = createUserStore({ mode: 'memory' });
  assert.equal(store.persistent, false);

  const saved = await store.save({
    id: 'u1',
    name: 'Guest123456789',
    type: 'guest',
    guestPassword: 'scrypt$salt$hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });

  assert.equal(saved.id, 'u1');
  assert.equal((await store.findById('u1')).name, 'Guest123456789');
  assert.equal((await store.findByField('name', 'guest123456789')).length, 1);
  assert.equal(publicUser(saved).guestPassword, undefined);
  assert.equal(await createUserStore({ mode: 'memory' }).findById('u1'), null);
});

test('Supabase user storage maps account rows and supports case-insensitive lookup', async () => {
  const client = fakeSupabase();
  const store = createUserStore({ mode: 'supabase', supabase: client, timeoutMs: 1000 });

  await store.save({
    id: 'u2',
    name: 'Guest987654321',
    type: 'guest',
    guestPassword: 'scrypt$salt$hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });

  const row = client.tables.users.get('u2');
  assert.equal(row.guest_password, 'scrypt$salt$hash');
  assert.equal(row.name, 'Guest987654321');

  const byName = await store.findByField('name', 'guest987654321');
  assert.equal(byName.length, 1);
  assert.equal(byName[0].id, 'u2');
  assert.equal((await store.findById('u2')).guestPassword, 'scrypt$salt$hash');
  assert.equal(publicUser(await store.findById('u2')).guestPassword, undefined);
});

test('lobby storage uses a real in-memory map locally and Supabase rows when active', async () => {
  const lobby = {
    code: 'abc123',
    hostUserId: 'u1',
    hostSocketId: 's1',
    players: [{ id: 'u1', name: 'Host', type: 'guest', ready: true, connected: true }],
    config: { players: 2, rounds: 10 },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const local = createLobbyStore({ mode: 'memory' });
  const localSaved = await local.save(lobby);
  assert.equal(localSaved.code, 'ABC123');
  assert.equal(localSaved.players[0].ready, false);
  assert.equal(localSaved.config.rounds, 10);
  assert.equal((await local.loadAll()).ABC123.config.rounds, 10);
  await local.delete('ABC123');
  assert.deepEqual(await local.loadAll(), {});

  const client = fakeSupabase();
  const remote = createLobbyStore({ mode: 'supabase', supabase: client, timeoutMs: 1000 });
  await remote.save(lobby);
  const row = client.tables.lobbies.get('ABC123');
  assert.equal(row.host_user_id, 'u1');
  assert.equal(row.players.length, 1);
  assert.equal(row.config.rounds, 10);

  const loaded = await remote.loadAll();
  assert.equal(loaded.ABC123.code, 'ABC123');
  assert.equal(loaded.ABC123.players[0].connected, false);
  await remote.delete('ABC123');
  assert.equal(client.tables.lobbies.size, 0);
});

test('lobby manager restores persisted lobbies and writes lobby changes through', async () => {
  const io = new FakeIO();
  const writes = [];
  const deletes = [];
  const store = {
    mode: 'supabase',
    persistent: true,
    async loadAll() {
      return {
        OLD123: {
          code: 'OLD123',
          hostUserId: 'u1',
          players: [
            { id: 'u1', name: 'Host', type: 'guest' },
            { id: 'u2', name: 'Guest', type: 'guest' }
          ],
          config: { players: 2, rounds: 10 },
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      };
    },
    async save(lobby) {
      writes.push(lobby.code);
      return lobby;
    },
    async delete(code) {
      deletes.push(code);
    }
  };

  const manager = new LobbyManager(io, {
    lobbyStore: store,
    rateLimit: false,
    pruneIntervalMs: 0,
    rollDelayMs: 2,
    startDelayMs: 2,
    rollGraceMs: 100,
    cleanupDelayMs: 5
  });
  await manager.init();

  assert.ok(manager.lobbies.OLD123, 'stored lobby should be restored');
  assert.equal(manager.lobbies.OLD123.hostSocketId, null);
  assert.equal(manager.lobbies.OLD123.players[0].connected, false);
  assert.equal(manager.lobbies.OLD123.players[0].ready, false);

  const host = io.addSocket('s1', { id: 'u1', name: 'Host', type: 'guest' });
  const guest = io.addSocket('s2', { id: 'u2', name: 'Guest', type: 'guest' });
  manager.registerSocket(host);
  manager.registerSocket(guest);

  await host.handlers.get('create-lobby')[0]({ players: 2, rounds: 10 });
  const code = host.last('lobby-created').code;
  assert.ok(writes.includes(code), 'create should write the lobby');

  await guest.handlers.get('join-lobby')[0](code);
  assert.equal(manager.lobbies[code].players.length, 2);
  await host.handlers.get('toggle-ready')[0](code);
  await guest.handlers.get('toggle-ready')[0](code);
  assert.ok(writes.filter((entry) => entry === code).length >= 3, 'join/ready should persist');

  await host.handlers.get('leave-lobby')[0](code);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(manager.lobbies[code].hostUserId, 'u2');
  assert.ok(writes.filter((entry) => entry === code).length >= 4, 'host transfer should persist');
  manager.dispose();
});

test('a failed Supabase lobby write fails closed instead of creating a memory-only lobby', async () => {
  const io = new FakeIO();
  const manager = new LobbyManager(io, {
    lobbyStore: {
      mode: 'supabase',
      persistent: true,
      async loadAll() { return {}; },
      async save() { throw new Error('database unavailable'); },
      async delete() {}
    },
    rateLimit: false,
    pruneIntervalMs: 0
  });
  await manager.init();

  const host = io.addSocket('s1', { id: 'u1', name: 'Host', type: 'guest' });
  manager.registerSocket(host);
  await host.handlers.get('create-lobby')[0]({ players: 2, rounds: 10 });

  assert.equal(host.last('create-failed').reason, 'storage_unavailable');
  assert.equal(Object.keys(manager.lobbies).length, 0);
  manager.dispose();
});

test('a stale persisted lobby is not restored into a new process', async () => {
  const io = new FakeIO();
  const deletes = [];
  const manager = new LobbyManager(io, {
    lobbyStore: {
      mode: 'supabase',
      persistent: true,
      async loadAll() {
        return {
          OLD999: {
            code: 'OLD999',
            hostUserId: 'u1',
            players: [{ id: 'u1', name: 'Host', type: 'guest' }],
            config: { players: 2, rounds: 10 },
            createdAt: Date.now() - 4 * 60 * 60 * 1000,
            updatedAt: Date.now() - 4 * 60 * 60 * 1000
          }
        };
      },
      async save() {},
      async delete(code) { deletes.push(code); }
    },
    rateLimit: false,
    pruneIntervalMs: 0
  });

  await manager.init();
  assert.equal(manager.lobbies.OLD999, undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(deletes, ['OLD999']);
  manager.dispose();
});
