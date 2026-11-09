import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserHarness } from './support/online.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-disconnect-forfeit-secret';

let server;
const harness = createBrowserHarness({
  sessionSecret: 'browser-disconnect-forfeit-secret',
  lobbyOptions: { cleanupDelayMs: 30000 }
});
const { registerGuest, openGame, clickGame, startOnlineMatch } = harness;

before(async () => {
  await harness.start();
  server = harness.server;
});

after(async () => {
  await harness.stop();
});

test('a mid-match disconnect forfeits and the disconnected player cannot rejoin', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('disconnect-forfeit-host');
  const guestAuth = await registerGuest('disconnect-forfeit-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);
  let returning;

  try {
    const created = await startOnlineMatch(host, guest, { timeLimitSeconds: 300 });

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.scores?.[0] === 0;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    activeGame.players[0].score = 500;
    server.lobbyManager.emitGameState(created.code);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.scores?.[0] === 500;
    }, null, { timeout: 15000 });

    await host.page.evaluate(() => {
      window.__forfeitResult = new Promise((resolve, reject) => {
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const timer = setTimeout(() => reject(new Error('game-finished timed out')), 10000);
        socket.once('game-finished', (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
    });

    await guest.context.close();

    const finished = await host.page.evaluate(() => window.__forfeitResult);
    assert.deepEqual(finished.scores, [500, 0]);
    assert.equal(finished.players[0].left, false);
    assert.equal(finished.players[1].left, true);

    assert.equal(server.lobbyManager.activeGames[created.code], undefined);
    const lobby = server.lobbyManager.lobbies[created.code];
    assert.ok(lobby, 'the finished lobby should remain briefly for the postgame');
    assert.equal(lobby.finished, true);
    assert.equal(
      lobby.players.find((player) => String(player.id) === String(guestAuth.user.id)).left,
      true
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
        reject(new Error('the disconnected player was allowed to rejoin'));
      });
      socket.once('join-failed', (payload) => {
        clearTimeout(timer);
        resolve(payload?.reason || 'unknown');
      });
      socket.emit('join-lobby', code);
    }), { code: created.code });
    assert.equal(rejoinReason, 'game_started');

    await host.page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.game.scene.isActive('OnlinePostGameScene'),
      null,
      { timeout: 20000 }
    );
    const postgame = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlinePostGameScene');
      return {
        stats: scene.registry.get('onlinePostGame'),
        labels: scene.children.list
          .filter((child) => child.type === 'Text')
          .map((child) => child.text)
      };
    });
    assert.deepEqual(postgame.stats.scores, [500, 0]);
    assert.equal(postgame.stats.players, 2);
    assert.equal(postgame.stats.names[0], hostAuth.user.name);
    assert.ok(postgame.labels.some((label) => (
      label.includes(hostAuth.user.name) && label.includes('#1')
    )));

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(returning.pageErrors, []);
  } finally {
    await guest.context.close().catch(() => {});
    await returning?.context.close();
    await host.context.close();
  }
});

test('the leave confirmation can be canceled, and Yes forfeits explicitly', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('leave-forfeit-host');
  const guestAuth = await registerGuest('leave-forfeit-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    const created = await startOnlineMatch(host, guest, { timeLimitSeconds: 300 });

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.scores?.[0] === 0;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    activeGame.players[0].score = 750;
    server.lobbyManager.emitGameState(created.code);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.scores?.[0] === 750;
    }, null, { timeout: 15000 });

    await host.page.evaluate(() => {
      window.__leaveForfeit = new Promise((resolve, reject) => {
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const timer = setTimeout(() => reject(new Error('game-finished timed out')), 10000);
        socket.once('game-finished', (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
    });

    const backButton = await guest.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.children.list.find((child) => (
        child.type === 'Text' && child.text === '<- BACK'
      ));
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(backButton, 'the Back button is rendered');
    await clickGame(guest.page, backButton.x, backButton.y);

    await guest.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene.children.list.some((child) => (
        child.type === 'Text' && child.text === 'Yes'
      )) && scene.children.list.some((child) => (
        child.type === 'Text' && child.text === 'No'
      ));
    }, null, { timeout: 15000 });

    const noButton = await guest.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.children.list.find((child) => (
        child.type === 'Text' && child.text === 'No'
      ));
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(noButton, 'the cancel button is rendered');
    await clickGame(guest.page, noButton.x, noButton.y);

    await guest.page.waitForFunction(() => {
      const game = window.__SCALE_DICE_TEST__.game;
      const scene = game.scene.getScene('OnlineGameScene');
      return game.scene.isActive('OnlineGameScene') &&
        !scene.children.list.some((child) => (
          child.type === 'Text' && (child.text === 'Yes' || child.text === 'No')
        ));
    }, null, { timeout: 15000 });

    const running = server.lobbyManager.activeGames[created.code];
    assert.ok(running, 'canceling the leave keeps the match running');
    assert.ok(!running.finished, 'the game is still running');
    assert.equal(running.players.filter((player) => !player.left).length, 2);
    assert.ok(!server.lobbyManager.lobbies[created.code].finished, 'the lobby is not finished');

    await clickGame(guest.page, backButton.x, backButton.y);
    await guest.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene.children.list.some((child) => (
        child.type === 'Text' && child.text === 'Yes'
      ));
    }, null, { timeout: 15000 });

    const yesButton = await guest.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.children.list.find((child) => (
        child.type === 'Text' && child.text === 'Yes'
      ));
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(yesButton, 'the leave confirmation can be reopened');
    await clickGame(guest.page, yesButton.x, yesButton.y);

    const finished = await host.page.evaluate(() => window.__leaveForfeit);
    assert.deepEqual(finished.scores, [750, 0]);
    assert.equal(finished.players[0].left, false);
    assert.equal(finished.players[1].left, true);

    assert.equal(server.lobbyManager.activeGames[created.code], undefined);
    const lobby = server.lobbyManager.lobbies[created.code];
    assert.ok(lobby, 'the finished lobby should remain briefly for the postgame');
    assert.equal(lobby.finished, true);
    assert.equal(
      lobby.players.find((player) => String(player.id) === String(guestAuth.user.id)).left,
      true
    );

    await host.page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.game.scene.isActive('OnlinePostGameScene'),
      null,
      { timeout: 20000 }
    );
    const postgame = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlinePostGameScene');
      return {
        stats: scene.registry.get('onlinePostGame'),
        labels: scene.children.list
          .filter((child) => child.type === 'Text')
          .map((child) => child.text)
      };
    });
    assert.deepEqual(postgame.stats.scores, [750, 0]);
    assert.equal(postgame.stats.names[0], hostAuth.user.name);
    assert.ok(postgame.labels.some((label) => (
      label.includes(hostAuth.user.name) && label.includes('#1')
    )));

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
