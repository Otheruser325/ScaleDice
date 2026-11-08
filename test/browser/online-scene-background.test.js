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
process.env.SESSION_SECRET = 'browser-scene-background-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

let harness;

before(async () => {
  harness = createBrowserHarness({ sessionSecret: process.env.SESSION_SECRET });
  await harness.start();
});

after(async () => {
  await harness?.stop();
});

test('online setup and lobby keep the shared background', {
  timeout: 120000
}, async () => {
  const auth = await harness.registerGuest('scene-background-host');
  const game = await harness.openGame(auth.cookie);

  try {
    await harness.startScene(game.page, 'OnlineConfigScene');
    await game.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return scene?.children.list.some((child) => child.texture?.key === 'bg');
    }, null, { timeout: 15000 });

    await game.page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.getSocket()?.connected,
      null,
      { timeout: 15000 }
    );
    await harness.clickGame(game.page, 600, 690);

    await game.page.waitForFunction(() => (
      window.__SCALE_DICE_TEST__.game.scene.isActive('OnlineLobbyScene')
    ), null, { timeout: 15000 });

    await game.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene');
      return scene?.children.list.some((child) => child.texture?.key === 'bg');
    }, null, { timeout: 15000 });

    assert.deepEqual(game.pageErrors, []);
  } finally {
    await game.context.close();
  }
});
