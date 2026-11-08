import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrowserHarness } from './support/online.js';

// Headless Chromium aborts when it creates a DOM form without any fontconfig
// file on this image. Point it at the fonts the game already ships with.
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
process.env.SESSION_SECRET = 'browser-online-customizer-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

let server;
const harness = createBrowserHarness({ sessionSecret: 'browser-online-customizer-secret' });
const {
  registerGuest,
  openGame,
  startScene,
  clickGame
} = harness;

before(async () => {
  await harness.start();
  server = harness.server;
});

after(async () => {
  await harness.stop();
});

test('online setup opens the shared customizer and saves a new big upgrade', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-customizer-host');
  const host = await openGame(hostAuth.cookie);

  try {
    await host.page.evaluate(() => localStorage.removeItem('scaleDice_customBigUpgrades'));
    await startScene(host.page, 'OnlineConfigScene');
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return scene?.bigUpgradesEnabled === true &&
        scene?.lineupSummaryText?.text.includes('8 entries');
    }, null, { timeout: 15000 });

    const button = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      const text = scene.children.list.find(
        (child) => child.type === 'Text' && child.text === 'CUSTOMIZE'
      );
      if (!text) return null;
      const bounds = text.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(button, 'the online setup renders a CUSTOMIZE control');
    await clickGame(host.page, button.x, button.y);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return scene?.customizeModalOpen === true;
    }, null, { timeout: 15000 });

    const labels = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return scene.customizeModalContainer.list
        .filter((child) => child.type === 'Text')
        .map((child) => child.text);
    });
    assert.ok(labels.includes('CUSTOMIZE BIG UPGRADES'));

    await host.page.evaluate(() => {
      window.__SCALE_DICE_TEST__.game.scene
        .getScene('OnlineConfigScene')
        .editBigUpgradeInModal(null);
    });
    await host.page.waitForSelector('#bu-name', { timeout: 15000 });
    await host.page.fill('#bu-name', 'Online Test Upgrade');
    await host.page.fill('#bu-cost', '1234');
    await host.page.fill('#bu-value', '2.5');
    await host.page.click('#bu-save');

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return scene?.customizeModalOpen === true && scene?.customizeEditorOpen === false;
    }, null, { timeout: 15000 });

    const saved = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return {
        custom: scene.bigUpgradeCustomizer.getActiveUpgrades()
          .find((upgrade) => upgrade.title === 'Online Test Upgrade'),
        stored: JSON.parse(localStorage.getItem('scaleDice_customBigUpgrades') || '[]'),
        summary: scene.lineupSummaryText?.text || ''
      };
    });

    assert.ok(saved.custom, 'the new upgrade is active');
    assert.match(saved.custom.key, /^custom_/);
    assert.equal(saved.custom.baseCost, 1234);
    assert.equal(saved.custom.effect, 'rollMultiplier');
    assert.equal(saved.custom.value, 2.5);
    assert.ok(saved.stored.some((upgrade) => upgrade.title === 'Online Test Upgrade'));
    assert.ok(saved.summary.includes('9 entries'));

    await host.page.evaluate(() => {
      window.__SCALE_DICE_TEST__.game.scene
        .getScene('OnlineConfigScene')
        .editBigUpgradeInModal(null);
    });
    await host.page.waitForSelector('#bu-name', { timeout: 15000 });
    await host.page.fill('#bu-name', 'Online Capped Investor');
    await host.page.fill('#bu-cost', '1500');
    await host.page.selectOption('#bu-effect', 'interestRate');
    await host.page.waitForSelector('#bu-investment-cap', { timeout: 15000 });
    await host.page.fill('#bu-value', '0.2');
    await host.page.fill('#bu-investment-cap', '1.2');
    await host.page.click('#bu-save');

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return scene?.customizeModalOpen === true && scene?.customizeEditorOpen === false;
    }, null, { timeout: 15000 });

    const capped = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return {
        custom: scene.bigUpgradeCustomizer.getActiveUpgrades()
          .find((upgrade) => upgrade.title === 'Online Capped Investor'),
        stored: JSON.parse(localStorage.getItem('scaleDice_customBigUpgrades') || '[]'),
        summary: scene.lineupSummaryText?.text || ''
      };
    });

    assert.ok(capped.custom, 'the capped investor is active');
    assert.equal(capped.custom.effect, 'interestRate');
    assert.equal(capped.custom.value, 0.2);
    assert.equal(capped.custom.investmentCap, 1.2);
    assert.ok(capped.stored.some((upgrade) => upgrade.title === 'Online Capped Investor'));
    assert.ok(capped.summary.includes('10 entries'));

    await host.page.evaluate(() => {
      window.__SCALE_DICE_TEST__.game.scene
        .getScene('OnlineConfigScene')
        .closeBigUpgradesCustomizeModal();
    });
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return scene?.customizeModalOpen === false;
    }, null, { timeout: 15000 });
    assert.equal(await host.page.locator('#bu-name').count(), 0);
    assert.equal(await host.page.locator('#bu-cost').count(), 0);

    // A customizer session must not leave listeners or DOM behind when the
    // host leaves setup for the lobby.
    await clickGame(host.page, 600, 690);
    await host.page.waitForFunction(() => (
      window.__SCALE_DICE_TEST__.game.scene.isActive('OnlineLobbyScene')
    ), null, { timeout: 15000 });
    assert.deepEqual(host.pageErrors, []);
  } finally {
    await host.context.close();
  }
});

test('local setup still opens the shared customizer after the extraction', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('local-customizer-host');
  const host = await openGame(hostAuth.cookie);

  try {
    await host.page.evaluate(() => localStorage.removeItem('scaleDice_customBigUpgrades'));
    await startScene(host.page, 'LocalConfigScene');
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('LocalConfigScene');
      return scene?.bigUpgradesEnabled === true;
    }, null, { timeout: 15000 });

    const button = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('LocalConfigScene');
      const text = scene.children.list.find(
        (child) => child.type === 'Text' && child.text === 'CUSTOMIZE'
      );
      if (!text) return null;
      const bounds = text.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(button, 'the local setup still renders a CUSTOMIZE control');
    await clickGame(host.page, button.x, button.y);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('LocalConfigScene');
      return scene?.customizeModalOpen === true;
    }, null, { timeout: 15000 });
    const labels = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('LocalConfigScene');
      return scene.customizeModalContainer.list
        .filter((child) => child.type === 'Text')
        .map((child) => child.text);
    });
    assert.ok(labels.includes('CUSTOMIZE BIG UPGRADES'));

    await host.page.evaluate(() => {
      window.__SCALE_DICE_TEST__.game.scene
        .getScene('LocalConfigScene')
        .closeBigUpgradesCustomizeModal();
    });
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('LocalConfigScene');
      return scene?.customizeModalOpen === false;
    }, null, { timeout: 15000 });
    assert.deepEqual(host.pageErrors, []);
  } finally {
    await host.context.close();
  }
});
