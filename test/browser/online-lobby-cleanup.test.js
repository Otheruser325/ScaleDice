import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrowserHarness } from './support/online.js';

const fontCacheDir = path.join(os.tmpdir(), 'scaledice-font-cache');
fs.mkdirSync(fontCacheDir, { recursive: true });
const fontConfigPath = path.join(os.tmpdir(), 'scaledice-fonts.conf');
fs.writeFileSync(fontConfigPath, `<?xml version="1.0"?>
<fontconfig>
  <dir>${path.resolve('client/assets/fonts')}</dir>
  <cachedir>${fontCacheDir}</cachedir>
</fontconfig>
`);
process.env.FONTCONFIG_FILE = fontConfigPath;

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-online-lobby-cleanup-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

const TWO_PLAYER_WARNING = "Game can only be started when there's 2 or more players.";

let harness;

before(async () => {
  harness = createBrowserHarness({ sessionSecret: process.env.SESSION_SECRET });
  await harness.start();
});

after(async () => {
  await harness?.stop();
});

test('the lobby code input does not linger over the account scene', {
  timeout: 120000
}, async () => {
  const auth = await harness.registerGuest('lobby-input-cleanup-host');
  const game = await harness.openGame(auth.cookie);

  try {
    await harness.startScene(game.page, 'OnlineMenuScene');
    await game.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineMenuScene');
      return Boolean(scene?.joinInput?.node?.isConnected);
    }, null, { timeout: 15000 });
    assert.equal(await game.page.locator('input').count(), 1);

    const account = await game.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineMenuScene');
      const bounds = scene.accountText.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    await harness.clickGame(game.page, account.x, account.y);

    await game.page.waitForFunction(() => (
      window.__SCALE_DICE_TEST__.game.scene.isActive('OnlineAccountScene')
    ), null, { timeout: 15000 });
    await game.page.waitForFunction(() => document.querySelectorAll('input').length === 0, null, {
      timeout: 15000
    });

    await harness.clickGame(game.page, 600, 850);
    await game.page.waitForFunction(() => {
      const manager = window.__SCALE_DICE_TEST__.game.scene;
      return !manager.isActive('OnlineAccountScene') && manager.isActive('OnlineMenuScene');
    }, null, { timeout: 15000 });
    await game.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineMenuScene');
      return Boolean(scene?.joinInput?.node?.isConnected);
    }, null, { timeout: 15000 });
    assert.equal(await game.page.locator('input').count(), 1);

    assert.deepEqual(game.pageErrors, []);
  } finally {
    await game.context.close();
  }
});

test('starting alone explains the two-player minimum', {
  timeout: 120000
}, async () => {
  const auth = await harness.registerGuest('two-player-message-host');
  const host = await harness.openGame(auth.cookie);

  try {
    await harness.createOnlineLobby(host);
    const players = await host.page.evaluate(() => (
      window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene').players.length
    ));
    assert.equal(players, 1);

    await harness.clickGame(host.page, 600, 730);
    await host.page.waitForFunction((message) => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene');
      const visit = (objects) => objects.some((object) => (
        (object.type === 'Text' && object.text === message) ||
        (Array.isArray(object.list) && visit(object.list))
      ));
      return visit(scene.children.list);
    }, TWO_PLAYER_WARNING, { timeout: 15000 });

    assert.equal(
      await host.page.evaluate(() => (
        window.__SCALE_DICE_TEST__.game.scene.isActive('OnlineLobbyScene')
      )),
      true
    );
    assert.deepEqual(host.pageErrors, []);
  } finally {
    await host.context.close();
  }
});
