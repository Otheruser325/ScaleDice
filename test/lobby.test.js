import test from 'node:test';
import assert from 'node:assert/strict';
import LobbyManager from '../server/lobbyManager.js';
import { FakeIO, sleep } from './support/fakeIo.js';

function setup(overrides = {}) {
  const io = new FakeIO();
  const manager = new LobbyManager(io, {
    rateLimit: false,
    rollDelayMs: 2,
    startDelayMs: 2,
    rollGraceMs: 10000,
    timeoutGraceMs: 2,
    cleanupDelayMs: 5,
    pruneIntervalMs: 0,
    roll: () => [1, 1, 1, 1, 1],
    ...overrides
  });
  const host = io.addSocket('s1', { id: 'u1', name: 'Host', type: 'guest' });
  const guest = io.addSocket('s2', { id: 'u2', name: 'Guest', type: 'guest' });
  manager.registerSocket(host);
  manager.registerSocket(guest);
  return { io, manager, host, guest };
}

function createLobby(host, config = { players: 2, rounds: 10 }) {
  host.trigger('create-lobby', config);
  const created = host.last('lobby-created');
  assert.ok(created?.code, 'lobby-created should carry a code');
  return created.code;
}

async function startTwoPlayerGame(context) {
  const { host, guest } = context;
  const code = createLobby(host);
  guest.trigger('join-lobby', code);
  host.trigger('toggle-ready', code);
  guest.trigger('toggle-ready', code);
  host.trigger('start-game', code);
  await sleep(15);
  return code;
}

function currentTurn(socket) {
  const starts = socket.received.filter((entry) => entry.event === 'turn-start');
  return starts.at(-1)?.payload?.playerIndex ?? null;
}

test('online actions require an authenticated session', () => {
  const io = new FakeIO();
  const manager = new LobbyManager(io, { rateLimit: false, pruneIntervalMs: 0 });
  const anonymous = io.addSocket('anon', null);
  manager.registerSocket(anonymous);

  anonymous.trigger('create-lobby', { players: 2 });

  assert.equal(anonymous.last('auth-required').event, 'create-lobby');
  assert.equal(anonymous.last('create-failed').reason, 'unauthenticated');
  assert.equal(Object.keys(manager.lobbies).length, 0);
});

test('starting a lobby with fewer than two players has a dedicated reason', () => {
  const { host } = setup();
  const code = createLobby(host);

  host.trigger('start-game', code);

  assert.equal(host.last('game-failed').reason, 'not_enough_players');
});

test('a lobby is created, joined and only the host can start it', async () => {
  const context = setup();
  const { host, guest, manager } = context;
  const code = createLobby(host);

  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(manager.lobbies[code].hostUserId, 'u1');

  guest.trigger('join-lobby', code);
  assert.equal(guest.last('join-success').code, code);
  assert.equal(manager.lobbies[code].players.length, 2);

  host.trigger('start-game', code);
  assert.equal(host.last('game-failed').reason, 'players_not_ready');

  host.trigger('toggle-ready', code);
  guest.trigger('toggle-ready', code);
  guest.trigger('start-game', code);
  assert.equal(guest.last('game-failed').reason, 'not_host');

  host.trigger('start-game', code);
  await sleep(15);

  assert.ok(host.last('game-starting'));
  assert.equal(host.last('game-state').players.length, 2);
  assert.equal(currentTurn(host), 0);
});

test('only the current player can roll, and rolling scores server-side', async () => {
  const context = setup();
  const { host, guest, manager } = context;
  const code = await startTwoPlayerGame(context);

  guest.trigger('player-roll', { code });
  assert.equal(guest.count('player-rolling'), 0, 'non-current player cannot roll');

  host.trigger('player-roll', { code });
  await sleep(15);

  const result = host.last('turn-result');
  assert.ok(result, 'current player receives a turn result');
  assert.deepEqual(result.dice, [1]);
  assert.equal(result.scored, 1);
  assert.equal(result.combo, null);
  assert.equal(result.scores[0], 1);
  assert.equal(result.comboStats[0].fiveOfAKind, 0);
  assert.equal(manager.activeGames[code].players[0].score, 1);

  // The same socket cannot roll twice in one turn.
  host.trigger('player-roll', { code });
  await sleep(5);
  assert.equal(host.count('turn-result'), 1);
});

