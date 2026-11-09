import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserHarness } from './support/online.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-online-parity-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

let server;
const harness = createBrowserHarness({ sessionSecret: 'browser-online-parity-secret' });
const {
  registerGuest,
  openGame,
  clickGame,
  sceneState,
  createOnlineLobby,
  joinOnlineLobby,
  readyAndStart,
  startOnlineMatch
} = harness;

before(async () => {
  await harness.start();
  server = harness.server;
});

after(async () => {
  await harness.stop();
});

test('online Rollicane uses the server spin duration and logs the activity', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-rollicane-host');
  const guestAuth = await registerGuest('online-rollicane-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    const created = await startOnlineMatch(host, guest, { timeLimitSeconds: 300 });
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.scores?.length === 2;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    activeGame.players[0].score = 0;
    activeGame.players[0].progression.spinEffectConfig = {
      chance: 1,
      minSec: 2,
      maxSec: 2,
      label: 'Dice Spin'
    };
    server.lobbyManager.emitGameState(created.code);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.scores?.[0] === 0 && scene?.rollBtn?.input?.enabled === true;
    }, null, { timeout: 15000 });

    await clickGame(host.page, 600, 470);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?._rollicaneActive === true;
    }, null, { timeout: 10000 });

    const spinStartedAt = Date.now();
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?._rollicaneActive === false &&
        scene?._hasRolledThisTurn === true &&
        scene?.scores?.length === 2 &&
        scene?.history?.entries?.some((entry) => entry.includes('Dice Spin'));
    }, null, { timeout: 15000 });
    const spinElapsedMs = Date.now() - spinStartedAt;

    const observed = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return { scores: scene.scores.slice(), history: scene.history?.entries || [] };
    });

    assert.ok(spinElapsedMs >= 1500, `Rollicane should pace for roughly two seconds (took ${spinElapsedMs}ms)`);
    assert.equal(observed.scores.length, 2, 'the active match keeps one score per remaining player');
    assert.equal(observed.scores[1], 0, 'the opponent score is not replaced by a spin score');
    assert.ok(observed.scores[0] > 0, 'the spinning player receives the server score');
    assert.ok(observed.history.some((entry) => entry.includes('Dice Spin')));
    assert.ok(observed.history.some((entry) => entry.includes('rolled [')));

    const liveGame = server.lobbyManager.activeGames[created.code];
    assert.ok(liveGame, 'the turn should remain open while the spin animation completes');
    assert.ok(liveGame.turnExpiresAt - Date.now() > 5000, 'server deadline includes the spin grace time');

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

