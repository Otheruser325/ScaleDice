import test from 'node:test';
import assert from 'node:assert/strict';
import LobbyManager from '../server/lobbyManager.js';
import { PlayerProgression } from '../server/utils/progression.js';
import { getActiveBigUpgrades } from '../server/utils/upgrades.js';
import UpgradeManager from '../client/utils/UpgradeManager.js';
import { FakeIO, sleep } from './support/fakeIo.js';

function setup(options = {}) {
  const io = new FakeIO();
  const manager = new LobbyManager(io, {
    rateLimit: false,
    rollDelayMs: 1,
    startDelayMs: 1,
    rollGraceMs: 10000,
    timeoutGraceMs: 2,
    cleanupDelayMs: 5,
    pruneIntervalMs: 0,
    roll: () => [1, 1, 1, 1, 1],
    random: () => 0.5,
    ...options
  });
  const host = io.addSocket('s1', { id: 'u1', name: 'Host', type: 'guest' });
  const guest = io.addSocket('s2', { id: 'u2', name: 'Guest', type: 'guest' });
  manager.registerSocket(host);
  manager.registerSocket(guest);
  return { io, manager, host, guest };
}

function createLobby(host, config = {}) {
  host.trigger('create-lobby', {
    players: 2,
    rounds: 5,
    progression: true,
    ...config
  });
  const created = host.last('lobby-created');
  assert.ok(created?.code, 'lobby-created should carry a code');
  return created.code;
}

async function startGame(context, config = {}) {
  const { host, guest } = context;
  const code = createLobby(host, config);
  guest.trigger('join-lobby', code);
  host.trigger('toggle-ready', code);
  guest.trigger('toggle-ready', code);
  host.trigger('start-game', code);
  await sleep(15);
  return code;
}

function currentTurn(socket) {
  return socket.received
    .filter((entry) => entry.event === 'turn-start')
    .at(-1)?.payload?.playerIndex ?? null;
}

test('progression starts from the local one-die state and uses server-owned prices', async (t) => {
  const context = setup();
  const { manager, host } = context;
  t.after(() => manager.dispose());
  const code = await startGame(context, { costMultiplier: 2 });
  const game = manager.activeGames[code];
  const start = host.last('turn-start');

  assert.equal(start.progressionEnabled, true);
  assert.equal(start.progression.diceUnlocked, 1);
  assert.equal(start.shop.dice.current, 1);
  assert.equal(start.shop.dice.cost, 20);
  assert.equal(start.shop.luck.effective, 1);
  assert.equal(start.shop.big.length, 8);
  assert.equal(game.players[0].score, 0);

  // The server rejects both an unaffordable purchase and an attempt by the
  // player who is not taking the current turn.
  host.trigger('buy-upgrade', { code, kind: 'dice' });
  assert.equal(host.last('upgrade-failed').reason, 'insufficient_score');

  context.guest.trigger('buy-upgrade', { code, kind: 'dice' });
  assert.equal(context.guest.last('upgrade-failed').reason, 'not_your_turn');

  game.players[0].score = 20;
  host.trigger('buy-upgrade', { code, kind: 'dice' });
  const bought = host.last('upgrade-result');
  assert.equal(bought.cost, 20);
  assert.equal(bought.score, 0);
  assert.equal(bought.progression.diceUnlocked, 2);
  assert.equal(host.last('game-state').players[0].score, 0);

  host.trigger('player-roll', { code });
  await sleep(15);
  const result = host.last('turn-result');
  assert.equal(result.dice.length, 2);
  assert.equal(result.combo.key, 'pair');
  assert.equal(result.scored, 4);
  assert.equal(result.scores[0], 4);

  // Local play closes the shop once the roll has started.
  host.trigger('buy-upgrade', { code, kind: 'dice' });
  assert.equal(host.last('upgrade-failed').reason, 'not_available');
});

