import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserHarness } from './support/online.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-online-turn-state-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

let server;
const harness = createBrowserHarness({ sessionSecret: 'browser-online-turn-state-secret' });
const {
  registerGuest,
  openGame,
  clickGame,
  startOnlineMatch
} = harness;

before(async () => {
  await harness.start();
  server = harness.server;
});

after(async () => {
  await harness.stop();
});

test('online restores rolled state, keeps private predictions, and enables End Turn immediately', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-turn-state-host');
  const guestAuth = await registerGuest('online-turn-state-guest');
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
    activeGame.players[0].prediction = [4];
    server.lobbyManager.emitGameState(created.code);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.prediction?.[0] === 4 &&
        scene?.predictionText?.text?.includes('Prediction: 4');
    }, null, { timeout: 15000 });

    const guestPrediction = await guest.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.prediction;
    });
    assert.equal(guestPrediction, null, 'the prediction is not exposed to the opponent');

    await clickGame(host.page, 600, 300);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?._hasRolledThisTurn === true;
    }, null, { timeout: 15000 });

    const afterRoll = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return {
        endTurnEnabled: scene.endTurnBtn.input?.enabled === true,
        rollEnabled: scene.rollBtn.input?.enabled === true,
        prediction: scene.prediction
      };
    });
    assert.equal(afterRoll.endTurnEnabled, true, 'End Turn should be available with the result');
    assert.equal(afterRoll.rollEnabled, false, 'the roll button should be locked after rolling');
    assert.equal(afterRoll.prediction, null, 'using the prediction clears it');

    // A state broadcast can arrive while the turn is still open. It must not
    // make the client think it can roll again.
    server.lobbyManager.emitGameState(created.code);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?._hasRolledThisTurn === true &&
        scene?.endTurnBtn?.input?.enabled === true &&
        scene?.rollBtn?.input?.enabled === false;
    }, null, { timeout: 15000 });

    await clickGame(host.page, 600, 360);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 1;
    }, null, { timeout: 15000 });

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