test('ending a turn before rolling is rejected; rolling then ending advances', async () => {
  const context = setup();
  const { host, guest } = context;
  const code = await startTwoPlayerGame(context);

  host.trigger('player-end-turn', { code });
  assert.equal(host.last('end-turn-failed').reason, 'not_rolled');

  host.trigger('player-roll', { code });
  await sleep(10);
  host.trigger('player-end-turn', { code });
  await sleep(5);

  assert.equal(currentTurn(guest), 1, 'second player should be up');
});

test('server timer auto-rolls a sleeping player and advances', async () => {
  const context = setup();
  const { host, guest, manager } = context;
  const code = await startTwoPlayerGame(context);

  const game = manager.activeGames[code];
  game.turnExpiresAt = Date.now() - 1;
  manager.handleTimeout(code, game.turnId);
  await sleep(10);

  const timeout = host.last('player-timeout');
  assert.ok(timeout, 'timeout should auto-roll for the current player');
  assert.equal(timeout.scored, 1);
  assert.equal(timeout.scores[0], 1);
  assert.equal(timeout.comboStats[0].fiveOfAKind, 0);
  assert.equal(currentTurn(guest), 1, 'turn should pass after the timeout grace');
});

test('a full match advances rounds and finishes with authoritative scores', async () => {
  const context = setup();
  const { host, guest, manager } = context;
  const code = await startTwoPlayerGame(context);

  let guard = 0;
  while (!host.last('game-finished') && guard < 40) {
    const turn = currentTurn(host);
    const actor = turn === 0 ? host : guest;
    actor.trigger('player-roll', { code });
    await sleep(8);
    actor.trigger('player-end-turn', { code });
    await sleep(3);
    guard += 1;
  }

  const finished = host.last('game-finished');
  assert.ok(finished, 'game should finish after the configured rounds');
  assert.equal(finished.scores.length, 2);
  assert.deepEqual(finished.names, ['Host', 'Guest']);
  // 10 rounds x 10 turns per player x 1 point per one-die all-ones roll.
  assert.deepEqual(finished.scores, [10, 10]);
  assert.deepEqual(Object.keys(finished.comboStats[0]), [
    'pair',
    'twoPair',
    'triple',
    'fullHouse',
    'straight',
    'fourOfAKind',
    'fiveOfAKind',
    'threePair',
    'tripleTrend',
    'powerHouse',
    'sixOfAKind'
  ]);
  assert.equal(finished.comboStats[0].fiveOfAKind, 0);
  assert.equal(manager.activeGames[code], undefined);

  await sleep(15);
  assert.equal(manager.lobbies[code], undefined, 'finished lobby is cleaned up');
});

test('three-player turn order advances one seat at a time and wraps a round', async () => {
  const context = setup();
  const { io, manager, host, guest } = context;
  const third = io.addSocket('s3', { id: 'u3', name: 'Third', type: 'guest' });
  manager.registerSocket(third);

  const code = createLobby(host, { players: 3, rounds: 10 });
  guest.trigger('join-lobby', code);
  third.trigger('join-lobby', code);
  host.trigger('toggle-ready', code);
  guest.trigger('toggle-ready', code);
  third.trigger('toggle-ready', code);
  host.trigger('start-game', code);
  await sleep(15);

  assert.equal(currentTurn(host), 0);
  const order = [];
  for (let seat = 0; seat < 3; seat += 1) {
    const current = currentTurn(host);
    order.push(current);
    const actor = current === 0 ? host : current === 1 ? guest : third;
    actor.trigger('player-roll', { code });
    await sleep(8);
    actor.trigger('player-end-turn', { code });
    await sleep(4);
  }

  assert.deepEqual(order, [0, 1, 2]);
  assert.deepEqual(manager.activeGames[code].players.map((player) => player.score), [1, 1, 1]);
  const nextRound = host.last('turn-start');
  assert.equal(nextRound.playerIndex, 0);
  assert.equal(nextRound.round, 2);
});

test('leaving mid-game forfeits and finishes when one player remains', async () => {
  const context = setup();
  const { host, guest, manager } = context;
  const code = await startTwoPlayerGame(context);

  host.trigger('leave-lobby', code);
  await sleep(5);

  assert.ok(guest.last('player-left'));
  const finished = guest.last('game-finished');
  assert.ok(finished, 'remaining player should see the game end');
  assert.equal(manager.activeGames[code], undefined);
});