test('online lobbies always use local progression and ignore classic settings', async (t) => {
  const context = setup();
  const { manager, host } = context;
  t.after(() => manager.dispose());
  const code = await startGame(context, { progression: false, combos: false, rounds: 5 });
  const game = manager.activeGames[code];
  const start = host.last('turn-start');

  assert.equal(start.progressionEnabled, true);
  assert.equal(start.progression.diceUnlocked, 1);
  assert.ok(start.shop);
  assert.ok(game.players[0].progression);
  assert.equal(game.totalRounds, 10);

  host.trigger('player-roll', { code });
  await sleep(15);
  const result = host.last('turn-result');
  assert.equal(result.dice.length, 1);
  assert.equal(result.scored, 1);
  assert.equal(game.players[0].score, 1);
});

test('turn-start income, interest, and catch-up boosts follow the local formulas', async (t) => {
  const context = setup();
  const { manager, host } = context;
  t.after(() => manager.dispose());
  const code = await startGame(context);
  const game = manager.activeGames[code];
  const player = game.players[0];
  const other = game.players[1];
  const p = player.progression;

  p.economyLevel = 1;
  player.score = 0;
  other.score = 0;
  let summary = manager.applyTurnStart(game, player);
  assert.equal(summary.income, 1);
  assert.equal(player.score, 1);

  p.economyLevel = 0;
  p.interestRate = 0.1;
  player.score = 100;
  other.score = 0;
  summary = manager.applyTurnStart(game, player);
  assert.equal(summary.income, 0);
  assert.equal(summary.interest, 10);
  assert.equal(player.score, 110);

  p.interestRate = 0;
  player.score = 1;
  other.score = 100;
  player.energyBoostGiven = false;
  game.round = 1;
  game.totalRounds = 5;
  summary = manager.applyTurnStart(game, player);
  assert.equal(summary.energyBoost, 20);
  assert.equal(player.score, 21);
  assert.equal(player.energyBoostGiven, true);

  player.score = 1;
  other.score = 100;
  player.energyBoostGiven = true;
  game.round = 5;
  game.megaEnergyBoostGiven = false;
  summary = manager.applyTurnStart(game, player);
  assert.equal(summary.megaEnergyBoost, 40);
  assert.equal(player.score, 41);
  assert.equal(game.megaEnergyBoostGiven, true);

  p.economyLevel = 1;
  p.ecoRoundRate = 0.5;
  p.interestRate = 0;
  player.score = 0;
  other.score = 0;
  game.round = 3;
  summary = manager.applyTurnStart(game, player);
  assert.equal(summary.income, 2, 'High Stonks scales income by completed rounds');
  assert.equal(player.score, 2);
});

test('economy income and upgrade costs match the local UpgradeManager', () => {
  const server = new PlayerProgression({ costMultiplier: 1 });
  const local = new UpgradeManager();

  for (const level of [0, 1, 2, 4, 5, 9, 10, 24, 25, 49, 50]) {
    server.economyLevel = level;
    local.economyLevel = level;

    assert.equal(server.getEconomyIncome(), local.getEconomyIncome(), `income at level ${level}`);
    assert.equal(server.getEconomyCost(), local.getEconomyCost(), `economy cost at level ${level}`);
    assert.equal(server.getLuckCost(), local.getScaledLuckCost(), `luck cost at level ${level}`);
  }
});

test('luck upgrades mirror the local cap and effective-luck progression', () => {
  const server = new PlayerProgression();

  assert.equal(server.getEffectiveLuck(), 1);
  while (server.getEffectiveLuck() < 6) server.upgradeLuck();
  assert.equal(server.getLuckLevel(), 25);
  assert.equal(server.getEffectiveLuck(), 6);
  assert.equal(server.canUpgradeLuck(Number.MAX_SAFE_INTEGER), false);
  assert.equal(server.upgradeLuck(), false);
});

