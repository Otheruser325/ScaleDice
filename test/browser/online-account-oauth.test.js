import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrowserHarness } from './support/online.js';

// Match the other browser tests: headless Chromium needs the game's bundled
// fonts registered on this image.
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
process.env.SESSION_SECRET = 'browser-account-oauth-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';
process.env.GOOGLE_CLIENT_ID = 'browser-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'browser-google-secret';
process.env.DISCORD_CLIENT_ID = 'browser-discord-client';
process.env.DISCORD_CLIENT_SECRET = 'browser-discord-secret';

let harness;

before(async () => {
  harness = createBrowserHarness({ sessionSecret: process.env.SESSION_SECRET });
  await harness.start();
});

after(async () => {
  await harness?.stop();
});

test('configured OAuth buttons render alongside the guest account form', {
  timeout: 120000
}, async () => {
  const game = await harness.openGame();

  try {
    await harness.startScene(game.page, 'OnlineAccountScene');
    await game.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__?.game?.scene?.getScene('OnlineAccountScene');
      const labels = scene?.container?.list
        ?.filter((child) => child.type === 'Text')
        .map((child) => child.text) || [];
      return labels.includes('CREATE GUEST ACCOUNT') &&
        labels.includes('SIGN IN WITH GOOGLE') &&
        labels.includes('SIGN IN WITH DISCORD');
    }, null, { timeout: 15000 });

    const providers = await game.page.evaluate(async () => {
      const response = await fetch('/auth/providers');
      return response.json();
    });
    assert.deepEqual(providers, { guest: true, google: true, discord: true });

    const state = await game.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineAccountScene');
      const entries = scene.container.list
        .filter((child) => child.type === 'Text')
        .map((child) => ({ text: child.text, interactive: Boolean(child.input) }));
      return {
        labels: entries.map((entry) => entry.text),
        byLabel: Object.fromEntries(entries.map((entry) => [entry.text, entry])),
        hasGuestInputs: Boolean(scene.loginUserInput && scene.registerPassInput)
      };
    });

    for (const label of [
      'OR SIGN IN WITH',
      'SIGN IN WITH GOOGLE',
      'SIGN IN WITH DISCORD',
      'SIGN IN',
      'CREATE GUEST ACCOUNT'
    ]) {
      assert.ok(state.labels.includes(label), `expected account screen to render "${label}"`);
    }

    assert.equal(state.byLabel['SIGN IN WITH GOOGLE'].interactive, true);
    assert.equal(state.byLabel['SIGN IN WITH DISCORD'].interactive, true);
    assert.equal(state.byLabel['SIGN IN'].interactive, true);
    assert.equal(state.byLabel['CREATE GUEST ACCOUNT'].interactive, true);
    assert.equal(state.hasGuestInputs, true);
    assert.deepEqual(game.pageErrors, []);
  } finally {
    await game.context.close();
  }
});

test('guest account creation Continue returns to the online menu', {
  timeout: 120000
}, async () => {
  const game = await harness.openGame();

  try {
    await harness.startScene(game.page, 'OnlineMenuScene');
    await game.page.evaluate(() => {
      window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineMenuScene').openAccount();
    });
    await game.page.waitForFunction(() => (
      window.__SCALE_DICE_TEST__.game.scene.isActive('OnlineAccountScene')
    ), null, { timeout: 15000 });

    await game.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineAccountScene');
      return Boolean(scene?.registerPassInput?.node);
    }, null, { timeout: 15000 });
    await game.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineAccountScene');
      scene.registerPassInput.node.value = 'continue-test-password';
    });
    await harness.clickGame(game.page, 600, 585);

    await game.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineAccountScene');
      return scene?.container?.list?.some(
        (child) => child.type === 'Text' && child.text === 'GUEST ACCOUNT CREATED'
      );
    }, null, { timeout: 15000 });

    await harness.clickGame(game.page, 600, 520);
    await game.page.waitForFunction(() => {
      const manager = window.__SCALE_DICE_TEST__.game.scene;
      return !manager.isActive('OnlineAccountScene') && manager.isActive('OnlineMenuScene');
    }, null, { timeout: 15000 });

    assert.deepEqual(game.pageErrors, []);
  } finally {
    await game.context.close();
  }
});
