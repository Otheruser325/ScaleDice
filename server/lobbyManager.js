import { randomInt, randomUUID } from 'node:crypto';
import { rollDice, baseScore, DICE_COUNT } from './utils/dice.js';
import { checkCombo, createComboStats } from './utils/combo.js';
import { normalizeConfig } from './utils/gameConfig.js';
import {
  COMBO_KEYS,
  COMBO_REQUIREMENTS,
  MAX_DICE,
  MAX_LUCK_LEVEL,
  createProgression
} from './utils/progression.js';
import { createLobbyStore } from './utils/lobbyStorage.js';

export { normalizeConfig };

// Lobby codes are the only thing protecting a room from unwanted joins, so they
// come from a CSPRNG. Look-alike characters are skipped to keep codes readable.
export const LOBBY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateLobbyCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += LOBBY_CODE_ALPHABET[randomInt(0, LOBBY_CODE_ALPHABET.length)];
  }
  return code;
}

export function sanitizeUser(user) {
  if (!user?.id) return null;
  return {
    id: String(user.id).trim(),
    name: (user.name && String(user.name).trim().substring(0, 32)) || `Guest${String(user.id).substring(0, 6)}`,
    type: (user.type && String(user.type).trim()) || 'guest',
    avatar: typeof user.avatar === 'string' && user.avatar ? user.avatar : null
  };
}

const MAX_LOBBIES = 500;
const MAX_LOBBIES_PER_USER = 3;
const LOBBY_TTL_MS = 3 * 60 * 60 * 1000;

function normalizeTeam(value) {
  return value === 'blue' || value === 'red' ? value : null;
}

function nextTeam(players = []) {
  const active = players.filter((player) => player && !player.left);
  const blue = active.filter((player) => player.team === 'blue').length;
  const red = active.filter((player) => player.team === 'red').length;
  return blue <= red ? 'blue' : 'red';
}

function fillMissingTeams(players = []) {
  for (const player of players) {
    if (!player || player.left || normalizeTeam(player.team)) continue;
    player.team = nextTeam(players);
  }
}

function teamsAreValid(players = []) {
  const active = players.filter((player) => player && !player.left);
  if (!active.length) return false;
  if (active.some((player) => !normalizeTeam(player.team))) return false;

  const blue = active.filter((player) => player.team === 'blue').length;
  const red = active.filter((player) => player.team === 'red').length;
  return blue > 0 && red > 0 && Math.abs(blue - red) <= 1;
}

function teamTotals(players = [], enabled = false) {
  if (!enabled) return null;
  const totals = { blue: 0, red: 0 };
  for (const player of players) {
    if (player?.team === 'blue') totals.blue += Number(player.score) || 0;
    if (player?.team === 'red') totals.red += Number(player.score) || 0;
  }
  return totals;
}

function winnerFromTotals(totals) {
  if (!totals || totals.blue === totals.red) return null;
  return totals.blue > totals.red ? 'blue' : 'red';
}

export default class LobbyManager {
  constructor(io, options = {}) {
    this.io = io;
    this.lobbies = {};
    this.activeGames = {};

    this.rateLimitEnabled = options.rateLimit !== false;
    this.rateBuckets = new Map();
    this._timers = new Set();
    this.lobbyStore = options.lobbyStore || createLobbyStore();
    this.storageMode = this.lobbyStore.mode;
    this._initPromise = null;
    this._restored = false;
    console.log(`[LobbyManager] lobby storage mode=${this.storageMode}`);

    // Timings are injectable so regression tests do not wait for real turns.
    this.rollDelayMs = options.rollDelayMs ?? 700;
    this.rollGraceMs = options.rollGraceMs ?? 10000;
    this.timeoutGraceMs = options.timeoutGraceMs ?? 3000;
    this.startDelayMs = options.startDelayMs ?? 120;
    this.cleanupDelayMs = options.cleanupDelayMs ?? 8000;
    this.pruneIntervalMs = options.pruneIntervalMs ?? 5 * 60 * 1000;
    this.now = options.now || (() => Date.now());
    this.roll = options.roll || ((count = DICE_COUNT) => rollDice(count));
    // Server-side randomness for luck/prediction/spin effects. Tests can inject
    // a deterministic stream; production uses a CSPRNG-derived float.
    this.random = options.random || (() => randomInt(0, 1_000_000) / 1_000_000);

    if (this.pruneIntervalMs > 0) {
      this._pruneHandle = setInterval(() => this.pruneInMemoryLobbies(), this.pruneIntervalMs);
      if (typeof this._pruneHandle.unref === 'function') this._pruneHandle.unref();
    }
  }

  // -------------------------------------------------------------------------
  // Persisted lobby restore / write-through
  // -------------------------------------------------------------------------

  async init() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        const stored = await this.lobbyStore.loadAll();
        const now = this.now();
        let restored = 0;

        for (const raw of Object.values(stored || {})) {
          const code = String(raw?.code || '').trim().toUpperCase();
          const players = Array.isArray(raw?.players) ? raw.players : [];
          const stale = !raw || !players.length || raw.finished ||
            now - (raw.updatedAt || raw.createdAt || 0) > LOBBY_TTL_MS;

          if (stale) {
            if (code) this._deletePersistedLobby(code);
            continue;
          }
          if (this.lobbies[code] || this.activeGames[code]) continue;
          if (Object.keys(this.lobbies).length >= MAX_LOBBIES) break;

          const hostUserId = raw.hostUserId && players.some((p) => String(p.id) === String(raw.hostUserId))
            ? String(raw.hostUserId)
            : String(players[0].id);

          const restoredLobby = {
            ...raw,
            code,
            hostUserId,
            hostSocketId: null,
            players: players.map((player) => ({ ...player, ready: false, connected: false, team: normalizeTeam(player.team) })),
            config: normalizeConfig(raw.config),
            starting: false
          };
          if (restoredLobby.config.teams) fillMissingTeams(restoredLobby.players);
          this.lobbies[code] = restoredLobby;
          restored += 1;
        }

