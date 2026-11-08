import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserHarness } from './support/online.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-host-leave-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

let server;
const harness = createBrowserHarness({ sessionSecret: 'browser-host-leave-secret' });
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

test('an explicit host leave transfers host and the remaining players continue', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('host-leave-host');
  const guestAuth = await registerGuest('host-leave-guest');
  const thirdAuth = await registerGuest('host-leave-third');
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

    await guest.page.evaluate(() => {
      window.__hostLeft = new Promise((resolve, reject) => {
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const timer = setTimeout(() => reject(new Error('player-left timed out')), 10000);
        socket.once('player-left', (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
    });

    const backButton = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.children.list.find((child) => (
        child.type === 'Text' && child.text === '← Back'
      ));
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(backButton, 'the host Back button is rendered');
    await clickGame(host.page, backButton.x, backButton.y);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene.children.list.some((child) => (
        child.type === 'Text' && child.text === 'Yes'
      )) && scene.children.list.some((child) => (
        child.type === 'Text' && child.text === 'No'
      ));
    }, null, { timeout: 15000 });

    const yesButton = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.children.list.find((child) => (
        child.type === 'Text' && child.text === 'Yes'
      ));
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(yesButton, 'the host leave confirmation is rendered');
    await clickGame(host.page, yesButton.x, yesButton.y);

    const left = await guest.page.evaluate(() => window.__hostLeft);
    assert.equal(String(left.id), String(hostAuth.user.id));

    await guest.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 1 && scene?.localPlayerIndex === 1;
    }, null, { timeout: 15000 });

    const lobby = server.lobbyManager.lobbies[created.code];
    const continuingGame = server.lobbyManager.activeGames[created.code];
    const guestSocketId = await guest.page.evaluate(() => (
      window.__SCALE_DICE_TEST__.getSocket()?.id
    ));

    assert.ok(lobby, 'the lobby should remain after the host leaves');
    assert.ok(continuingGame, 'the match should continue with two active seats');
    assert.ok(!lobby.finished, 'the lobby should not be finished');
    assert.ok(!continuingGame.finished, 'the game should not be finished');
    assert.equal(String(lobby.hostUserId), String(guestAuth.user.id));
    assert.equal(lobby.hostSocketId, guestSocketId);
    assert.equal(
      lobby.players.find((player) => String(player.id) === String(hostAuth.user.id)).left,
      true
    );
    assert.equal(
      lobby.players.find((player) => String(player.id) === String(guestAuth.user.id)).left,
      false
    );
    assert.equal(
      lobby.players.find((player) => String(player.id) === String(thirdAuth.user.id)).left,
      false
    );
    assert.equal(continuingGame.players.length, 3);
    assert.equal(continuingGame.players.filter((player) => !player.left).length, 2);

    const roll = await guest.page.evaluate(({ code }) => new Promise((resolve, reject) => {
      const socket = window.__SCALE_DICE_TEST__.getSocket();
      const timer = setTimeout(() => reject(new Error('turn-result timed out')), 10000);
      socket.once('turn-result', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      socket.emit('player-roll', { code });
    }), { code: created.code });
    assert.equal(roll.scores.length, 3);

    const nextTurn = await guest.page.evaluate(({ code }) => new Promise((resolve, reject) => {
      const socket = window.__SCALE_DICE_TEST__.getSocket();
      const timer = setTimeout(() => reject(new Error('turn-start timed out')), 10000);
      socket.once('turn-start', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      socket.emit('player-end-turn', { code });
    }), { code: created.code });
    assert.equal(nextTurn.playerIndex, 2);

    await third.page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene')?.currentPlayerIndex === 2,
      null,
      { timeout: 15000 }
    );
    assert.ok(server.lobbyManager.activeGames[created.code], 'the match should still be running');
    assert.equal(String(server.lobbyManager.lobbies[created.code].hostUserId), String(guestAuth.user.id));

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
    assert.deepEqual(third.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
    await third.context.close();
  }
});

