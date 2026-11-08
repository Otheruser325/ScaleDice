import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createBrowserHarness } from './support/online.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-team-smoke-secret';

const harness = createBrowserHarness({ sessionSecret: 'browser-team-smoke-secret' });
const {
  registerGuest,
  openGame,
  startScene,
  clickGame,
  sceneState,
  createOnlineLobby,
  joinOnlineLobby,
  readyAndStart
} = harness;

async function lobbySnapshot(page) {
  return page.evaluate(() => {
    const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene');
    return {
      code: scene.code,
      myId: scene.myId,
      hostUserId: scene.hostUserId,
      players: scene.players,
      config: scene.config,
      teamSummary: scene.teamSummaryText?.text || ''
    };
  });
}

async function gameSnapshot(page) {
  return page.evaluate(() => {
    const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
    return {
      teamScoreText: scene.teamScoreText?.text || '',
      currentPlayerIndex: scene.currentPlayerIndex,
      localPlayerIndex: scene.localPlayerIndex,
      scores: Array.isArray(scene.scores) ? scene.scores.slice() : [],
      teamScores: scene.teamScores,
      teams: scene.playerSlots.map((player) => player.team),
      config: scene.gameConfig
    };
  });
}

async function waitForTurn(page, playerIndex) {
  await page.waitForFunction(
    (index) => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === index;
    },
    playerIndex,
    { timeout: 15000 }
  );
}