        if (restored) {
          console.log(`[LobbyManager] restored ${restored} lobby/lobbies from ${this.storageMode} storage`);
        }
      } catch (err) {
        console.warn(
          `[LobbyManager] lobby restore failed (${this.storageMode}); continuing in memory:`,
          err?.message || err
        );
      } finally {
        this._restored = true;
      }
    })();

    return this._initPromise;
  }

  _persistLobby(code, { throwOnError = false } = {}) {
    const lobby = this.lobbies[code];
    if (!lobby || !this.lobbyStore?.save) return Promise.resolve(null);

    const pending = Promise.resolve().then(() => this.lobbyStore.save(lobby));
    if (throwOnError) return pending;

    return pending.catch((err) => {
      console.warn(`[LobbyManager] could not persist lobby ${code}:`, err?.message || err);
      return null;
    });
  }

  _deletePersistedLobby(code) {
    if (!this.lobbyStore?.delete) return Promise.resolve();
    return Promise.resolve()
      .then(() => this.lobbyStore.delete(code))
      .catch((err) => {
        console.warn(`[LobbyManager] could not remove persisted lobby ${code}:`, err?.message || err);
      });
  }

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  schedule(fn, delayMs) {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      try {
        fn();
      } catch (err) {
        console.error('[LobbyManager] scheduled task failed:', err);
      }
    }, Math.max(0, delayMs));
    if (typeof timer.unref === 'function') timer.unref();
    this._timers.add(timer);
    return timer;
  }

  clearTimer(timer) {
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(timer);
    }
  }

  getUserId(socket) {
    return socket?.data?.user?.id ? String(socket.data.user.id) : null;
  }

  // Socket identity comes only from the authenticated HTTP session. Client
  // payloads can describe a user, but they can never establish one.
  ensureAuthenticated(socket, emit = true) {
    const authoritative = sanitizeUser(socket?.request?.user);
    if (!authoritative) {
      socket.data.user = null;
      socket.data.authEmitted = false;
      return false;
    }

    socket.data.user = authoritative;
    socket.data.lastHeartbeat = this.now();
    if (emit) {
      socket.data.authEmitted = true;
      socket.emit('auth-success', {
        user: authoritative,
        socketid: socket.id,
        timestamp: this.now(),
        verified: true
      });
    }
    return true;
  }

  requireAuth(socket, eventName, options = {}) {
    if (this.ensureAuthenticated(socket)) return true;
    socket.emit('auth-required', {
      event: eventName,
      message: 'Please sign in before playing online.',
      code: 'AUTH_REQUIRED',
      retryable: !!options.retryable
    });
    return false;
  }

  consumeSocketRate(socket, action, limit, windowMs = 60 * 1000) {
    if (!this.rateLimitEnabled) return false;

    const address = String(
      socket?.data?.clientKey || socket?.request?.socket?.remoteAddress || socket?.handshake?.address || socket?.id || 'unknown'
    ).replace(/^::ffff:/, '');
    const key = `${action}:${address}`;
    const now = this.now();
    let bucket = this.rateBuckets.get(key);

    if (!bucket || now - bucket.startedAt >= windowMs) {
      if (this.rateBuckets.size >= 5000) this.rateBuckets.delete(this.rateBuckets.keys().next().value);
      bucket = { startedAt: now, count: 0 };
      this.rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count > limit;
  }

  isLobbyMember(lobby, socket) {
    const uid = this.getUserId(socket);
    if (!lobby || !uid) return false;
    if (lobby.hostUserId && String(lobby.hostUserId) === uid) return true;
    return Array.isArray(lobby.players) && lobby.players.some((p) => p && String(p.id) === uid);
  }

  isGameMember(game, socket) {
    const uid = this.getUserId(socket);
    if (!game || !uid || !Array.isArray(game.players)) return false;
    return game.players.some((p) => p && String(p.id) === uid);
  }

  activePlayers(lobby) {
    return (lobby?.players || []).filter((p) => !p.left);
  }

  lobbyPlayersPayload(lobby) {
    return this.activePlayers(lobby).map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type || 'guest',
      avatar: p.avatar || null,
      team: normalizeTeam(p.team),
      ready: !!p.ready,
      connected: p.connected !== false
    }));
  }

  teamState(game) {
    const enabled = !!game?.config?.teams;
    const totals = teamTotals(game?.players, enabled);
    return {
      teamsEnabled: enabled,
      teams: (game?.players || []).map((player) => normalizeTeam(player.team)),
      teamScores: totals
    };
  }

  broadcastLobbyUpdate(code) {
    const lobby = this.lobbies[code];
    if (!lobby) return;
    this.io.to(code).emit('lobby-updated', {
      code,
      players: this.lobbyPlayersPayload(lobby),
      hostUserId: lobby.hostUserId,
      hostSocketId: lobby.hostSocketId,
      config: lobby.config,
      updatedAt: lobby.updatedAt || this.now()
    });
  }

  diceCountFor(game, player) {
    return player?.progression?.diceUnlocked || 1;
  }

  // The shop is public information, but it is personalized so the client can
  // render the local player's exact costs without inventing them. The server
  // still re-checks every cost and affordability on purchase.
  shopPayload(game, player) {
    if (!player?.progression) return null;
    const p = player.progression;
    const combos = COMBO_KEYS.map((key) => ({
      key,
      level: p.getComboLevel(key),
      requirement: COMBO_REQUIREMENTS[key] ?? 0,
      cost: p.getComboCost(key),
      available: p.diceUnlocked >= (COMBO_REQUIREMENTS[key] ?? 0)
    }));
    const big = p.bigUpgradeDefs.map((def) => ({
      key: def.key,
      title: def.title || def.key,
      effect: def.effect || null,
      value: def.value,
      values: def.values || null,
      investmentCap: def.investmentCap,
      baseCost: def.baseCost,
      cost: p.getBigUpgradeCost(def.key),
      purchased: p.hasBigUpgrade(def.key)
    }));
    return {
      dice: {
        current: p.diceUnlocked,
        next: p.diceUnlocked < MAX_DICE ? p.diceUnlocked + 1 : null,
        cost: p.getNextDiceCost(),
        max: MAX_DICE
      },
      economy: {
        level: p.getEconomyLevel(),
        cap: p.getEconomyCap(),
        cost: p.getEconomyCost(),
        income: Math.floor(
          p.getEconomyIncome() *
          p.getEconomyMultiplier() *
          p.getHighStonksMultiplier(Math.max(0, game.round - 1))
        )
      },
      luck: {
        level: p.getLuckLevel(),
        effective: p.getEffectiveLuck(),
        cost: p.getLuckCost(),
        maxLevel: MAX_LUCK_LEVEL
      },
      combos,
      big
    };
  }

  emitToPlayer(code, userId, event, payload) {
    try {
      const room = this.io?.sockets?.adapter?.rooms?.get(code);
      if (!room) return;
      for (const socketId of room) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket && String(socket.data?.user?.id) === String(userId)) {
          socket.emit(event, payload);
        }
      }
    } catch (err) {
      console.warn('[LobbyManager] player emit failed:', err?.message || err);
    }
  }

  gameStatePayload(game, code, localIndex = null) {
    const payload = {
      room: code,
      players: game.players.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type || 'guest',
        avatar: p.avatar || null,
        team: normalizeTeam(p.team),
        playerIcon: p.playerIcon || null,
        score: p.score,
        comboStats: p.comboStats,
        progression: p.progression ? p.progression.toPublic(game.round) : null,
        diceUnlocked: this.diceCountFor(game, p),
        left: !!p.left,
        connected: p.connected !== false
      })),
      scores: game.players.map((p) => p.score),
      comboStats: game.players.map((p) => p.comboStats),
      ...this.teamState(game),
      round: game.round,
      totalRounds: game.totalRounds,
      currentPlayerIndex: game.currentIndex,
      currentPlayerHasRolled: !!game.players[game.currentIndex]?.hasRolled,
      currentPlayerRolling: !!game.rollInProgress,
      timeLimitSeconds: game.timeLimitSeconds,
      turnExpiresAt: game.turnExpiresAt || null,
      progressionEnabled: true,
      shop: Number.isInteger(localIndex) && game.players[localIndex]
        ? this.shopPayload(game, game.players[localIndex])
        : null,
      config: game.config,
      localIndex
    };

    // Clairvoyance is private to its owner. Only add it to that player's own
    // game-state payload, so a reconnect or a purchase refresh does not wipe
    // the prediction shown on their client (and other players never see it).
    if (Number.isInteger(localIndex) && game.currentIndex === localIndex) {
      const prediction = game.players[localIndex]?.prediction;
      if (Array.isArray(prediction) && prediction.length) {
        payload.prediction = prediction.slice();
      }
    }

    return payload;
  }

  emitGameState(code) {
    const game = this.activeGames[code];
    if (!game) return;

    try {
      const room = this.io?.sockets?.adapter?.rooms?.get(code);
      if (room && room.size) {
        for (const socketId of room) {
          const socket = this.io.sockets.sockets.get(socketId);
          if (!socket) continue;
          const localIndex = game.players.findIndex((p) => String(p.id) === this.getUserId(socket));
          socket.emit('game-state', this.gameStatePayload(game, code, localIndex >= 0 ? localIndex : null));
        }
        return;
      }
    } catch (err) {
      console.warn('[LobbyManager] personalized game-state failed:', err?.message || err);
    }

    this.io.to(code).emit('game-state', this.gameStatePayload(game, code));
  }

  // -------------------------------------------------------------------------
  // Socket registration
  // -------------------------------------------------------------------------

  registerSocket(socket) {
    socket.data = socket.data || {};
    socket.data.user = socket.data.user || null;
    socket.data.authAttempts = 0;
    socket.data.lastHeartbeat = this.now();

    if (this.ensureAuthenticated(socket, false)) {
      socket.emit('auth-success', {
        user: socket.data.user,
        socketid: socket.id,
        timestamp: this.now(),
        autoAuth: true,
        verified: true
      });
    }

    socket.on('ping', () => {
      socket.data.lastHeartbeat = this.now();
      socket.emit('pong', { timestamp: this.now() });
    });

    socket.on('clear-auth', () => socket.disconnect(true));

    socket.on('auth-user', (payload) => {
      socket.data.authAttempts = (socket.data.authAttempts || 0) + 1;
      const authoritative = sanitizeUser(socket.request?.user);

      if (!payload || !payload.id) {
        socket.data.user = null;
        socket.emit('auth-failed', {
          reason: 'missing_id',
          message: 'User ID is missing',
          attempt: socket.data.authAttempts
        });
        return;
      }

      if (!authoritative) {
        socket.data.user = null;
        socket.emit('auth-failed', {
          reason: 'session_required',
          message: 'Socket authentication requires a valid server session.',
          attempt: socket.data.authAttempts
        });
        return;
      }

      if (String(payload.id).trim() !== String(authoritative.id)) {
        socket.data.user = null;
        socket.emit('auth-failed', {
          reason: 'identity_mismatch',
          message: 'Socket identity does not match the authenticated session.',
          attempt: socket.data.authAttempts
        });
        return;
      }

      this.ensureAuthenticated(socket);
    });

    socket.on('create-lobby', (config) => this.handleCreateLobby(socket, config));
    socket.on('join-lobby', (code) => this.handleJoinLobby(socket, code));
    socket.on('request-lobby-data', (code) => this.handleRequestLobbyData(socket, code));
    socket.on('request-game-state', (payload) => this.handleRequestGameState(socket, payload));
    socket.on('toggle-ready', (code) => this.handleToggleReady(socket, code));
    socket.on('set-player-team', (payload) => this.handleSetPlayerTeam(socket, payload));
    socket.on('leave-lobby', (code) => this.handleLeaveLobby(socket, code));
    socket.on('start-game', (code) => this.handleStartGame(socket, code));
    socket.on('player-roll', (payload) => this.handlePlayerRoll(socket, payload));
    socket.on('player-end-turn', (payload) => this.handlePlayerEndTurn(socket, payload));
    socket.on('buy-upgrade', (payload) => this.handleBuyUpgrade(socket, payload));

    // The server timer alone decides when a turn expires; browser clocks can be
    // wrong, so client timeout notifications are intentionally ignored.
    socket.on('player-timeout', () => {});

    socket.on('game-finished', (code) => {
      socket.emit('game-finished-denied', {
        code: typeof code === 'string' ? code.trim().toUpperCase() : null,
        reason: 'server_authoritative'
      });
    });

    socket.on('disconnecting', async () => {
      const uid = socket.data?.user?.id;
      if (!uid) return;
      const codes = [...(socket.rooms || [])].filter((room) => room !== socket.id && !room.startsWith('session:'));
      await Promise.all(codes.map((code) => this.removePlayer(code, socket, { disconnecting: true })))
        .catch((err) => console.warn('[LobbyManager] disconnect cleanup failed:', err?.message || err));
    });
  }

  // -------------------------------------------------------------------------
  // Lobby lifecycle
  // -------------------------------------------------------------------------

  async handleCreateLobby(socket, rawConfig) {
    if (!this.requireAuth(socket, 'create-lobby')) {
      socket.emit('create-failed', { reason: 'unauthenticated', code: 'AUTH_REQUIRED' });
      return;
    }
    if (this.lobbyStore.persistent && !this._restored) await this.init();
    if (this.consumeSocketRate(socket, 'create-lobby', 5)) {
      socket.emit('create-failed', { reason: 'rate_limited', retryable: true });
      return;
    }
    if (Object.keys(this.lobbies).length >= MAX_LOBBIES) {
      socket.emit('create-failed', { reason: 'server_full', retryable: true });
      return;
    }
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
      socket.emit('create-failed', { reason: 'invalid_config' });
      return;
    }

    const uid = this.getUserId(socket);
    const owned = Object.values(this.lobbies).filter(
      (lobby) => String(lobby.hostUserId || '') === uid && !lobby.finished && !this.activeGames[lobby.code]
    ).length;
    if (owned >= MAX_LOBBIES_PER_USER) {
      socket.emit('create-failed', { reason: 'lobby_limit' });
      return;
    }

    const config = normalizeConfig(rawConfig);
    let code = null;
    for (let attempt = 0; attempt < 20 && !code; attempt += 1) {
      const candidate = generateLobbyCode(6);
      if (!this.lobbies[candidate] && !this.activeGames[candidate]) code = candidate;
    }
    if (!code) {
      socket.emit('create-failed', { reason: 'server_error' });
      return;
    }

    const user = socket.data.user;
    const lobby = {
      code,
      hostUserId: user.id,
      hostSocketId: socket.id,
      players: [{
        id: user.id,
        name: user.name,
        type: user.type || 'guest',
        avatar: user.avatar || null,
        team: config.teams ? 'blue' : null,
        ready: false,
        left: false,
        connected: true
      }],
      config,
      createdAt: this.now(),
      updatedAt: this.now()
    };

    // In Supabase mode a lobby is only acknowledged after its snapshot is
    // durable. Memory mode is synchronous and intentionally process-local.
    if (this.lobbyStore.persistent) {
      try {
        await this.lobbyStore.save(lobby);
      } catch (err) {
        console.error('[LobbyManager] create-lobby persistence failed:', err?.message || err);
        socket.emit('create-failed', { reason: 'storage_unavailable', retryable: true });
        return;
      }
    }

    this.lobbies[code] = lobby;
    socket.join(code);
    socket.emit('lobby-created', { code, timestamp: this.now() });
    this.broadcastLobbyUpdate(code);
    if (!this.lobbyStore.persistent) this._persistLobby(code);
  }

  async handleJoinLobby(socket, rawCode) {
    if (!this.requireAuth(socket, 'join-lobby', { retryable: true })) {
      socket.emit('join-failed', { reason: 'unauthenticated', retryable: true });
      return;
    }
    if (this.lobbyStore.persistent && !this._restored) await this.init();
    if (this.consumeSocketRate(socket, 'join-lobby', 30)) {
      socket.emit('join-failed', { reason: 'rate_limited', retryable: true });
      return;
    }
    if (typeof rawCode !== 'string' || rawCode.trim().length < 4 || rawCode.trim().length > 12) {
      socket.emit('join-failed', { reason: 'invalid_code' });
      return;
    }

    const code = rawCode.trim().toUpperCase();
    const lobby = this.lobbies[code];
    if (!lobby) {
      socket.emit('join-failed', { reason: 'notfound' });
      return;
    }
    // A completed/forfeited match lingers briefly for post-game screens; it is
    // not a lobby that new or returning players may enter.
    if (lobby.finished) {
      socket.emit('join-failed', { reason: 'game_started' });
      return;
    }

    const uid = this.getUserId(socket);
    const existing = lobby.players.find((p) => String(p.id) === uid);
    const game = this.activeGames[code];

    // A player who disconnected mid-game has forfeited; reconnecting starts a
    // new lobby instead of silently re-entering a running match.
    if (game && (!existing || existing.left)) {
      socket.emit('join-failed', { reason: 'game_started' });
      return;
    }

    const presentCount = this.activePlayers(lobby).length;
    if ((!existing || existing.left) && presentCount >= lobby.config.players) {
      socket.emit('join-failed', { reason: 'full' });
      return;
    }

    const user = socket.data.user;
    if (!existing) {
      lobby.players.push({
        id: user.id,
        name: user.name,
        type: user.type || 'guest',
        avatar: user.avatar || null,
        team: lobby.config.teams ? nextTeam(lobby.players) : null,
        ready: false,
        left: false,
        connected: true
      });
    } else if (existing.left) {
      existing.left = false;
      existing.connected = true;
      existing.ready = false;
      existing.name = user.name;
      existing.team = lobby.config.teams ? (normalizeTeam(existing.team) || nextTeam(lobby.players.filter((p) => p !== existing))) : null;
    } else {
      existing.connected = true;
      existing.name = user.name;
      if (lobby.config.teams && !normalizeTeam(existing.team)) existing.team = nextTeam(lobby.players.filter((p) => p !== existing));
    }

    lobby.updatedAt = this.now();
    socket.join(code);

    socket.emit('join-success', {
      code,
      players: this.lobbyPlayersPayload(lobby),
      hostUserId: lobby.hostUserId,
      hostSocketId: lobby.hostSocketId,
      config: lobby.config,
      currentUser: { id: user.id, name: user.name }
    });
    this.broadcastLobbyUpdate(code);
    this._persistLobby(code);
  }

  async handleRequestLobbyData(socket, rawCode) {
    if (typeof rawCode !== 'string') return;
    if (this.lobbyStore.persistent && !this._restored) await this.init();
    const code = rawCode.trim().toUpperCase();
    const lobby = this.lobbies[code];
    if (!lobby) return;

    if (!this.ensureAuthenticated(socket, false) || !this.isLobbyMember(lobby, socket)) {
      socket.emit('lobby-data-denied', { code, reason: 'not_member' });
      return;
    }

    socket.emit('lobby-data', {
      code,
      players: this.lobbyPlayersPayload(lobby),
      hostUserId: lobby.hostUserId,
      hostSocketId: lobby.hostSocketId,
      config: lobby.config
    });
  }

  async handleToggleReady(socket, rawCode) {
    if (!this.requireAuth(socket, 'toggle-ready', { retryable: true })) return;
    if (this.lobbyStore.persistent && !this._restored) await this.init();
    if (this.consumeSocketRate(socket, 'toggle-ready', 60)) return;
    if (typeof rawCode !== 'string') return;

    const code = rawCode.trim().toUpperCase();
    const lobby = this.lobbies[code];
    if (!lobby) return;

    const player = lobby.players.find((p) => String(p.id) === this.getUserId(socket));
    if (!player || player.left) return;

    player.ready = !player.ready;
    lobby.updatedAt = this.now();
    this.broadcastLobbyUpdate(code);
    this._persistLobby(code);
  }

  async handleSetPlayerTeam(socket, payload) {
    if (!this.requireAuth(socket, 'set-player-team', { retryable: true })) return;
    if (this.lobbyStore.persistent && !this._restored) await this.init();
    if (this.consumeSocketRate(socket, 'set-player-team', 60)) return;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    if (typeof payload.code !== 'string' || typeof payload.playerId !== 'string') return;

    const team = normalizeTeam(payload.team);
    if (!team) return;

    const code = payload.code.trim().toUpperCase();
    const lobby = this.lobbies[code];
    if (!lobby || lobby.finished || this.activeGames[code]) {
      socket.emit('team-change-failed', { code, reason: 'lobby_not_available' });
      return;
    }
    if (!lobby.config.teams) {
      socket.emit('team-change-failed', { code, reason: 'teams_disabled' });
      return;
    }
    if (!lobby.hostUserId || String(lobby.hostUserId) !== this.getUserId(socket)) {
      socket.emit('team-change-failed', { code, reason: 'not_host' });
      return;
    }

    const player = lobby.players.find((p) => String(p.id) === payload.playerId && !p.left);
    if (!player) {
      socket.emit('team-change-failed', { code, reason: 'player_notfound' });
      return;
    }
    if (player.team === team) return;

    player.team = team;
    // A team assignment changes the match setup, so the affected player must
    // confirm readiness again before the host can start.
    player.ready = false;
    lobby.updatedAt = this.now();
    this.broadcastLobbyUpdate(code);
    this._persistLobby(code);
  }

  handleLeaveLobby(socket, rawCode) {
    if (typeof rawCode !== 'string' || !this.ensureAuthenticated(socket, false)) return;
    if (this.consumeSocketRate(socket, 'leave-lobby', 30)) return;
    return this.removePlayer(rawCode.trim().toUpperCase(), socket);
  }

  async handleStartGame(socket, rawCode) {
    if (!this.requireAuth(socket, 'start-game', { retryable: true })) {
      socket.emit('game-failed', { reason: 'host_unauthenticated' });
      return;
    }
    if (this.lobbyStore.persistent && !this._restored) await this.init();
    if (typeof rawCode !== 'string') {
      socket.emit('game-failed', { reason: 'invalid_code' });
      return;
    }

    const code = rawCode.trim().toUpperCase();
    const lobby = this.lobbies[code];
    if (!lobby) {
      socket.emit('game-failed', { reason: 'lobby_notfound' });
      return;
    }
    if (this.activeGames[code]) {
      socket.emit('game-failed', { reason: 'already_started' });
      return;
    }
    if (!lobby.hostUserId || String(lobby.hostUserId) !== this.getUserId(socket)) {
      socket.emit('game-failed', { reason: 'not_host' });
      return;
    }

    if (lobby.config.teams) fillMissingTeams(lobby.players);
    const active = this.activePlayers(lobby);
    if (active.length < 2 || !active.every((p) => p.ready)) {
      socket.emit('game-failed', { reason: 'players_not_ready' });
      return;
    }
    if (lobby.config.teams && !teamsAreValid(active)) {
      socket.emit('game-failed', { reason: 'teams_unbalanced' });
      return;
    }
    if (lobby.starting) {
      socket.emit('game-failed', { reason: 'already_started' });
      return;
    }

    lobby.starting = true;
    try {
      const game = {
        code,
        config: { ...lobby.config },
        players: active.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type || 'guest',
          avatar: p.avatar || null,
          team: normalizeTeam(p.team),
          playerIcon: null,
          score: 0,
          comboStats: createComboStats(),
          progression: createProgression(lobby.config),
          prediction: null,
          energyBoostGiven: false,
          hasRolled: false,
          left: false,
          connected: true
        })),
        currentIndex: 0,
        round: 1,
        totalRounds: lobby.config.rounds,
        timeLimitSeconds: lobby.config.timeLimitSeconds,
        turnStarted: false,
        turnAdvancing: false,
        turnId: 0,
        turnExpiresAt: null,
        rollInProgress: false,
        megaEnergyBoostGiven: false,
        turnTimer: null,
        createdAt: this.now(),
        updatedAt: this.now(),
        finished: false
      };

      this.activeGames[code] = game;
      lobby.starting = false;
      lobby.hostSocketId = socket.id;

      this.io.to(code).emit('game-starting', {
        code,
        config: game.config,
        players: this.lobbyPlayersPayload(lobby)
      });
      this.emitGameState(code);

      this.schedule(() => {
        if (this.activeGames[code] === game && !game.turnStarted) this.startTurn(code);
      }, this.startDelayMs);
      this._persistLobby(code);
    } catch (err) {
      lobby.starting = false;
      console.error('[LobbyManager] start-game failed:', err);
      socket.emit('game-failed', { reason: 'server_error' });
    }
  }

  // -------------------------------------------------------------------------
  // Game state and turns
  // -------------------------------------------------------------------------

  handleRequestGameState(socket, payload) {
    const rawCode = payload && typeof payload === 'object' ? payload.code : null;
    if (typeof rawCode !== 'string') return;

    const code = rawCode.trim().toUpperCase();
    if (!this.ensureAuthenticated(socket, false)) {
      socket.emit('game-state-denied', { code, reason: 'unauthenticated' });
      return;
    }

    const game = this.activeGames[code];
    const lobby = this.lobbies[code];
    if (!(game && this.isGameMember(game, socket)) && !(lobby && this.isLobbyMember(lobby, socket))) {
      socket.emit('game-state-denied', { code, reason: 'not_member' });
      return;
    }

    if (!game) {
      if (lobby) {
        const players = this.lobbyPlayersPayload(lobby);
        const localIndex = players.findIndex((p) => String(p.id) === this.getUserId(socket));
        socket.emit('game-state', {
          room: code,
          players,
          config: lobby.config,
          localIndex: localIndex >= 0 ? localIndex : null
        });
      }
      return;
    }

    const localIndex = game.players.findIndex((p) => String(p.id) === this.getUserId(socket));
    socket.emit('game-state', this.gameStatePayload(game, code, localIndex >= 0 ? localIndex : null));
  }

  // Local play rolls the active player's unlocked dice and applies their luck
  // before combo scoring. The same transformation is used for predictions so
  // the preview is exactly what the roll will use.
  applyLuck(dice, effectiveLuck = 1) {
    const luck = Math.max(0.5, Math.min(6, Number(effectiveLuck) || 1));
    const finalLuck = (Array.isArray(dice) ? dice : []).map((value) => {
      const rerollChance = Math.max(0, Math.min(1, (luck - 1) / 5));
      if (this.random() < rerollChance) {
        const bias = Math.pow(this.random(), 1 / Math.max(0.001, luck));
        return Math.max(1, Math.min(6, Math.ceil(bias * 6)));
      }
      return value;
    });

    if (luck >= 2) {
      const boostFraction = Math.max(0, Math.min(1, (luck - 1) / 5));
      const toCoerce = Math.floor(boostFraction * (finalLuck.length - 1));
      if (toCoerce > 0) {
        const counts = {};
        finalLuck.forEach((face) => { counts[face] = (counts[face] || 0) + 1; });
        let targetFace = 6;
        let bestCount = -1;
        Object.keys(counts).forEach((key) => {
          if (counts[key] > bestCount) {
            bestCount = counts[key];
            targetFace = parseInt(key, 10);
          }
        });
        if (luck >= 4 && this.random() < 0.6) targetFace = 6;

        let coerced = 0;
        const indices = Array.from({ length: finalLuck.length }, (_, index) => index);
        for (let i = indices.length - 1; i > 0; i -= 1) {
          const j = Math.floor(this.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        for (const index of indices) {
          if (coerced >= toCoerce) break;
          if (finalLuck[index] !== targetFace && this.random() < 0.9) {
            finalLuck[index] = targetFace;
            coerced += 1;
          }
        }
      }
    }
    return finalLuck;
  }

  generatePrediction(game, player, { force = false } = {}) {
    if (!player?.progression) return null;
    const chance = player.progression.getClairvoyanceChance();
    if (chance <= 0 || (!force && this.random() >= chance)) return null;

    const count = player.progression.diceUnlocked;
    const rolled = this.roll(count);
    const base = Array.from({ length: count }, (_, index) => Number(rolled?.[index]) || 1);
    return this.applyLuck(base, player.progression.getEffectiveLuck());
  }

  // Mirrors LocalGameScene.startTurn(): income, interest, catch-up boosts and
  // clairvoyance all happen before the player is allowed to act.
  applyTurnStart(game, player) {
    const summary = {
      income: 0,
      interest: 0,
      energyBoost: 0,
      megaEnergyBoost: 0,
      prediction: null
    };
    if (!player?.progression) return summary;

    const p = player.progression;
    const baseIncome = p.getEconomyIncome();
    const income = Math.floor(
      baseIncome *
      p.getEconomyMultiplier() *
      p.getHighStonksMultiplier(Math.max(0, game.round - 1))
    );
    if (income > 0) {
      player.score += income;
      summary.income = income;
    }

    const investorRate = p.getInterestRate();
    if (investorRate > 0) {
      const interest = Math.floor(player.score * investorRate);
      if (interest > 0) {
        player.score += interest;
        summary.interest = interest;
      }
    }

    const active = game.players.filter((candidate) => candidate && !candidate.left);
    const topScore = active.length ? Math.max(...active.map((candidate) => candidate.score || 0)) : 0;
    const turnsLeftIncludingCurrent = Math.max(0, game.totalRounds - game.round + 1);
    const ratioBase = Math.max(1, player.score || 0);
    if (
      turnsLeftIncludingCurrent <= 5 &&
      !player.energyBoostGiven &&
      topScore >= ratioBase * 5
    ) {
      const boost = Math.floor(topScore * 0.2);
      if (boost > 0) {
        player.score += boost;
        player.energyBoostGiven = true;
        summary.energyBoost = boost;
      }
    }

    if (!game.megaEnergyBoostGiven && game.round >= game.totalRounds && active.length > 1) {
      const sorted = [...active].sort((a, b) => (a.score || 0) - (b.score || 0));
      const worst = sorted[0];
      const top = sorted[sorted.length - 1];
      const worstBase = Math.max(1, worst?.score || 0);
      const others = active.filter((candidate) => candidate !== worst);
      if (
        worst &&
        top &&
        worst === player &&
        others.every((candidate) => (candidate.score || 0) >= worstBase * 50) &&
        (top.score || 0) > 0
      ) {
        const megaBoost = Math.floor((top.score || 0) * 0.4);
        if (megaBoost > 0) {
          player.score += megaBoost;
          game.megaEnergyBoostGiven = true;
          summary.megaEnergyBoost = megaBoost;
        }
      }
    }

    player.prediction = this.generatePrediction(game, player);
    summary.prediction = player.prediction;
    return summary;
  }

  resolveRollicane(progression, dice, rollMultiplier = 1) {
    const config = progression?.getSpinEffectConfig?.();
    if (!config || !Array.isArray(dice) || !dice.length) {
      return { bonus: 0, spins: [], rollMultiplier };
    }
    const chance = Math.max(0, Math.min(1, Number(config.chance) || 0));
    if (chance <= 0) return { bonus: 0, spins: [], rollMultiplier };

    const minSecRaw = Number(config.minSec);
    const maxSecRaw = Number(config.maxSec);
    const minSec = Math.max(0.1, Number.isFinite(minSecRaw) ? minSecRaw : 2);
    const maxSec = Math.max(minSec, Number.isFinite(maxSecRaw) ? maxSecRaw : minSec);
    const integerRange = Number.isInteger(minSec) && Number.isInteger(maxSec);
    const spins = [];

    dice.forEach((face, index) => {
      if (this.random() >= chance) return;
      const seconds = integerRange
        ? Math.floor(this.random() * (maxSec - minSec + 1)) + minSec
        : minSec + this.random() * (maxSec - minSec);
      spins.push({ index, face, seconds });
    });

    if (!spins.length) return { bonus: 0, spins: [], rollMultiplier };

    const maxSeconds = Math.max(...spins.map((spin) => spin.seconds || 0));
    let bonus = 0;
    for (let second = 1; second <= maxSeconds; second += 1) {
      const tickBase = spins
        .filter((spin) => (spin.seconds || 0) >= second)
        .reduce((sum, spin) => sum + (Number(spin.face) || 0), 0);
      if (tickBase > 0) bonus += Math.floor(tickBase * Math.max(1, rollMultiplier));
    }
    return { bonus, spins, rollMultiplier };
  }

  spinGraceMs(spins = []) {
    const seconds = Math.max(
      0,
      ...(Array.isArray(spins) ? spins : []).map((spin) => Number(spin?.seconds) || 0)
    );
    return seconds > 0 ? Math.ceil(seconds * 1000) + 1000 : 0;
  }

  scoreRoll(game, player, dice) {
    const base = baseScore(dice);
    let combo = checkCombo(dice);
    let points = base;
    let comboMultiplier = 1;
    let diceMultiplier = 1;
    let rollicaneBonus = 0;
    let rollicaneSpins = [];
    let comboBreakdown = null;

    const p = player.progression;
    diceMultiplier = p.getDiceScoreMultiplier();
      points = Math.floor(base * diceMultiplier);

      if (combo) {
        const streak = p.recordCombo(combo.key);
        const baseMultiplier = combo.multiplier || 1;
        const level = p.getComboLevel(combo.key);
        const upgradeMultiplier = p.getComboMultiplier(combo.key);
        const globalMultiplier = p.getComboGlobalMultiplier();
        const streakMultiplier = p.getComboStreakMultiplier(streak);
        comboMultiplier = baseMultiplier * upgradeMultiplier * globalMultiplier;
        // LocalGameScene rounds the combined base/level/global multiplier to
        // two decimals before applying a streak bonus. Keep that ordering so
        // online scores match the local game exactly.
        if (streakMultiplier !== 1) {
          comboMultiplier = Math.round(comboMultiplier * 100) / 100;
          comboMultiplier *= streakMultiplier;
        }
        comboBreakdown = {
          key: combo.key,
          type: combo.type || combo.key,
          baseMultiplier,
          level,
          upgradeMultiplier,
          globalMultiplier,
          comboUpgradePercent: p.getComboUpgradePercent(),
          comboUpgradeIsMultiplicative: p.isComboUpgradeMultiplicative(),
          streak,
          streakMultiplier,
          streakLabel: p.getComboStreakLabel(),
          totalMultiplier: comboMultiplier
        };
        points = Math.floor(points * comboMultiplier);
      } else {
        p.recordCombo(null);
      }

    const spin = this.resolveRollicane(p, dice, diceMultiplier * (combo ? comboMultiplier : 1));
    rollicaneBonus = spin.bonus;
    rollicaneSpins = spin.spins;
    points += rollicaneBonus;

    if (combo?.key) {
      player.comboStats[combo.key] = (player.comboStats[combo.key] || 0) + 1;
    }
    player.score += points;
    player.lastRoll = dice.slice();

    return {
      points,
      combo: combo || null,
      base,
      comboMultiplier,
      diceMultiplier,
      rollicaneBonus,
      rollicaneSpins,
      comboBreakdown
    };
  }

  resolveRoll(game, player, { usePrediction = true } = {}) {
    const count = this.diceCountFor(game, player);
    const rolled = this.roll(count);
    let dice = Array.from({ length: count }, (_, index) => Number(rolled?.[index]) || 1);
    let predictionUsed = false;
    const prediction = player.progression ? player.prediction : null;
    if (usePrediction && Array.isArray(prediction) && prediction.length === count) {
      dice = prediction.slice();
      predictionUsed = true;
    } else if (player.progression) {
      dice = this.applyLuck(dice, player.progression.getEffectiveLuck());
    }
    player.prediction = null;

    return { dice, predictionUsed, ...this.scoreRoll(game, player, dice) };
  }

  buyProgressionItem(game, player, kind, key) {
    if (!player?.progression) return { ok: false, reason: 'not_available' };
    if (!game.turnStarted || game.turnAdvancing || player.hasRolled || game.rollInProgress) {
      return { ok: false, reason: 'not_available' };
    }
    if (this.now() >= (game.turnExpiresAt || 0)) return { ok: false, reason: 'turn_expired' };

    const p = player.progression;
    const spend = (cost) => {
      if (!Number.isFinite(cost) || cost < 0 || player.score < cost) return false;
      player.score -= cost;
      return true;
    };

    if (kind === 'dice') {
      if (!p.canUpgradeDice()) return { ok: false, reason: 'maxed' };
      const cost = p.getNextDiceCost();
      if (!spend(cost)) return { ok: false, reason: 'insufficient_score' };
      p.upgradeDice();
      const prediction = player.prediction
        ? this.generatePrediction(game, player, { force: true })
        : null;
      player.prediction = prediction;
      return { ok: true, cost, prediction };
    }

    if (kind === 'economy') {
      if (p.getEconomyLevel() >= p.getEconomyCap()) return { ok: false, reason: 'maxed' };
      const cost = p.getEconomyCost();
      if (!spend(cost)) return { ok: false, reason: 'insufficient_score' };
      p.upgradeEconomy();
      return { ok: true, cost };
    }

    if (kind === 'luck') {
      if (p.getLuckLevel() >= MAX_LUCK_LEVEL || p.getEffectiveLuck() >= 6) {
        return { ok: false, reason: 'maxed' };
      }
      const cost = p.getLuckCost();
      if (!spend(cost)) return { ok: false, reason: 'insufficient_score' };
      p.upgradeLuck();
      return { ok: true, cost };
    }

    if (kind === 'combo') {
      if (!COMBO_KEYS.includes(key)) return { ok: false, reason: 'invalid_key' };
      if (p.diceUnlocked < (COMBO_REQUIREMENTS[key] ?? 2)) return { ok: false, reason: 'locked' };
      const cost = p.getComboCost(key);
      if (!spend(cost)) return { ok: false, reason: 'insufficient_score' };
      p.upgradeCombo(key);
      return { ok: true, cost };
    }

    if (kind === 'big') {
      if (!game.config.bigUpgradesEnabled) return { ok: false, reason: 'big_upgrades_disabled' };
      if (!p.getBigUpgradeDef(key) || p.hasBigUpgrade(key)) return { ok: false, reason: 'unavailable' };
      const cost = p.getBigUpgradeCost(key);
      if (!spend(cost)) return { ok: false, reason: 'insufficient_score' };
      if (!p.buyBigUpgrade(key)) {
        player.score += cost;
        return { ok: false, reason: 'unavailable' };
      }
      return { ok: true, cost };
    }

    return { ok: false, reason: 'invalid_kind' };
  }

  handleBuyUpgrade(socket, payload) {
    if (!this.requireAuth(socket, 'buy-upgrade')) return;
    if (this.consumeSocketRate(socket, 'buy-upgrade', 120)) return;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    if (typeof payload.code !== 'string' || typeof payload.kind !== 'string') return;

    const code = payload.code.trim().toUpperCase();
    const game = this.activeGames[code];
    if (!game || game.finished) {
      socket.emit('upgrade-failed', { code, reason: 'not_available' });
      return;
    }
    const player = game.players[game.currentIndex];
    if (!player || String(player.id) !== this.getUserId(socket)) {
      socket.emit('upgrade-failed', { code, reason: 'not_your_turn' });
      return;
    }

    const key = typeof payload.key === 'string' ? payload.key : null;
    const result = this.buyProgressionItem(game, player, payload.kind, key);
    if (!result.ok) {
      socket.emit('upgrade-failed', { code, kind: payload.kind, key, reason: result.reason });
      return;
    }

    const playerIndex = game.currentIndex;
    this.io.to(code).emit('upgrade-result', {
      playerIndex,
      kind: payload.kind,
      key,
      cost: result.cost,
      score: player.score,
      progression: player.progression.toPublic(game.round),
      shop: this.shopPayload(game, player)
    });
    this.emitGameState(code);

    if (result.prediction) {
      this.emitToPlayer(code, player.id, 'player-prediction', { prediction: result.prediction });
    }
  }

  startTurn(code) {
    const game = this.activeGames[code];
    if (!game || game.finished) return;

    const player = game.players[game.currentIndex];
    if (!player || player.left) {
      this.advanceTurn(code);
      return;
    }

    player.hasRolled = false;
    game.rollInProgress = false;
    game.turnStarted = true;
    game.turnAdvancing = false;
    game.turnId = (game.turnId || 0) + 1;
    game.updatedAt = this.now();

    const turnStart = this.applyTurnStart(game, player);
    const { prediction, ...turnStartSummary } = turnStart;

    const timeLimitSeconds = Math.min(300, Math.max(5, Number(game.timeLimitSeconds) || 30));
    game.turnExpiresAt = this.now() + timeLimitSeconds * 1000;
    const turnId = game.turnId;

    this.io.to(code).emit('turn-start', {
      playerIndex: game.currentIndex,
      currentPlayerIndex: game.currentIndex,
      currentPlayerHasRolled: false,
      currentPlayerRolling: false,
      round: game.round,
      timeLimitSeconds,
      scores: game.players.map((p) => p.score),
      comboStats: game.players.map((p) => p.comboStats),
      ...this.teamState(game),
      ...turnStartSummary,
      progressionEnabled: true,
      progression: player.progression ? player.progression.toPublic(game.round) : null,
      shop: this.shopPayload(game, player),
      turnExpiresAt: game.turnExpiresAt
    });

    if (prediction) {
      this.emitToPlayer(code, player.id, 'player-prediction', { prediction });
    }

    this.clearTimer(game.turnTimer);
    game.turnTimer = this.schedule(() => this.handleTimeout(code, turnId), timeLimitSeconds * 1000);
  }

  handleTimeout(code, turnId) {
    const game = this.activeGames[code];
    if (!game || game.finished || game.turnId !== turnId) return;

    const player = game.players[game.currentIndex];
    if (!player || player.left || player.hasRolled || game.rollInProgress || !game.turnStarted) return;

    const remaining = (game.turnExpiresAt || 0) - this.now();
    if (remaining > 0) {
      game.turnTimer = this.schedule(() => this.handleTimeout(code, turnId), remaining);
      return;
    }

    player.hasRolled = true;
    const result = this.resolveRoll(game, player, { usePrediction: false });
    const { dice, points, combo } = result;
    const spinGraceMs = this.spinGraceMs(result.rollicaneSpins);

    game.turnExpiresAt = this.now() + this.timeoutGraceMs + spinGraceMs;
    this.clearTimer(game.turnTimer);

    this.io.to(code).emit('player-timeout', {
      playerIndex: game.currentIndex,
      dice,
      scored: points,
      combo: combo || null,
      scores: game.players.map((p) => p.score),
      comboStats: game.players.map((p) => p.comboStats),
      round: game.round,
      currentPlayerHasRolled: true,
      currentPlayerRolling: false,
      progressionEnabled: true,
      baseScored: result.base,
      comboMultiplier: result.comboMultiplier,
      comboBreakdown: result.comboBreakdown || null,
      diceMultiplier: result.diceMultiplier,
      rollicaneBonus: result.rollicaneBonus,
      rollicaneSpins: result.rollicaneSpins,
      progression: player.progression ? player.progression.toPublic(game.round) : null,
      ...this.teamState(game),
      turnExpiresAt: game.turnExpiresAt
    });

    game.turnTimer = this.schedule(() => {
      if (this.activeGames[code] === game && game.turnId === turnId) this.advanceTurn(code);
    }, this.timeoutGraceMs + spinGraceMs);
  }

  handlePlayerRoll(socket, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    if (typeof payload.code !== 'string' || !this.ensureAuthenticated(socket, false)) return;

    const code = payload.code.trim().toUpperCase();
    const game = this.activeGames[code];
    if (!game || game.finished) return;

    const player = game.players[game.currentIndex];
    if (!player || player.left || String(player.id) !== this.getUserId(socket)) return;
    if (!game.turnStarted || player.hasRolled || game.rollInProgress) return;
    if (this.now() >= (game.turnExpiresAt || 0)) return;

    game.rollInProgress = true;
    const turnId = game.turnId;
    const playerIndex = game.currentIndex;
    this.clearTimer(game.turnTimer);

    this.io.to(code).emit('player-rolling', {
      playerIndex,
      currentPlayerRolling: true
    });

    this.schedule(() => {
      const liveGame = this.activeGames[code];
      if (!liveGame || liveGame !== game || game.turnId !== turnId || player.left || !game.rollInProgress) return;

      try {
        const result = this.resolveRoll(game, player);
        const { dice, points, combo } = result;

        player.hasRolled = true;
        game.rollInProgress = false;
        const spinGraceMs = this.spinGraceMs(result.rollicaneSpins);
        game.turnExpiresAt = this.now() + this.rollGraceMs + spinGraceMs;

        this.io.to(code).emit('turn-result', {
          playerIndex,
          dice,
          scored: points,
          combo: combo || null,
          scores: game.players.map((p) => p.score),
          comboStats: game.players.map((p) => p.comboStats),
          round: game.round,
          currentPlayerHasRolled: true,
          currentPlayerRolling: false,
          progressionEnabled: true,
          baseScored: result.base,
          comboMultiplier: result.comboMultiplier,
          comboBreakdown: result.comboBreakdown || null,
          diceMultiplier: result.diceMultiplier,
          rollicaneBonus: result.rollicaneBonus,
          rollicaneSpins: result.rollicaneSpins,
          progression: player.progression ? player.progression.toPublic(game.round) : null,
          predictionUsed: !!result.predictionUsed,
          ...this.teamState(game),
          turnExpiresAt: game.turnExpiresAt
        });

        game.turnTimer = this.schedule(() => {
          if (this.activeGames[code] === game && game.turnId === turnId) this.advanceTurn(code);
        }, this.rollGraceMs + spinGraceMs);
      } catch (err) {
        game.rollInProgress = false;
        console.error('[LobbyManager] player-roll failed:', err);
      }
    }, this.rollDelayMs);
  }

  handlePlayerEndTurn(socket, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    if (typeof payload.code !== 'string' || !this.ensureAuthenticated(socket, false)) return;

    const code = payload.code.trim().toUpperCase();
    const game = this.activeGames[code];
    if (!game || !game.turnStarted || game.turnAdvancing) return;

    const player = game.players[game.currentIndex];
    if (!player || player.left || String(player.id) !== this.getUserId(socket)) return;
    if (!player.hasRolled) {
      socket.emit('end-turn-failed', { reason: 'not_rolled' });
      return;
    }

    this.advanceTurn(code);
  }

  applyScoreDrain(game, endingIndex) {
    const owner = game?.players?.[endingIndex];
    if (!owner?.progression || owner.left) return null;

    const claims = game.scoreDrainClaims && typeof game.scoreDrainClaims === 'object'
      ? game.scoreDrainClaims
      : {};
    game.scoreDrainClaims = claims;
    const result = owner.progression.resolveScoreDrain({
      ownerIndex: endingIndex,
      players: game.players,
      random: () => this.random(),
      claimedBy: claims
    });
    if (!result?.targets?.length) return result;

    const applied = [];
    for (const target of result.targets) {
      const victim = game.players[target.index];
      if (!victim || victim.left) continue;
      const amount = Math.min(target.amount, Math.max(0, victim.score));
      if (amount <= 0) continue;
      victim.score -= amount;
      owner.score += amount;
      claims[target.index] = endingIndex;
      applied.push({ index: target.index, amount });
    }

    return {
      ...result,
      ownerIndex: endingIndex,
      targets: applied,
      total: applied.reduce((sum, target) => sum + target.amount, 0)
    };
  }

  advanceTurn(code) {
    const game = this.activeGames[code];
    if (!game || game.finished || game.turnAdvancing) return;

    game.turnAdvancing = true;
    game.turnStarted = false;
    game.rollInProgress = false;
    this.clearTimer(game.turnTimer);

    const playerCount = game.players.length;
    if (playerCount === 0) {
      this.finishGame(code, game);
      return;
    }

    const previousIndex = game.currentIndex;
    const previousPlayer = game.players[previousIndex];
    const drain = previousPlayer && !previousPlayer.left
      ? this.applyScoreDrain(game, previousIndex)
      : null;
    const emitDrain = () => {
      if (!drain || (!drain.targets?.length && !drain.skipped?.length)) return;
      this.io.to(code).emit('score-drain', {
        ...drain,
        scores: game.players.map((p) => p.score),
        names: game.players.map((p) => p.name)
      });
    };

    let nextIndex = (game.currentIndex + 1) % playerCount;
    let attempts = 0;
    while (attempts < playerCount && game.players[nextIndex].left) {
      nextIndex = (nextIndex + 1) % playerCount;
      attempts += 1;
    }

    if (game.players.filter((p) => !p.left).length <= 1) {
      emitDrain();
      this.finishGame(code, game);
      return;
    }

    // Wrapping past the last seat completes a round.
    if (nextIndex <= previousIndex) {
      game.round += 1;
      if (game.round > game.totalRounds) {
        emitDrain();
        this.finishGame(code, game);
        return;
      }
    }

    emitDrain();
    game.currentIndex = nextIndex;
    game.updatedAt = this.now();
    this.startTurn(code);
  }

  finishGame(code, game) {
    if (!game || game.finished) return;
    game.finished = true;
    this.clearTimer(game.turnTimer);

    const teams = this.teamState(game);
    this.io.to(code).emit('game-finished', {
      code,
      scores: game.players.map((p) => p.score),
      comboStats: game.players.map((p) => p.comboStats),
      roundsPlayed: Math.max(0, Math.min(game.totalRounds || 0, (game.round || 1) - 1)),
      totalRounds: game.totalRounds,
      names: game.players.map((p) => p.name),
      ...teams,
      progressionEnabled: true,
      progression: game.players.map((p) => p.progression ? p.progression.toPublic(game.round) : null),
      winnerTeam: teams.teamsEnabled ? winnerFromTotals(teams.teamScores) : null,
      players: game.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: normalizeTeam(p.team),
        score: p.score,
        comboStats: p.comboStats,
        progression: p.progression ? p.progression.toPublic(game.round) : null,
        left: !!p.left
      }))
    });

    delete this.activeGames[code];

    // Keep the lobby around briefly so the clients' post-game scene can render
    // before the room disappears.
    const finishedLobby = this.lobbies[code];
    if (finishedLobby) {
      finishedLobby.finished = true;
      this._persistLobby(code);
      this.schedule(() => {
        if (this.lobbies[code] === finishedLobby && !this.activeGames[code]) {
          delete this.lobbies[code];
          this._deletePersistedLobby(code);
        }
      }, this.cleanupDelayMs);
    }
  }

  // -------------------------------------------------------------------------
  // Leaving / disconnecting
  // -------------------------------------------------------------------------

  async removePlayer(rawCode, socket, { disconnecting = false } = {}) {
    if (!rawCode || typeof rawCode !== 'string') return;
    const code = rawCode.trim().toUpperCase();
    const uid = this.getUserId(socket);
    if (!uid) return;
    if (!socket.rooms?.has(code)) return;

    // A second tab for the same account must not surrender the first tab's game
    // when it closes. An explicit leave, however, is a real forfeit.
    const room = this.io?.sockets?.adapter?.rooms?.get(code);
    const otherConnections = [...(room || [])]
      .map((id) => this.io.sockets.sockets.get(id))
      .filter((other) => other && other.id !== socket.id && other.connected &&
        other.rooms?.has(code) && String(other.data?.user?.id) === uid);

    socket.leave(code);
    if (disconnecting && otherConnections.length) return;
    for (const other of otherConnections) other.leave(code);

    const lobby = this.lobbies[code];
    const game = this.activeGames[code];

    if (!lobby) {
      if (!game) return;
      const gamePlayer = game.players.find((p) => String(p.id) === uid);
      if (!gamePlayer || gamePlayer.left) return;
      gamePlayer.left = true;
      gamePlayer.connected = false;

      if (game.players.filter((p) => !p.left).length <= 1) {
        this.finishGame(code, game);
      } else {
        this.io.to(code).emit('player-left', { id: uid });
        if (String(game.players[game.currentIndex]?.id) === uid) this.advanceTurn(code);
        else this.emitGameState(code);
      }
      return;
    }

    const player = lobby.players.find((p) => String(p.id) === uid);
    if (!player || player.left) return;

    player.left = true;
    player.connected = false;

    const gamePlayer = game?.players.find((p) => String(p.id) === uid);
    const wasCurrentPlayer = !!gamePlayer && game.players[game.currentIndex] === gamePlayer;
    if (gamePlayer) {
      gamePlayer.left = true;
      gamePlayer.connected = false;
      if (wasCurrentPlayer) {
        game.turnStarted = false;
        game.rollInProgress = false;
        this.clearTimer(game.turnTimer);
        game.turnTimer = null;
      }
    }

    if (this.activePlayers(lobby).length === 0) {
      delete this.lobbies[code];
      this._deletePersistedLobby(code);
      if (game) {
        this.clearTimer(game.turnTimer);
        delete this.activeGames[code];
      }
      this.io.to(code).emit('lobby-deleted', { code });
      return;
    }

    // Hand the host role to the next remaining player.
    const remaining = this.activePlayers(lobby);
    const hostStillPresent = remaining.some((p) => String(p.id) === String(lobby.hostUserId));
    if (!hostStillPresent) {
      const newHost = remaining[0];
      lobby.hostUserId = newHost.id;
      let newHostSocket = null;
      try {
        newHostSocket = [...this.io.sockets.sockets.values()]
          .find((s) => s.connected && String(s.data?.user?.id) === String(newHost.id));
      } catch (err) {
        newHostSocket = null;
      }
      lobby.hostSocketId = newHostSocket ? newHostSocket.id : null;
    }

    lobby.updatedAt = this.now();
    this.broadcastLobbyUpdate(code);
    this._persistLobby(code);

    if (game && this.activeGames[code] === game) {
      this.io.to(code).emit('player-left', { id: uid });

      if (game.players.filter((p) => !p.left).length <= 1) {
        this.finishGame(code, game);
      } else if (wasCurrentPlayer) {
        this.advanceTurn(code);
      } else {
        this.emitGameState(code);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Housekeeping
  // -------------------------------------------------------------------------

  pruneInMemoryLobbies() {
    const now = this.now();

    for (const code of Object.keys(this.lobbies)) {
      const lobby = this.lobbies[code];
      if (!lobby) continue;
      const connected = (lobby.players || []).filter((p) => p.connected !== false).length;
      const expired = !this.activeGames[code] && !lobby.starting &&
        now - (lobby.updatedAt || lobby.createdAt || 0) > LOBBY_TTL_MS;

      if (connected === 0 || expired) {
        delete this.lobbies[code];
        this._deletePersistedLobby(code);
        const game = this.activeGames[code];
        if (game && connected === 0) {
          this.clearTimer(game.turnTimer);
          delete this.activeGames[code];
        }
      }
    }

    for (const code of Object.keys(this.activeGames)) {
      const game = this.activeGames[code];
      if (!game) continue;
      if (game.finished || now - (game.updatedAt || game.createdAt || 0) > LOBBY_TTL_MS) {
        this.clearTimer(game.turnTimer);
        delete this.activeGames[code];
      }
    }
  }

  dispose() {
    if (this._pruneHandle) {
      clearInterval(this._pruneHandle);
      this._pruneHandle = null;
    }
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
    for (const game of Object.values(this.activeGames)) this.clearTimer(game.turnTimer);
  }
}
