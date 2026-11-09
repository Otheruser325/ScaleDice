import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserHarness } from './support/online.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-online-custom-lineup-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

let server;
const harness = createBrowserHarness({ sessionSecret: 'browser-online-custom-lineup-secret' });
const {
  registerGuest,
  openGame,
  clickGame,
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

test('online matches use the local custom big-upgrade lineup and show descriptions', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-custom-lineup-host');
  const guestAuth = await registerGuest('online-custom-lineup-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    await host.page.evaluate(() => {
      localStorage.setItem('scaleDice_customBigUpgrades', JSON.stringify([
        { key: 'deleted_rollicane', deleted: true },
        {
          key: 'comboUpgrader',
          title: 'Combo Upgrader',
          baseCost: 1000,
          effect: 'comboUpgrade',
          values: { percentage: 0.05, isMultiplicative: false }
        }
      ]));
    });

    const created = await createOnlineLobby(host);
    await joinOnlineLobby(host, guest, created.code);
    await readyAndStart(host, guest);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        Boolean(scene?.shopUI && scene?.currentShop);
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    const defs = activeGame.players[0].progression.bigUpgradeDefs;
    const custom = defs.find((def) => def.key === 'comboUpgrader');
    assert.ok(custom, 'the custom big upgrade reaches the server progression');
    assert.equal(custom.effect, 'comboUpgrade');
    assert.deepEqual(custom.values, { percentage: 0.05, isMultiplicative: false });
    assert.equal(defs.some((def) => def.key === 'rollicane'), false, 'a locally deleted default stays deleted online');

    const toggle = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.bigToggleBtn;
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(toggle, 'the big-upgrades toggle is rendered');
    await clickGame(host.page, toggle.x, toggle.y);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.bigUpgradesOpen === true;
    }, null, { timeout: 15000 });

    const labels = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return {
        bigKeys: scene.currentShop.big.map((item) => item.key),
        texts: (scene.bigUpgradesToolbarContainer?.list || [])
          .filter((child) => child.type === 'Text')
          .map((child) => child.text)
      };
    });
    assert.ok(labels.bigKeys.includes('comboUpgrader'));
    assert.equal(labels.bigKeys.includes('rollicane'), false);
    assert.ok(labels.texts.includes('Combo Upgrader'));
    assert.ok(labels.texts.includes('+5% combo multiplier per combo level.'));
    assert.equal(labels.texts.includes('Rollicane'), false);
    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