test('host leaves a lobby and the next player inherits it', () => {
  const context = setup();
  const { host, guest, manager } = context;
  const code = createLobby(host);
  guest.trigger('join-lobby', code);

  host.trigger('leave-lobby', code);

  assert.equal(manager.lobbies[code].hostUserId, 'u2');
  assert.equal(manager.lobbies[code].hostSocketId, 's2');
  assert.equal(guest.last('lobby-updated').hostUserId, 'u2');
});

test('non-members cannot read lobby or game state', async () => {
  const context = setup();
  const { host, io, manager } = context;
  const code = await startTwoPlayerGame(context);
  const outsider = io.addSocket('s3', { id: 'u3', name: 'Outsider', type: 'guest' });
  manager.registerSocket(outsider);

  outsider.trigger('request-lobby-data', code);
  outsider.trigger('request-game-state', { code });

  assert.equal(outsider.last('lobby-data-denied').reason, 'not_member');
  assert.equal(outsider.last('game-state-denied').reason, 'not_member');
});

test('a player who disconnected mid-game cannot rejoin the running match', async () => {
  const context = setup({ cleanupDelayMs: 1000 });
  const { host, guest } = context;
  const code = await startTwoPlayerGame(context);

  guest.trigger('disconnecting');
  await sleep(5);

  guest.trigger('join-lobby', code);
  assert.equal(guest.last('join-failed').reason, 'game_started');
});

test('teams are host-assigned, balanced at start, and scored by the server', async () => {
  const context = setup();
  const { host, guest, manager } = context;
  const code = createLobby(host, {
    players: 2,
    rounds: 10,
    teams: true,
    timeLimitSeconds: 45
  });

  guest.trigger('join-lobby', code);
  assert.deepEqual(
    manager.lobbies[code].players.map((player) => player.team),
    ['blue', 'red'],
    'a new team lobby should alternate sides'
  );

  guest.trigger('set-player-team', { code, playerId: 'u1', team: 'red' });
  await sleep(5);
  assert.equal(manager.lobbies[code].players[0].team, 'blue', 'only the host may reassign teams');

  host.trigger('set-player-team', { code, playerId: 'u2', team: 'blue' });
  await sleep(5);
  assert.equal(manager.lobbies[code].players[1].team, 'blue');

  host.trigger('toggle-ready', code);
  guest.trigger('toggle-ready', code);
  host.trigger('start-game', code);
  await sleep(10);
  assert.equal(host.last('game-failed').reason, 'teams_unbalanced');

  host.trigger('set-player-team', { code, playerId: 'u2', team: 'red' });
  await sleep(5);
  // The host stayed ready; only the reassigned guest was reset by the team change.
  guest.trigger('toggle-ready', code);
  host.trigger('start-game', code);
  await sleep(15);

  const gameState = host.last('game-state');
  assert.deepEqual(gameState.players.map((player) => player.team), ['blue', 'red']);
  const turn = host.last('turn-start');
  assert.equal(turn.timeLimitSeconds, 45);
  assert.deepEqual(turn.teamScores, { blue: 0, red: 0 });

  host.trigger('player-roll', { code });
  await sleep(15);
  const result = host.last('turn-result');
  assert.deepEqual(result.teams, ['blue', 'red']);
  assert.deepEqual(result.teamScores, { blue: 1, red: 0 });

  host.trigger('player-end-turn', { code });
  await sleep(5);
  let guard = 0;
  while (!host.last('game-finished') && guard < 20) {
    const turn = currentTurn(host);
    const actor = turn === 0 ? host : guest;
    actor.trigger('player-roll', { code });
    await sleep(8);
    actor.trigger('player-end-turn', { code });
    await sleep(3);
    guard += 1;
  }

  const finished = host.last('game-finished');
  assert.ok(finished, 'team match should finish');
  assert.deepEqual(finished.teamScores, { blue: 10, red: 10 });
  assert.equal(finished.winnerTeam, null, 'equal team totals are a tie');
});

test('config values are clamped to the supported online range', () => {
  const context = setup();
  const { host, manager } = context;
  const code = createLobby(host, { players: 99, rounds: 999, timeLimitSeconds: 1 });

  assert.deepEqual(manager.lobbies[code].config, {
    players: 6,
    rounds: 100,
    teams: false,
    timeLimitSeconds: 5,
    progression: true,
    bigUpgradesEnabled: true,
    costMultiplier: 1,
    customBigUpgrades: []
  });
});