test('the progression shop enforces costs, combo locks, and purchase ownership server-side', async (t) => {
  const context = setup();
  const { manager, host } = context;
  t.after(() => manager.dispose());
  const code = await startGame(context);
  const game = manager.activeGames[code];
  const player = game.players[0];
  const p = player.progression;

  // The client cannot choose the price; the server ignores the extra value
  // and charges the local luck formula.
  player.score = 50;
  host.trigger('buy-upgrade', { code, kind: 'luck', cost: 1 });
  let result = host.last('upgrade-result');
  assert.equal(result.cost, 50);
  assert.equal(result.score, 0);
  assert.equal(p.getLuckLevel(), 1);
  assert.equal(p.getEffectiveLuck(), 1.2);

  player.score = 1000;
  host.trigger('buy-upgrade', { code, kind: 'dice' });
  result = host.last('upgrade-result');
  assert.equal(result.cost, 10);
  assert.equal(p.diceUnlocked, 2);
  assert.equal(result.score, 990);

  host.trigger('buy-upgrade', { code, kind: 'combo', key: 'fiveOfAKind' });
  assert.equal(host.last('upgrade-failed').reason, 'locked');

  host.trigger('buy-upgrade', { code, kind: 'combo', key: 'pair' });
  result = host.last('upgrade-result');
  assert.equal(result.cost, 10);
  assert.equal(p.getComboLevel('pair'), 1);
  assert.equal(result.score, 980);

  player.score = 1000;
  host.trigger('buy-upgrade', { code, kind: 'big', key: 'clairvoyance' });
  result = host.last('upgrade-result');
  assert.equal(result.cost, 500);
  assert.equal(result.score, 500);
  assert.equal(p.hasBigUpgrade('clairvoyance'), true);
  assert.equal(p.getClairvoyanceChance(), 0.25);

  host.trigger('buy-upgrade', { code, kind: 'big', key: 'clairvoyance' });
  assert.equal(host.last('upgrade-failed').reason, 'unavailable');
});

test('big-upgrade effects match the local UpgradeManager', () => {
  const server = new PlayerProgression({ bigUpgradesEnabled: true });
  const local = new UpgradeManager();
  const defs = getActiveBigUpgrades([]);

  for (const def of defs) {
    assert.equal(
      server.buyBigUpgrade(def.key),
      true,
      `${def.key} should be purchasable on the server`
    );
    assert.equal(
      local.buyBigUpgrade(def.key),
      true,
      `${def.key} should be purchasable locally`
    );

    assert.equal(server.getClairvoyanceChance(), local.getClairvoyanceChance(), def.key);
    assert.equal(server.getEconomyMultiplier(), local.getEconomyMultiplier(), def.key);
    assert.equal(server.getComboGlobalMultiplier(), local.getComboGlobalMultiplier(), def.key);
    assert.equal(server.getDiceScoreMultiplier(), local.getDiceScoreMultiplier(), def.key);
    assert.equal(server.getInterestRate(), local.getInterestRate(), def.key);
    assert.equal(server.getHighStonksMultiplier(4), local.getHighStonksMultiplier(4), def.key);
    assert.equal(
      server.getComboStreakMultiplier(4),
      local.getComboStreakMultiplier(4),
      def.key
    );
    assert.deepEqual(server.getSpinEffectConfig(), local.getSpinEffectConfig(), def.key);
  }
});