test('an explicit lobby leave transfers host and the new host starts the match', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('lobby-host-leave-host');
  const guestAuth = await registerGuest('lobby-host-leave-guest');
  const thirdAuth = await registerGuest('lobby-host-leave-third');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);
  const third = await openGame(thirdAuth.cookie);

  try {
    const created = await createOnlineLobby(host, {
      configure: async (page) => {
        await clickGame(page, 520, 165);
        await sceneState(page, 'OnlineConfigScene', (scene) => scene.selectedPlayers === 3);
      }
    });
    assert.equal(created.config.players, 3);

    await joinOnlineLobby(host, guest, created.code);
    await joinOnlineLobby(host, third, created.code, 3);

    await sceneState(guest.page, 'OnlineLobbyScene', (scene) => (
      scene.players.length === 3 && scene.startBtn?.visible === false
    ));

    const leaveButton = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene');
      const button = scene.children.list.find((child) => (
        child.type === 'Text' && child.text === 'LEAVE'
      ));
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(leaveButton, 'the lobby LEAVE button is rendered');
    await clickGame(host.page, leaveButton.x, leaveButton.y);

    await sceneState(guest.page, 'OnlineLobbyScene', (scene, expected) => (
      String(scene.hostUserId) === String(expected.id) &&
      scene.startBtn?.visible === true &&
      scene.playerListText?.text.includes(`★ ${expected.name}`)
    ), { id: guestAuth.user.id, name: guestAuth.user.name });

    await sceneState(third.page, 'OnlineLobbyScene', (scene, expected) => (
      String(scene.hostUserId) === String(expected.id) &&
      scene.startBtn?.visible === false &&
      scene.playerListText?.text.includes(`★ ${expected.name}`)
    ), { id: guestAuth.user.id, name: guestAuth.user.name });

    const lobby = server.lobbyManager.lobbies[created.code];
    const guestSocketId = await guest.page.evaluate(() => (
      window.__SCALE_DICE_TEST__.getSocket()?.id
    ));

    assert.ok(lobby, 'the lobby should remain after the host leaves');
    assert.ok(!lobby.finished, 'the lobby should not be finished');
    assert.equal(String(lobby.hostUserId), String(guestAuth.user.id));
    assert.equal(lobby.hostSocketId, guestSocketId);
    assert.equal(lobby.players.length, 3);
    assert.equal(lobby.players.filter((player) => !player.left).length, 2);
    assert.equal(
      lobby.players.find((player) => String(player.id) === String(hostAuth.user.id)).left,
      true
    );
    assert.equal(
      lobby.players.find((player) => String(player.id) === String(guestAuth.user.id)).left,
      false
    );
    assert.equal(
      lobby.players.find((player) => String(player.id) === String(thirdAuth.user.id)).left,
      false
    );
    assert.equal(server.lobbyManager.activeGames[created.code], undefined);

    await clickGame(guest.page, 600, 650);
    await clickGame(third.page, 600, 650);
    await sceneState(guest.page, 'OnlineLobbyScene', (scene, departedHostId) => {
      const active = scene.players.filter((player) => (
        String(player.id) !== String(departedHostId)
      ));
      return active.length === 2 && active.every((player) => player.ready);
    }, hostAuth.user.id);

    await clickGame(guest.page, 600, 730);
    await Promise.all([
      guest.page.waitForFunction(() => {
        const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
        return window.__SCALE_DICE_TEST__.game.scene.isActive('OnlineGameScene') &&
          scene?.currentPlayerIndex === 0 &&
          scene?.localPlayerIndex === 0 &&
          scene?.scores?.length === 2;
      }, null, { timeout: 15000 }),
      third.page.waitForFunction(() => {
        const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
        return window.__SCALE_DICE_TEST__.game.scene.isActive('OnlineGameScene') &&
          scene?.currentPlayerIndex === 0 &&
          scene?.localPlayerIndex === 1 &&
          scene?.scores?.length === 2;
      }, null, { timeout: 15000 })
    ]);

    const startedGame = server.lobbyManager.activeGames[created.code];
    assert.ok(startedGame, 'the transferred host should start the match');
    assert.equal(startedGame.players.length, 2);
    assert.equal(String(startedGame.players[0].id), String(guestAuth.user.id));
    assert.equal(String(startedGame.players[1].id), String(thirdAuth.user.id));
    assert.equal(String(server.lobbyManager.lobbies[created.code].hostUserId), String(guestAuth.user.id));

    startedGame.players[0].score = 500;
    startedGame.players[1].score = 1000;
    server.lobbyManager.emitGameState(created.code);
    await guest.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.scores?.length === 2 &&
        scene.scores[0] === 500 &&
        scene.scores[1] === 1000 &&
        scene.rollBtn?.input?.enabled === true;
    }, null, { timeout: 15000 });

    await clickGame(guest.page, 600, 300);
    await guest.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?._hasRolledThisTurn === true &&
        scene.scores?.length === 2 &&
        scene.scores[1] === 1000 &&
        scene.scores[0] > 500 &&
        scene.history?.entries?.some((entry) => entry.includes('rolled ['));
    }, null, { timeout: 15000 });

    const activeSeatRoll = await guest.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return { scores: scene.scores, history: scene.history?.entries || [] };
    });
    assert.equal(activeSeatRoll.scores.length, 2, 'active seats keep exactly two scores');
    assert.equal(activeSeatRoll.scores[1], 1000, 'the opponent score is preserved');
    assert.ok(activeSeatRoll.scores[0] > 500, 'the transferred host can roll and score');
    assert.ok(activeSeatRoll.history.some((entry) => entry.includes('Game started')));
    assert.ok(activeSeatRoll.history.some((entry) => entry.includes("'s turn started")));
    assert.ok(activeSeatRoll.history.some((entry) => entry.includes('rolled [')));

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
    assert.deepEqual(third.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
    await third.context.close();
  }
});
