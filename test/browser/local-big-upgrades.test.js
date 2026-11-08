import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserHarness } from './support/online.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-local-big-upgrades-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

const harness = createBrowserHarness({ sessionSecret: 'browser-local-big-upgrades-secret' });
const { registerGuest, openGame, startScene } = harness;

before(async () => {
  await harness.start();
});

after(async () => {
  await harness.stop();
});

test('local turn end applies Score Drain and blocks cross-owner victims', {
  timeout: 60000
}, async () => {
  const auth = await registerGuest('local-score-drain');
  const game = await openGame(auth.cookie);

  try {
    await startScene(game.page, 'LocalGameScene', {
      players: 3,
      rounds: 10,
      teamsEnabled: false,
      teams: ['blue', 'red', 'blue'],
      bigUpgradesEnabled: true,
      costMult: 1,
      names: ['Host', 'Second', 'Third'],
      ai: [false, false, false]
    });

    const result = await game.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('LocalGameScene');
      const configureDrain = (player) => {
        player.upgrades.scoreDrainPercent = 0.1;
        player.upgrades.scoreDrainNumPlayers = 1;
        player.upgrades.scoreDrainStealMethod = 'highest';
      };
      configureDrain(scene.players[0]);
      configureDrain(scene.players[1]);
      scene.players[0].score = 100;
      scene.players[1].score = 900;
      scene.players[2].score = 1000;
      scene.currentPlayerIndex = 0;
      scene.endTurn('test');
      scene.endTurn('test');
      return {
        currentPlayerIndex: scene.currentPlayerIndex,
        scores: scene.players.map((player) => player.score),
        claims: scene.scoreDrainClaims,
        history: scene.history?.entries || []
      };
    });

    assert.equal(result.currentPlayerIndex, 2);
    assert.deepEqual(result.scores, [180, 920, 900]);
    assert.deepEqual(result.claims, { 2: 0, 0: 1 });
    assert.ok(result.history.some((entry) => entry.includes('Skipped Third (claimed by Host)')));
    assert.deepEqual(game.pageErrors, []);
  } finally {
    await game.context.close();
  }
});

test('local investor descriptions show the configured interest cap note', {
  timeout: 60000
}, async () => {
  const auth = await registerGuest('local-investor-cap');
  const game = await openGame(auth.cookie);

  try {
    await startScene(game.page, 'LocalGameScene', {
      players: 2,
      rounds: 10,
      bigUpgradesEnabled: true,
      costMult: 1,
      names: ['Host', 'Second'],
      ai: [false, false],
      customBigUpgrades: [{
        key: 'cappedInvestor',
        title: 'Capped Investor',
        baseCost: 1000,
        effect: 'interestRate',
        value: 0.2,
        investmentCap: 1.2
      }]
    });

    const description = await game.page.evaluate(() => (
      window.__SCALE_DICE_TEST__.game.scene
        .getScene('LocalGameScene')
        .bigUpgradesToolbar?.[0]?.desc?.text || ''
    ));

    assert.equal(description, 'Gain 20% of current score each turn. (+20% max interest)');
    assert.deepEqual(game.pageErrors, []);
  } finally {
    await game.context.close();
  }
});

test('local Score Drain logs a blocked history entry when every target is claimed', {
  timeout: 60000
}, async () => {
  const auth = await registerGuest('local-score-drain-blocked');
  const game = await openGame(auth.cookie);

  try {
    await startScene(game.page, 'LocalGameScene', {
      players: 3,
      rounds: 10,
      teamsEnabled: false,
      teams: ['blue', 'red', 'blue'],
      bigUpgradesEnabled: true,
      costMult: 1,
      names: ['Host', 'Second', 'Third'],
      ai: [false, false, false]
    });

    const result = await game.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('LocalGameScene');
      const owner = scene.players[1];
      owner.upgrades.scoreDrainPercent = 0.1;
      owner.upgrades.scoreDrainNumPlayers = 1;
      owner.upgrades.scoreDrainStealMethod = 'highest';
      scene.players[0].score = 100;
      scene.players[1].score = 900;
      scene.players[2].score = 1000;
      scene.scoreDrainClaims = { 0: 2, 2: 0 };
      scene.currentPlayerIndex = 1;
      scene.endTurn('test');
      return {
        currentPlayerIndex: scene.currentPlayerIndex,
        scores: scene.players.map((player) => player.score),
        claims: scene.scoreDrainClaims,
        history: scene.history?.entries || []
      };
    });

    assert.equal(result.currentPlayerIndex, 2);
    assert.deepEqual(result.scores, [100, 900, 1000]);
    assert.deepEqual(result.claims, { 0: 2, 2: 0 });
    assert.ok(result.history.some((entry) => (
      entry.includes('found no available targets') &&
      entry.includes('claimed by')
    )));
    assert.deepEqual(game.pageErrors, []);
  } finally {
    await game.context.close();
  }
});