test('combo upgrader and score drain use the same local and online rules', () => {
  const customDefs = [
    {
      key: 'comboUpgrader',
      title: 'Combo Upgrader',
      baseCost: 1000000,
      effect: 'comboUpgrade',
      values: { percentage: 0.05, isMultiplicative: false }
    },
    {
      key: 'scoreDrain',
      title: 'Score Drain',
      baseCost: 2000000,
      effect: 'scoreDrain',
      values: { percentage: 0.1, numPlayers: 1, stealMethod: 'random' }
    }
  ];
  const local = new UpgradeManager();
  local.setBigUpgradeDefs(customDefs);
  const online = new PlayerProgression({ bigUpgradesEnabled: true, customBigUpgrades: customDefs });

  assert.equal(local.buyBigUpgrade('comboUpgrader'), true);
  assert.equal(online.buyBigUpgrade('comboUpgrader'), true);
  local.comboLevels.pair = 10;
  online.comboLevels.pair = 10;
  assert.equal(local.getComboMultiplier('pair'), 2.5);
  assert.equal(online.getComboMultiplier('pair'), 2.5);

  local.comboUpgradeIsMultiplicative = true;
  online.comboUpgradeIsMultiplicative = true;
  assert.equal(local.getComboMultiplier('pair'), online.getComboMultiplier('pair'));
  assert.ok(Math.abs(local.getComboMultiplier('pair') - 2 * Math.pow(1.05, 10)) < 1e-9);

  assert.equal(local.buyBigUpgrade('scoreDrain'), true);
  assert.equal(online.buyBigUpgrade('scoreDrain'), true);
  local.scoreDrainNumPlayers = 2;
  online.scoreDrainNumPlayers = 2;
  const players = [
    { score: 1000 },
    { score: 100 },
    { score: 500 },
    { score: 50 },
    { score: 10000 }
  ];

  for (const method of ['random', 'highest', 'lowest', 'before', 'after']) {
    local.scoreDrainStealMethod = method;
    online.scoreDrainStealMethod = method;
    const localResult = local.resolveScoreDrain({ ownerIndex: 1, players, random: () => 0 });
    const onlineResult = online.resolveScoreDrain({ ownerIndex: 1, players, random: () => 0 });
    assert.deepEqual(localResult.targets, onlineResult.targets, method);
    assert.equal(new Set(localResult.targets.map((target) => target.index)).size, localResult.targets.length);
    assert.equal(localResult.targets.some((target) => target.index === 1), false);
    assert.equal(localResult.total, localResult.targets.reduce((sum, target) => sum + target.amount, 0));
  }

  local.scoreDrainStealMethod = 'highest';
  online.scoreDrainStealMethod = 'highest';
  const highest = local.resolveScoreDrain({ ownerIndex: 1, players });
  assert.deepEqual(highest.targets, [{ index: 4, amount: 1000 }, { index: 0, amount: 100 }]);
  local.scoreDrainStealMethod = 'before';
  const before = local.resolveScoreDrain({ ownerIndex: 1, players });
  assert.deepEqual(before.targets, [{ index: 0, amount: 100 }, { index: 4, amount: 1000 }]);

  for (const method of ['random', 'highest', 'lowest', 'before', 'after']) {
    local.scoreDrainStealMethod = method;
    online.scoreDrainStealMethod = method;
    const claimedLocal = local.resolveScoreDrain({
      ownerIndex: 1,
      players,
      claimedBy: { 4: 0 },
      random: () => 0
    });
    const claimedOnline = online.resolveScoreDrain({
      ownerIndex: 1,
      players,
      claimedBy: { 4: 0 },
      random: () => 0
    });
    assert.deepEqual(claimedLocal.targets, claimedOnline.targets, method);
    assert.deepEqual(claimedLocal.skipped, claimedOnline.skipped, method);
    assert.deepEqual(claimedLocal.skipped, [{ index: 4, claimedBy: 0 }], method);
    assert.equal(claimedLocal.targets.some((target) => target.index === 4), false, method);
  }

  local.scoreDrainStealMethod = 'highest';
  online.scoreDrainStealMethod = 'highest';
  const sameOwner = local.resolveScoreDrain({ ownerIndex: 1, players, claimedBy: { 4: 1 } });
  assert.deepEqual(sameOwner.targets, [{ index: 4, amount: 1000 }, { index: 0, amount: 100 }]);
});

