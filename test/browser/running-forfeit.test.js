import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserHarness } from './support/online.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-running-forfeit-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

let server;
const harness = createBrowserHarness({ sessionSecret: 'browser-running-forfeit-secret' });
const {
  registerGuest,
  openGame,
  clickGame,
  sceneState,
  createOnlineLobby,
  joinOnlineLobby,
  readyAndStart
} = harness;

before(async () => {
  await harness.start();
  server = harness.server;
});

after(async () => {
  await harness.stop();
});

test('a three-player disconnect forfeits one seat while the match continues', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('running-forfeit-host');
  const guestAuth = await registerGuest('running-forfeit-guest');
  const thirdAuth = await registerGuest('running-forfeit-third');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);
  const third = await openGame(thirdAuth.cookie);
  let returning;

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
    assert.equal(activeGame.players.length, 3);

    await host.page.evaluate(() => {
      window.__playerLeft = new Promise((resolve, reject) => {
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const timer = setTimeout(() => reject(new Error('player-left timed out')), 10000);
        socket.once('player-left', (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
    });

    await guest.context.close();

    const left = await host.page.evaluate(() => window.__playerLeft);
    assert.equal(String(left.id), String(guestAuth.user.id));
    await host.page.waitForFunction((guestId) => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.playerSlots?.find((player) => String(player.id) === String(guestId))?.connected === false;
    }, guestAuth.user.id, { timeout: 15000 });

    const continuingGame = server.lobbyManager.activeGames[created.code];
    assert.ok(continuingGame, 'the match should continue with two active seats');
    assert.equal(continuingGame.finished, false);
    assert.equal(continuingGame.players.filter((player) => !player.left).length, 2);
    assert.equal(
      continuingGame.players.find((player) => String(player.id) === String(guestAuth.user.id)).left,
      true
    );

    const roll = await host.page.evaluate(({ code }) => new Promise((resolve, reject) => {
      const socket = window.__SCALE_DICE_TEST__.getSocket();
      const timer = setTimeout(() => reject(new Error('turn-result timed out')), 10000);
      socket.once('turn-result', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      socket.emit('player-roll', { code });
    }), { code: created.code });
    assert.equal(roll.scores.length, 3);
    assert.ok(roll.dice.length >= 1);

    const nextTurn = await host.page.evaluate(({ code }) => new Promise((resolve, reject) => {
      const socket = window.__SCALE_DICE_TEST__.getSocket();
      const timer = setTimeout(() => reject(new Error('turn-start timed out')), 10000);
      socket.once('turn-start', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      socket.emit('player-end-turn', { code });
    }), { code: created.code });
    assert.equal(nextTurn.playerIndex, 2);
    await host.page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene')?.currentPlayerIndex === 2,
      null,
      { timeout: 15000 }
    );

    returning = await openGame(guestAuth.cookie);
    await returning.page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.getSocket()?.connected === true,
      null,
      { timeout: 15000 }
    );
    const rejoinReason = await returning.page.evaluate(({ code }) => new Promise((resolve, reject) => {
      const socket = window.__SCALE_DICE_TEST__.getSocket();
      const timer = setTimeout(() => reject(new Error('rejoin attempt timed out')), 10000);
      socket.once('join-success', () => {
        clearTimeout(timer);
        reject(new Error('the forfeited player was allowed to rejoin'));
      });
      socket.once('join-failed', (payload) => {
        clearTimeout(timer);
        resolve(payload?.reason || 'unknown');
      });
      socket.emit('join-lobby', code);
    }), { code: created.code });
    assert.equal(rejoinReason, 'game_started');
    assert.ok(server.lobbyManager.activeGames[created.code], 'the rejoin attempt must not end the running match');

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(third.pageErrors, []);
    assert.deepEqual(returning.pageErrors, []);
  } finally {
    await guest.context.close().catch(() => {});
    await returning?.context.close();
    await third.context.close();
    await host.context.close();
  }
});