async function rollAndWait(page, code) {
  return page.evaluate(({ code }) => new Promise((resolve, reject) => {
    const socket = window.__SCALE_DICE_TEST__.getSocket();
    const timer = setTimeout(() => reject(new Error('turn-result timed out')), 10000);
    socket.once('turn-result', (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    socket.emit('player-roll', { code });
  }), { code });
}

async function waitForScores(page, expected) {
  await page.waitForFunction(
    (scores) => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene && JSON.stringify(scene.scores) === JSON.stringify(scores);
    },
    expected,
    { timeout: 15000 }
  );
}

async function endTurn(page, code) {
  await page.evaluate(({ code }) => {
    window.__SCALE_DICE_TEST__.getSocket().emit('player-end-turn', { code });
  }, { code });
}

async function postgameText(page) {
  return page.evaluate(() => {
    const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlinePostGameScene');
    if (!scene) return [];
    return scene.children.list
      .filter((child) => child.type === 'Text')
      .map((child) => child.text);
  });
}

before(async () => {
  await harness.start();
});

after(async () => {
  await harness.stop();
});

test('two browser clients can assign teams, see the live team score, and reach the team postgame', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('team-smoke-host');
  const guestAuth = await registerGuest('team-smoke-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    const created = await createOnlineLobby(host, {
      configure: async (page) => {
        await clickGame(page, 320, 300); // 10 rounds, matching local setup
        await sceneState(page, 'OnlineConfigScene', (scene) => scene.selectedRounds === 10);
        await clickGame(page, 600, 410); // Teams: YES
        await sceneState(page, 'OnlineConfigScene', (scene) => (
          scene.selectedRounds === 10 && scene.teamsEnabled === true
        ));
      }
    });
    assert.equal(created.config.teams, true);
    assert.equal(created.config.rounds, 10);

    await joinOnlineLobby(host, guest, created.code);

    const beforeTeams = await lobbySnapshot(host.page);
    assert.deepEqual(
      beforeTeams.players.map((player) => player.team).sort(),
      ['blue', 'red']
    );
    assert.equal(beforeTeams.hostUserId, hostAuth.user.id);
    assert.equal(beforeTeams.myId, hostAuth.user.id);

    const guestIndex = beforeTeams.players.findIndex(
      (player) => String(player.id) === String(guestAuth.user.id)
    );
    assert.equal(guestIndex, 1, 'the host should be first and the guest second');

    // Toggle the guest from red to blue and back through the rendered host
    // team-assignment control.
    await host.page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene')?.teamControls.length >= 2,
      null,
      { timeout: 15000 }
    );
    await clickGame(host.page, 980, 240 + guestIndex * 34);
    await host.page.waitForFunction(
      ({ guestId }) => {
        const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene');
        return scene?.players.find((player) => String(player.id) === String(guestId))?.team === 'blue';
      },
      { guestId: guestAuth.user.id },
      { timeout: 15000 }
    );
    const combined = await lobbySnapshot(host.page);
    assert.equal(combined.players.filter((player) => player.team === 'blue').length, 2);
    assert.match(combined.teamSummary, /BLUE TEAM: 2/);
    assert.match(combined.teamSummary, /RED TEAM: 0/);

    await clickGame(host.page, 980, 240 + guestIndex * 34);
    await host.page.waitForFunction(
      ({ guestId }) => {
        const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene');
        return scene?.players.find((player) => String(player.id) === String(guestId))?.team === 'red';
      },
      { guestId: guestAuth.user.id },
      { timeout: 15000 }
    );
    const restored = await lobbySnapshot(host.page);
    assert.equal(restored.players.find((player) => String(player.id) === String(hostAuth.user.id)).team, 'blue');
    assert.equal(restored.players.find((player) => String(player.id) === String(guestAuth.user.id)).team, 'red');
    assert.match(restored.teamSummary, /BLUE TEAM: 1/);
    assert.match(restored.teamSummary, /RED TEAM: 1/);

    await readyAndStart(host, guest);

    await waitForTurn(host.page, 0);
    await waitForTurn(guest.page, 0);
    const started = await gameSnapshot(host.page);
    assert.deepEqual(started.teams.sort(), ['blue', 'red']);
    assert.equal(started.localPlayerIndex, 0);
    assert.equal(started.teamScoreText, 'Blue: 0  •  Red: 0');

    // The roll button is exercised by the normal client path in gameplay; here
    // the smoke test drives the same socket event so it can focus on the team
    // scoreboard rather than Phaser text hit-testing in headless Chromium.
    const firstRoll = await rollAndWait(host.page, created.code);
    await waitForScores(host.page, firstRoll.scores);
    await host.page.waitForFunction(
      () => /\bBlue: [1-9]/.test(
        window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene')?.teamScoreText?.text || ''
      ),
      null,
      { timeout: 15000 }
    );
    const afterRoll = await gameSnapshot(host.page);
    assert.match(afterRoll.teamScoreText, /Blue: [1-9]\d*  •  Red: 0/);
    assert.deepEqual(afterRoll.teamScores, {
      blue: afterRoll.scores[0],
      red: afterRoll.scores[1]
    });
    await guest.page.waitForFunction(
      (expected) => window.__SCALE_DICE_TEST__.game.scene
        .getScene('OnlineGameScene')?.teamScoreText?.text === expected,
      afterRoll.teamScoreText,
      { timeout: 15000 }
    );
    const guestAfterRoll = await gameSnapshot(guest.page);
    assert.equal(guestAfterRoll.teamScoreText, afterRoll.teamScoreText);
    assert.deepEqual(guestAfterRoll.teamScores, afterRoll.teamScores);
    await endTurn(host.page, created.code);

    // Finish the ten-round match using the same socket path the game uses.
    for (let turn = 1; turn < 20; turn += 1) {
      const playerIndex = turn % 2;
      const page = playerIndex === 0 ? host.page : guest.page;
      await waitForTurn(page, playerIndex);
      const result = await rollAndWait(page, created.code);
      await waitForScores(page, result.scores);
      await endTurn(page, created.code);
    }

    for (const client of [host, guest]) {
      await client.page.waitForFunction(
        () => window.__SCALE_DICE_TEST__.game.scene.isActive('OnlinePostGameScene'),
        null,
        { timeout: 20000 }
      );
    }

    const hostText = await postgameText(host.page);
    const guestText = await postgameText(guest.page);
    for (const text of [hostText, guestText]) {
      const joined = text.join('\n');
      assert.match(joined, /BLUE TEAM/);
      assert.match(joined, /RED TEAM/);
      assert.match(joined, /(BLUE|RED) TEAM WINS|TIE GAME/);
    }

    await mkdir(path.resolve('artifacts'), { recursive: true });
    await host.page.screenshot({ path: path.resolve('artifacts/team-smoke-postgame.png') });

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