test('score drain transfers points at the end of the owner turn and emits state', async (t) => {
  const context = setup();
  const { manager, host, guest } = context;
  t.after(() => manager.dispose());
  const code = await startGame(context);
  const game = manager.activeGames[code];
  const owner = game.players[0];
  owner.score = 100;
  owner.progression.scoreDrainPercent = 0.1;
  owner.progression.scoreDrainNumPlayers = 1;
  owner.progression.scoreDrainStealMethod = 'highest';
  game.players[1].score = 1000;
  owner.hasRolled = true;

  manager.advanceTurn(code);
  const drain = host.last('score-drain');
  assert.ok(drain, 'the server emits the drain result');
  assert.equal(drain.ownerIndex, 0);
  assert.deepEqual(drain.targets, [{ index: 1, amount: 100 }]);
  assert.deepEqual(drain.skipped, []);
  assert.equal(drain.total, 100);
  assert.deepEqual(drain.scores, [200, 900]);
  assert.equal(owner.score, 200);
  assert.equal(game.players[1].score, 900);
  assert.deepEqual(game.scoreDrainClaims, { 1: 0 });
  assert.equal(currentTurn(guest), 1);
});

test('score drain claims block cross-owner targets in server state', (t) => {
  const context = setup();
  const { manager } = context;
  t.after(() => manager.dispose());
  const customDefs = [{
    key: 'scoreDrain',
    title: 'Score Drain',
    baseCost: 2000000,
    effect: 'scoreDrain',
    values: { percentage: 0.1, numPlayers: 1, stealMethod: 'highest' }
  }];
  const players = [100, 900, 1000].map((score) => {
    const progression = new PlayerProgression({
      bigUpgradesEnabled: true,
      customBigUpgrades: customDefs
    });
    progression.scoreDrainPercent = 0.1;
    progression.scoreDrainNumPlayers = 1;
    progression.scoreDrainStealMethod = 'highest';
    return { score, progression };
  });
  const game = { players, scoreDrainClaims: {} };

  const first = manager.applyScoreDrain(game, 0);
  assert.deepEqual(first.targets, [{ index: 2, amount: 100 }]);
  const second = manager.applyScoreDrain(game, 1);
  assert.deepEqual(second.targets, [{ index: 0, amount: 20 }]);
  assert.deepEqual(second.skipped, [{ index: 2, claimedBy: 0 }]);
  assert.deepEqual(game.scoreDrainClaims, { 2: 0, 0: 1 });
  assert.deepEqual(players.map((player) => player.score), [180, 920, 900]);

  players[2].progression.scoreDrainPercent = 0.1;
  players[2].progression.scoreDrainNumPlayers = 1;
  players[2].progression.scoreDrainStealMethod = 'highest';
  game.scoreDrainClaims = { 0: 1, 1: 0 };
  const beforeBlocked = players.map((player) => player.score);
  const blocked = manager.applyScoreDrain(game, 2);
  assert.deepEqual(blocked.targets, []);
  assert.deepEqual(blocked.skipped, [
    { index: 0, claimedBy: 1 },
    { index: 1, claimedBy: 0 }
  ]);
  assert.deepEqual(players.map((player) => player.score), beforeBlocked);
  assert.deepEqual(game.scoreDrainClaims, { 0: 1, 1: 0 });
});