test('online score breakdown mirrors the local combo and streak detail', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-breakdown-host');
  const guestAuth = await registerGuest('online-breakdown-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    const created = await startOnlineMatch(host, guest, { timeLimitSeconds: 300 });
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.scores?.length === 2;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    const progression = activeGame.players[0].progression;
    progression.diceUnlocked = 2;
    progression.diceScoreMultiplier = 1;
    progression.comboLevels.pair = 0;
    progression.comboGlobalMultiplier = 1;
    progression.comboStreakPercent = 0.2;
    progression.comboStreakLabel = 'Combo Masher';
    progression.lastComboKey = 'pair';
    progression.comboStreak = 1;
    activeGame.players[0].prediction = [2, 2];
    server.lobbyManager.emitGameState(created.code);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.rollBtn?.input?.enabled === true;
    }, null, { timeout: 15000 });

    await host.page.evaluate(() => {
      window.__breakdownTurnResult = new Promise((resolve, reject) => {
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const timer = setTimeout(() => reject(new Error('breakdown turn-result timed out')), 10000);
        socket.once('turn-result', (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
    });
    await clickGame(host.page, 600, 470);
    const turnResult = await host.page.evaluate(() => window.__breakdownTurnResult);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.scoreBreakdown?.text?.includes('Total Combo Multiplier');
    }, null, { timeout: 15000 });

    const breakdown = await host.page.evaluate(() => (
      window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene').scoreBreakdown.text
    ));

    assert.equal(turnResult.comboBreakdown.streak, 2);
    assert.equal(turnResult.comboBreakdown.level, 0);
    assert.equal(turnResult.comboBreakdown.baseMultiplier, 2);
    assert.match(breakdown, /Rolled: 2, 2/);
    assert.match(breakdown, /Base Score: 4/);
    assert.match(breakdown, /Combo: Pair \(Level 0: x1\.00\)/);
    assert.match(breakdown, /Base Multiplier: x2\.00/);
    assert.match(breakdown, /- Combo Masher: 2 \(20%\)/);
    assert.match(breakdown, /-> Streak Multiplier: x1\.20/);
    assert.match(breakdown, /Total Combo Multiplier: x2\.40/);
    assert.match(breakdown, /Final Score: 9/);

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

test('online score drain transfers score and reaches the client history', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-drain-host');
  const guestAuth = await registerGuest('online-drain-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    const created = await startOnlineMatch(host, guest, { timeLimitSeconds: 300 });
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.scores?.length === 2;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    const owner = activeGame.players[0];
    owner.score = 100;
    activeGame.players[1].score = 1000;
    owner.progression.scoreDrainPercent = 0.1;
    owner.progression.scoreDrainNumPlayers = 1;
    owner.progression.scoreDrainStealMethod = 'highest';
    owner.hasRolled = true;

    await host.page.evaluate(() => {
      window.__scoreDrainEvent = new Promise((resolve, reject) => {
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const timer = setTimeout(() => reject(new Error('score-drain timed out')), 10000);
        socket.once('score-drain', (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
    });
    server.lobbyManager.advanceTurn(created.code);
    const drain = await host.page.evaluate(() => window.__scoreDrainEvent);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.scores?.[0] === 200 &&
        scene?.scores?.[1] === 900 &&
        scene?.history?.entries?.some((entry) => entry.includes('drained'));
    }, null, { timeout: 15000 });

    assert.equal(drain.total, 100);
    assert.deepEqual(drain.targets, [{ index: 1, amount: 100 }]);
    assert.equal(owner.score, 200);
    assert.equal(activeGame.players[1].score, 900);
    const observed = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return { scores: scene.scores.slice(), history: scene.history?.entries || [] };
    });
    assert.deepEqual(observed.scores, [200, 900]);
    assert.ok(observed.history.some((entry) => entry.includes('drained')));

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

test('online score drain claims block cross-owner targets and surface a blocked all-claimed drain', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-drain-claims-host');
  const guestAuth = await registerGuest('online-drain-claims-guest');
  const thirdAuth = await registerGuest('online-drain-claims-third');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);
  const third = await openGame(thirdAuth.cookie);

  try {
    const created = await createOnlineLobby(host, {
      timeLimitSeconds: 300,
      configure: async (page) => {
        await clickGame(page, 520, 165);
        await sceneState(page, 'OnlineConfigScene', (scene) => scene.selectedPlayers === 3);
      }
    });
    assert.equal(created.config.players, 3);

    await joinOnlineLobby(host, guest, created.code);
    await joinOnlineLobby(host, third, created.code, 3);
    await readyAndStart(host, guest, third);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.scores?.length === 3;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the three-player game should be running');
    const owner0 = activeGame.players[0];
    const owner1 = activeGame.players[1];
    const configureDrain = (player) => {
      player.progression.scoreDrainPercent = 0.1;
      player.progression.scoreDrainNumPlayers = 1;
      player.progression.scoreDrainStealMethod = 'highest';
    };
    configureDrain(owner0);
    configureDrain(owner1);
    owner0.score = 100;
    owner1.score = 900;
    activeGame.players[2].score = 1000;
    owner0.hasRolled = true;
    owner1.hasRolled = true;

    await host.page.evaluate(() => {
      window.__scoreDrainEvents = new Promise((resolve, reject) => {
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const events = [];
        const timer = setTimeout(() => reject(new Error('score-drain events timed out')), 10000);
        const onDrain = (payload) => {
          events.push(payload);
          if (events.length === 2) {
            clearTimeout(timer);
            socket.off('score-drain', onDrain);
            resolve(events);
          }
        };
        socket.on('score-drain', onDrain);
      });
    });

    server.lobbyManager.advanceTurn(created.code);
    server.lobbyManager.advanceTurn(created.code);
    const drains = await host.page.evaluate(() => window.__scoreDrainEvents);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.scores?.[0] === 180 &&
        scene?.scores?.[1] === 920 &&
        scene?.scores?.[2] === 900 &&
        (scene?.history?.entries || []).filter((entry) => entry.includes('drained')).length === 2;
    }, null, { timeout: 15000 });

    assert.deepEqual(drains.map((drain) => drain.targets), [
      [{ index: 2, amount: 100 }],
      [{ index: 0, amount: 20 }]
    ]);
    assert.deepEqual(drains[0].skipped, []);
    assert.deepEqual(drains[1].skipped, [{ index: 2, claimedBy: 0 }]);
    assert.deepEqual(activeGame.scoreDrainClaims, { 2: 0, 0: 1 });
    const observed = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene.history?.entries || [];
    });
    assert.ok(observed.some((entry) => entry.includes(
      `Skipped ${activeGame.players[2].name} (claimed by ${activeGame.players[0].name})`
    )));
    assert.deepEqual(owner0.score, 180);
    assert.deepEqual(owner1.score, 920);
    assert.deepEqual(activeGame.players[2].score, 900);

    assert.equal(activeGame.currentIndex, 2);
    const owner2 = activeGame.players[2];
    configureDrain(owner2);
    activeGame.scoreDrainClaims = { 0: 1, 1: 0 };
    const beforeBlocked = activeGame.players.map((player) => player.score);
    await host.page.evaluate(() => {
      window.__blockedScoreDrain = new Promise((resolve, reject) => {
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const timer = setTimeout(() => reject(new Error('blocked score-drain timed out')), 10000);
        socket.once('score-drain', (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
    });
    server.lobbyManager.advanceTurn(created.code);
    const blocked = await host.page.evaluate(() => window.__blockedScoreDrain);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return (scene?.history?.entries || []).some((entry) => (
        entry.includes('found no available targets') && entry.includes('claimed by')
      ));
    }, null, { timeout: 15000 });

    assert.deepEqual(blocked.targets, []);
    assert.equal(blocked.total, 0);
    assert.deepEqual(blocked.skipped, [
      { index: 0, claimedBy: 1 },
      { index: 1, claimedBy: 0 }
    ]);
    assert.deepEqual(blocked.scores, beforeBlocked);
    assert.deepEqual(activeGame.players.map((player) => player.score), beforeBlocked);
    assert.deepEqual(activeGame.scoreDrainClaims, { 0: 1, 1: 0 });

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
    assert.deepEqual(third.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
    await third.context.close();
  }
});

test('online results record achievements and wait for every popup before postgame', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-achievements-host');
  const guestAuth = await registerGuest('online-achievements-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    const created = await startOnlineMatch(host, guest, { timeLimitSeconds: 300 });
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.scores?.length === 2;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    activeGame.players[0].score = 15000;
    activeGame.players[1].score = 100;
    activeGame.players[0].comboStats.fourOfAKind = 1;
    activeGame.round = 3;
    server.lobbyManager.finishGame(created.code, activeGame);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?._achievementSequenceStarted === true;
    }, null, { timeout: 30000 });

    const duringSequence = await host.page.evaluate(() => {
      const game = window.__SCALE_DICE_TEST__.game;
      const scene = game.scene.getScene('OnlineGameScene');
      return {
        popupVisible: Boolean(scene?.children.list.some((child) => (
          child.type === 'Text' && child.depth === 1001
        ))),
        postgameActive: game.scene.isActive('OnlinePostGameScene')
      };
    });
    assert.equal(duringSequence.popupVisible, true, 'an achievement popup is on screen');
    assert.equal(duringSequence.postgameActive, false, 'postgame waits for the popup sequence');

    await host.page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.game.scene.isActive('OnlinePostGameScene'),
      null,
      { timeout: 30000 }
    );
    const sequenceComplete = await host.page.evaluate(() => (
      window.__SCALE_DICE_TEST__.game.registry.get('onlineAchievementsComplete') === true
    ));
    assert.equal(sequenceComplete, true, 'the full achievement sequence completed before postgame');

    const saved = await host.page.evaluate(() => {
      const raw = localStorage.getItem('scaleDice_achievements');
      return raw ? JSON.parse(raw) : null;
    });

    assert.ok(saved, 'online results should persist achievement data');
    assert.equal(saved.totals.gamesPlayed, 1);
    assert.equal(saved.totals.roundsPlayed, 2);
    assert.equal(saved.totals.wins, 1);
    assert.equal(saved.totals.bestSingleMatchScore, 15000);
    assert.equal(saved.unlocked.firstPlay, true);
    assert.equal(saved.unlocked.wins1, true);
    assert.equal(saved.unlocked.score10000, true);
    assert.equal(saved.unlocked.fourOfAKind, true);

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