test('progression scoring applies dice multipliers, combo levels, streaks, and Rollicane', (t) => {
  const context = setup();
  const { manager } = context;
  t.after(() => manager.dispose());

  const p = new PlayerProgression({ bigUpgradesEnabled: true });
  p.comboLevels.pair = 1;
  p.comboGlobalMultiplier = 1.5;
  p.comboStreakPercent = 0.2;
  const game = { config: { progression: true, combos: true }, round: 1 };
  const player = {
    progression: p,
    score: 0,
    comboStats: {}
  };

  const first = manager.scoreRoll(game, player, [1, 1]);
  assert.equal(first.base, 2);
  assert.equal(first.points, 6);
  assert.ok(Math.abs(first.comboMultiplier - 3.3) < 1e-9);
  assert.equal(first.comboBreakdown.key, 'pair');
  assert.equal(first.comboBreakdown.level, 1);
  assert.equal(first.comboBreakdown.baseMultiplier, 2);
  assert.equal(first.comboBreakdown.upgradeMultiplier, 1.1);
  assert.equal(first.comboBreakdown.globalMultiplier, 1.5);
  assert.equal(first.comboBreakdown.streak, 1);
  assert.ok(Math.abs(first.comboBreakdown.totalMultiplier - 3.3) < 1e-9);

  const second = manager.scoreRoll(game, player, [1, 1]);
  assert.equal(second.points, 7, '3.3 is rounded to two decimals before the 1.2 streak multiplier');
  assert.equal(player.score, 13);
  assert.equal(player.comboStats.pair, 2);
  assert.equal(second.comboBreakdown.streak, 2);
  assert.ok(Math.abs(second.comboBreakdown.streakMultiplier - 1.2) < 1e-9);
  assert.ok(Math.abs(second.comboBreakdown.totalMultiplier - 3.96) < 1e-9);

  p.comboLevels = {};
  p.comboGlobalMultiplier = 1;
  p.comboStreakPercent = 0;
  p.spinEffectConfig = { chance: 1, minSec: 2, maxSec: 2 };
  manager.random = () => 0;
  const rollicane = manager.scoreRoll(game, player, [1]);
  assert.equal(rollicane.base, 1);
  assert.equal(rollicane.rollicaneBonus, 2);
  assert.equal(rollicane.points, 3);
  assert.equal(rollicane.comboBreakdown, null);
});

test('clairvoyance predictions are private and refresh when a die is purchased', async (t) => {
  const context = setup();
  const { manager, host, guest } = context;
  t.after(() => manager.dispose());
  const code = await startGame(context);
  const game = manager.activeGames[code];
  const player = game.players[0];
  const p = player.progression;

  p.clairvoyanceChance = 1;
  game.turnStarted = false;
  manager.startTurn(code);
  await sleep(5);

  assert.equal(host.last('player-prediction').prediction.length, 1);
  assert.equal(guest.last('player-prediction'), undefined);

  const guestState = manager.gameStatePayload(game, code, 1);
  assert.equal(JSON.stringify(guestState).includes('"prediction"'), false);

  player.score = 10;
  host.trigger('buy-upgrade', { code, kind: 'dice' });
  assert.equal(host.last('upgrade-result').progression.diceUnlocked, 2);
  assert.equal(host.last('player-prediction').prediction.length, 2);
  assert.equal(guest.count('player-prediction'), 0);

  host.trigger('player-roll', { code });
  await sleep(15);
  const result = host.last('turn-result');
  assert.equal(result.predictionUsed, true);
  assert.equal(result.dice.length, 2);
});

test('a sleeping progression player is auto-rolled with one die and then advances', async (t) => {
  const context = setup();
  const { manager, host, guest } = context;
  t.after(() => manager.dispose());
  const code = await startGame(context);
  const game = manager.activeGames[code];

  game.turnExpiresAt = Date.now() - 1;
  manager.handleTimeout(code, game.turnId);
  await sleep(10);

  const timeout = host.last('player-timeout');
  assert.ok(timeout);
  assert.equal(timeout.dice.length, 1);
  assert.equal(timeout.scored, 1);
  assert.equal(timeout.scores[0], 1);
  assert.equal(timeout.progression.diceUnlocked, 1);
  assert.equal(currentTurn(guest), 1);
});

test('progression matches advance rounds and finish with authoritative scores', async (t) => {
  const context = setup();
  const { manager, host, guest } = context;
  t.after(() => manager.dispose());
  const code = await startGame(context);

  let guard = 0;
  while (!host.last('game-finished') && guard < 30) {
    const turn = currentTurn(host);
    const actor = turn === 0 ? host : guest;
    actor.trigger('player-roll', { code });
    await sleep(8);
    actor.trigger('player-end-turn', { code });
    await sleep(3);
    guard += 1;
  }

  const finished = host.last('game-finished');
  assert.ok(finished);
  assert.deepEqual(finished.scores, [10, 10]);
  assert.equal(finished.progressionEnabled, true);
  assert.equal(finished.players[0].progression.diceUnlocked, 1);
  assert.equal(manager.activeGames[code], undefined);
});
