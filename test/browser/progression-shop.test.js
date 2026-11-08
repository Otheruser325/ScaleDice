import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createBrowserHarness } from './support/online.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-progression-shop-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

let server;
const harness = createBrowserHarness({ sessionSecret: 'browser-progression-shop-secret' });
const {
  registerGuest,
  openGame,
  startScene,
  clickGame,
  sceneState,
  createOnlineLobby,
  joinOnlineLobby,
  readyAndStart,
  startOnlineMatch
} = harness;

async function gameSnapshot(page) {
  return page.evaluate(() => {
    const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
    return {
      currentPlayerIndex: scene.currentPlayerIndex,
      localPlayerIndex: scene.localPlayerIndex,
      scores: Array.isArray(scene.scores) ? scene.scores.slice() : [],
      shopOpen: scene.shopOpen,
      currentShop: scene.currentShop,
      progression: scene.playerSlots[scene.localPlayerIndex]?.progression || null,
      visibleDice: scene.diceSprites.filter((sprite) => sprite.visible).length,
      rollEnabled: Boolean(scene.rollBtn?.input?.enabled)
    };
  });
}

before(async () => {
  await harness.start();
  server = harness.server;
});

after(async () => {
  await harness.stop();
});

test('the online shop buys dice through the UI and rolls all six progression dice', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('progression-shop-host');
  const guestAuth = await registerGuest('progression-shop-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    // Keep the turn open through the UI-driven shopping sequence; the test
    // deliberately spends time buying five dice before pressing Roll.
    const created = await createOnlineLobby(host, { timeLimitSeconds: 300 });
    assert.equal(created.config.rounds, 30, `online defaults follow the local 30-round setup (got ${created.config.rounds})`);
    assert.equal(created.config.timeLimitSeconds, 300, `the shop test keeps the turn open (got ${created.config.timeLimitSeconds})`);
    assert.equal(created.config.progression, true);
    assert.equal(created.config.bigUpgradesEnabled, true);

    await joinOnlineLobby(host, guest, created.code);
    await readyAndStart(host, guest);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.currentShop?.dice?.current === 1 &&
        scene?.shopBtn?.visible === true;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    assert.equal(String(activeGame.players[0].id), String(hostAuth.user.id));
    // The shop is server-authoritative. Give the host enough score to buy the
    // local dice ladder, then let the server publish the updated state.
    activeGame.players[0].score = 25000;
    server.lobbyManager.emitGameState(created.code);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene.scores[0] === 25000 && scene.currentShop?.dice?.current === 1;
    }, null, { timeout: 15000 });

    await clickGame(host.page, 1090, 300); // open shop
    await sceneState(host.page, 'OnlineGameScene', (scene) => scene.shopOpen === true);
    const opened = await gameSnapshot(host.page);
    assert.equal(opened.currentShop.dice.current, 1);
    assert.equal(opened.currentShop.dice.max, 6);
    assert.equal(opened.scores[0], 25000);

    const textButtons = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const collect = (children) => children
        .filter((child) => child.type === 'Text' && child.input?.hitArea)
        .map((child) => ({
          text: child.text,
          width: child.input.hitArea.width,
          height: child.input.hitArea.height
        }));
      return [...collect(scene.children.list), ...collect(scene.shopContainer.list)];
    });
    assert.ok(textButtons.some((button) => button.text === 'End Turn'));
    assert.ok(textButtons.some((button) => button.text === '← Back'));
    assert.ok(textButtons.some((button) => button.text === 'CLOSE'));
    for (const button of textButtons) {
      assert.ok(button.width > 0 && button.height > 0, `${button.text} has a clickable hit area`);
    }

    for (let next = 2; next <= 6; next += 1) {
      await host.page.evaluate(() => {
        window.__shopPurchase = new Promise((resolve, reject) => {
          const socket = window.__SCALE_DICE_TEST__.getSocket();
          const cleanup = () => {
            clearTimeout(timer);
            socket.off('upgrade-result', onResult);
            socket.off('upgrade-failed', onFailed);
          };
          const onResult = (payload) => {
            if (payload?.kind !== 'dice') return;
            cleanup();
            resolve(payload);
          };
          const onFailed = (payload) => {
            cleanup();
            reject(new Error(`dice purchase failed: ${payload?.reason || 'unknown'}`));
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error('dice purchase timed out'));
          }, 10000);
          socket.on('upgrade-result', onResult);
          socket.on('upgrade-failed', onFailed);
        });
      });

      await clickGame(host.page, 250, 197); // DICE buy button
      const purchase = await host.page.evaluate(() => window.__shopPurchase);
      assert.equal(purchase.kind, 'dice');
      assert.equal(purchase.shop.dice.current, next);
      await sceneState(host.page, 'OnlineGameScene', (scene, expected) => (
        scene.currentShop?.dice?.current === expected && scene.shopOpen === true
      ), next);
    }

    const sixDice = await gameSnapshot(host.page);
    assert.equal(sixDice.currentShop.dice.current, 6, 'shop reports six unlocked dice');
    assert.equal(sixDice.currentShop.dice.max, 6);
    assert.equal(sixDice.progression.diceUnlocked, 6, 'server progression has six dice');
    assert.equal(sixDice.visibleDice, 0, 'dice are not rendered until the roll result arrives');
    assert.equal(sixDice.scores[0], 1390, 'only server-priced purchases were charged');

    await clickGame(host.page, 1160, 75); // close shop
    await sceneState(host.page, 'OnlineGameScene', (scene) => scene.shopOpen === false);
    await sceneState(host.page, 'OnlineGameScene', (scene) => scene.rollBtn.input?.enabled === true);

    await host.page.evaluate(() => {
      window.__shopRoll = new Promise((resolve, reject) => {
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const timer = setTimeout(() => reject(new Error('turn-result timed out')), 10000);
        socket.once('turn-result', (result) => {
          clearTimeout(timer);
          resolve(result);
        });
        socket.once('player-timeout', () => {
          clearTimeout(timer);
          reject(new Error('the server auto-rolled before the UI roll was accepted'));
        });
      });
    });
    await clickGame(host.page, 600, 300); // Roll Dice
    const roll = await host.page.evaluate(() => window.__shopRoll);

    assert.equal(roll.dice.length, 6, 'the server rolls all six unlocked dice');
    assert.equal(roll.progression.diceUnlocked, 6);
    assert.equal(roll.scores[0], 1390 + roll.scored);
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.diceSprites?.filter((sprite) => sprite.visible).length === 6 &&
        scene?._hasRolledThisTurn === true;
    }, null, { timeout: 15000 });

    const afterRoll = await gameSnapshot(host.page);
    assert.equal(afterRoll.visibleDice, 6, 'all six dice sprites are rendered');
    assert.equal(afterRoll.scores[0], roll.scores[0]);
    assert.equal(afterRoll.currentShop, null, 'the shop closes once the roll is made');
    assert.equal(
      activeGame.players[0].progression.toPublic(activeGame.round).diceUnlocked,
      6,
      'the authoritative server progression remains at six dice'
    );

    await mkdir(path.resolve('artifacts'), { recursive: true });
    await host.page.screenshot({ path: path.resolve('artifacts/progression-shop-six-dice.png') });

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

test('online setup toggles big upgrades with the local defaults intact', {
  timeout: 30000
}, async () => {
  const hostAuth = await registerGuest('online-config-toggle-host');
  const host = await openGame(hostAuth.cookie);

  try {
    await startScene(host.page, 'OnlineConfigScene');
    const defaults = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return {
        players: scene.selectedPlayers,
        rounds: scene.selectedRounds,
        teams: scene.teamsEnabled,
        bigUpgradesEnabled: scene.bigUpgradesEnabled,
        costMultiplier: scene.costMultiplier
      };
    });
    assert.deepEqual(defaults, {
      players: 2,
      rounds: 30,
      teams: false,
      bigUpgradesEnabled: true,
      costMultiplier: 1
    });

    await clickGame(host.page, 600, 598);
    await sceneState(host.page, 'OnlineConfigScene', (scene) => scene.bigUpgradesEnabled === false);
    const disabled = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return {
        players: scene.selectedPlayers,
        rounds: scene.selectedRounds,
        teams: scene.teamsEnabled,
        bigUpgradesEnabled: scene.bigUpgradesEnabled,
        costMultiplier: scene.costMultiplier
      };
    });
    assert.deepEqual(disabled, {
      players: 2,
      rounds: 30,
      teams: false,
      bigUpgradesEnabled: false,
      costMultiplier: 1
    });

    await clickGame(host.page, 600, 598);
    await sceneState(host.page, 'OnlineConfigScene', (scene) => scene.bigUpgradesEnabled === true);
    const reenabled = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineConfigScene');
      return {
        players: scene.selectedPlayers,
        rounds: scene.selectedRounds,
        teams: scene.teamsEnabled,
        bigUpgradesEnabled: scene.bigUpgradesEnabled,
        costMultiplier: scene.costMultiplier
      };
    });
    assert.deepEqual(reenabled, defaults);
    assert.deepEqual(host.pageErrors, []);
  } finally {
    await host.context.close();
  }
});

test('online shop prices follow the lobby multiplier and buy a big upgrade', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-big-upgrade-host');
  const guestAuth = await registerGuest('online-big-upgrade-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    const created = await startOnlineMatch(host, guest, {
      configure: async (page) => {
        await sceneState(page, 'OnlineConfigScene', (scene) => (
          scene.costMultiplier === 1 && scene.bigUpgradesEnabled === true
        ));
        await clickGame(page, 600, 630);
        await sceneState(page, 'OnlineConfigScene', (scene) => scene.costMultiplier === 1.5);
        await clickGame(page, 600, 630);
        await sceneState(page, 'OnlineConfigScene', (scene) => scene.costMultiplier === 2);
      }
    });

    assert.equal(created.config.costMultiplier, 2);
    assert.equal(created.config.bigUpgradesEnabled, true);
    assert.equal(created.config.rounds, 30);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.shopBtn?.visible === true;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    assert.equal(activeGame.config.costMultiplier, 2);
    assert.equal(activeGame.players[0].progression.costMultiplier, 2);
    activeGame.players[0].score = 10000;
    server.lobbyManager.emitGameState(created.code);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene.scores[0] === 10000;
    }, null, { timeout: 15000 });

    await clickGame(host.page, 1090, 300);
    await sceneState(host.page, 'OnlineGameScene', (scene) => scene.shopOpen === true);
    const opened = await gameSnapshot(host.page);
    assert.equal(opened.currentShop.dice.cost, 20);
    assert.equal(opened.currentShop.economy.cost, 50);
    assert.equal(opened.currentShop.luck.cost, 100);
    assert.equal(opened.currentShop.combos.find((combo) => combo.key === 'pair').cost, 20);
    const clairvoyance = opened.currentShop.big.find((upgrade) => upgrade.key === 'clairvoyance');
    assert.ok(clairvoyance, 'the default big-upgrade catalogue is available');
    assert.equal(clairvoyance.cost, 1000);
    assert.equal(clairvoyance.purchased, false);

    await host.page.evaluate(() => {
      window.__bigPurchase = new Promise((resolve, reject) => {
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('upgrade-result', onResult);
          socket.off('upgrade-failed', onFailed);
        };
        const onResult = (payload) => {
          if (payload?.kind !== 'big') return;
          cleanup();
          resolve(payload);
        };
        const onFailed = (payload) => {
          cleanup();
          reject(new Error(`big-upgrade purchase failed: ${payload?.reason || 'unknown'}`));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('big-upgrade purchase timed out'));
        }, 10000);
        socket.on('upgrade-result', onResult);
        socket.on('upgrade-failed', onFailed);
      });
    });

    const bigButton = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.shopContainer.list.find((child) => (
        child.type === 'Text' && child.text === 'BUY 1000'
      ));
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(bigButton, 'the Clairvoyance buy button is rendered');
    await clickGame(host.page, bigButton.x, bigButton.y);
    const purchase = await host.page.evaluate(() => window.__bigPurchase);
    assert.equal(purchase.kind, 'big');
    assert.equal(purchase.key, 'clairvoyance');
    assert.equal(purchase.cost, 1000);
    assert.equal(purchase.score, 9000);
    assert.ok(purchase.progression.bigUpgrades.includes('clairvoyance'));

    const after = await gameSnapshot(host.page);
    assert.equal(after.scores[0], 9000);
    assert.equal(after.currentShop.big.find((upgrade) => upgrade.key === 'clairvoyance').purchased, true);
    assert.ok(after.progression.bigUpgrades.includes('clairvoyance'));
    assert.equal(activeGame.players[0].score, 9000);
    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

test('online shop paginates the complete big-upgrade catalogue', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-shop-pages-host');
  const guestAuth = await registerGuest('online-shop-pages-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    const created = await startOnlineMatch(host, guest, { timeLimitSeconds: 300 });
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.shopBtn?.visible === true;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    activeGame.players[0].score = 10000;
    const progression = activeGame.players[0].progression;
    for (let index = 0; index < 6; index += 1) {
      const def = {
        key: `catalogue${index}`,
        title: `Catalogue ${index}`,
        baseCost: 100,
        effect: 'comboMultiplier',
        value: 1.1
      };
      progression.bigUpgradeDefs.push(def);
      progression.bigUpgradeMap.set(def.key, def);
    }
    server.lobbyManager.emitGameState(created.code);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.scores?.[0] === 10000;
    }, null, { timeout: 15000 });

    await clickGame(host.page, 1090, 300);
    await sceneState(host.page, 'OnlineGameScene', (scene) => scene.shopOpen === true);

    const firstPage = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return {
        page: scene.bigUpgradePage,
        pageCount: scene.bigUpgradePageCount,
        total: scene.currentShop.big.length,
        labels: scene.shopContainer.list
          .filter((child) => child.type === 'Text')
          .map((child) => child.text)
      };
    });
    assert.equal(firstPage.total, 14, 'the shop receives the full catalogue');
    assert.equal(firstPage.pageCount, 2);
    assert.equal(firstPage.page, 0);
    assert.ok(firstPage.labels.includes('Page 1/2'));
    assert.ok(firstPage.labels.some((label) => label.includes('Catalogue 3')));
    assert.equal(firstPage.labels.some((label) => label.includes('Catalogue 4')), false);

    const firstPageControls = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return {
        prevEnabled: Boolean(scene.bigUpgradePrevBtn?.input?.enabled),
        nextEnabled: Boolean(scene.bigUpgradeNextBtn?.input?.enabled)
      };
    });
    assert.equal(firstPageControls.prevEnabled, false, 'the previous-page control is disabled on the first page');
    assert.equal(firstPageControls.nextEnabled, true, 'the next-page control is enabled on the first page');
    const pageAfterFirstBoundary = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      scene.bigUpgradePrevBtn?.emit('pointerdown');
      return scene.bigUpgradePage;
    });
    assert.equal(pageAfterFirstBoundary, 0, 'the first page cannot go back further');

    const nextButton = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.bigUpgradeNextBtn;
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(nextButton, 'the next-page control is rendered');
    await clickGame(host.page, nextButton.x, nextButton.y);
    await sceneState(host.page, 'OnlineGameScene', (scene) => scene.bigUpgradePage === 1);

    const secondPage = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return {
        page: scene.bigUpgradePage,
        pageCount: scene.bigUpgradePageCount,
        labels: scene.shopContainer.list
          .filter((child) => child.type === 'Text')
          .map((child) => child.text)
      };
    });
    assert.equal(secondPage.page, 1);
    assert.equal(secondPage.pageCount, 2);
    assert.ok(secondPage.labels.includes('Page 2/2'));
    assert.ok(secondPage.labels.some((label) => label.includes('Catalogue 4')));
    assert.ok(secondPage.labels.some((label) => label.includes('Catalogue 5')));
    assert.equal(secondPage.labels.some((label) => label.includes('Clairvoyance')), false);

    const lastPageControls = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return {
        prevEnabled: Boolean(scene.bigUpgradePrevBtn?.input?.enabled),
        nextEnabled: Boolean(scene.bigUpgradeNextBtn?.input?.enabled)
      };
    });
    assert.equal(lastPageControls.prevEnabled, true, 'the previous-page control is enabled on the last page');
    assert.equal(lastPageControls.nextEnabled, false, 'the next-page control is disabled on the last page');

    const pageAfterLastBoundary = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      scene.bigUpgradeNextBtn?.emit('pointerdown');
      return scene.bigUpgradePage;
    });
    assert.equal(pageAfterLastBoundary, 1, 'the last page cannot advance further');

    const previousButton = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.bigUpgradePrevBtn;
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(previousButton, 'the previous-page control is rendered');
    await clickGame(host.page, previousButton.x, previousButton.y);
    await sceneState(host.page, 'OnlineGameScene', (scene) => scene.bigUpgradePage === 0);

    const returnedPage = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return {
        page: scene.bigUpgradePage,
        labels: scene.shopContainer.list
          .filter((child) => child.type === 'Text')
          .map((child) => child.text)
      };
    });
    assert.equal(returnedPage.page, 0);
    assert.ok(returnedPage.labels.includes('Page 1/2'));
    assert.ok(returnedPage.labels.some((label) => label.includes('Catalogue 3')));
    assert.equal(returnedPage.labels.some((label) => label.includes('Catalogue 4')), false);

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

test('disabled big upgrades are hidden in the shop and rejected by the server', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('online-big-disabled-host');
  const guestAuth = await registerGuest('online-big-disabled-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    const created = await startOnlineMatch(host, guest, {
      configure: async (page) => {
        await clickGame(page, 600, 598);
        await sceneState(page, 'OnlineConfigScene', (scene) => scene.bigUpgradesEnabled === false);
      }
    });

    assert.equal(created.config.bigUpgradesEnabled, false);
    assert.equal(created.config.costMultiplier, 1);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0 &&
        scene?.shopBtn?.visible === true;
    }, null, { timeout: 15000 });

    const activeGame = server.lobbyManager.activeGames[created.code];
    assert.ok(activeGame, 'the online game should be running');
    assert.equal(activeGame.config.bigUpgradesEnabled, false);
    activeGame.players[0].score = 10000;
    server.lobbyManager.emitGameState(created.code);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene.scores[0] === 10000;
    }, null, { timeout: 15000 });

    await clickGame(host.page, 1090, 300);
    await sceneState(host.page, 'OnlineGameScene', (scene) => scene.shopOpen === true);
    const opened = await gameSnapshot(host.page);
    assert.deepEqual(opened.currentShop.big, []);

    const shopLabels = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene.shopContainer.list
        .filter((child) => child.type === 'Text')
        .map((child) => child.text);
    });
    assert.equal(shopLabels.includes('BIG UPGRADES'), false, 'the shop does not render a big-upgrade heading');
    assert.equal(shopLabels.some((label) => label.includes('Clairvoyance')), false, 'the shop does not render big-upgrade rows');

    await host.page.evaluate(() => {
      window.__disabledBigPurchase = new Promise((resolve, reject) => {
        const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
        const socket = window.__SCALE_DICE_TEST__.getSocket();
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('upgrade-result', onResult);
          socket.off('upgrade-failed', onFailed);
        };
        const onResult = (payload) => {
          cleanup();
          reject(new Error(`disabled big upgrade was purchased: ${payload?.key || 'unknown'}`));
        };
        const onFailed = (payload) => {
          cleanup();
          resolve(payload);
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('disabled big-upgrade rejection timed out'));
        }, 10000);
        socket.on('upgrade-result', onResult);
        socket.on('upgrade-failed', onFailed);
        socket.emit('buy-upgrade', { code: scene.roomCode, kind: 'big', key: 'clairvoyance' });
      });
    });

    const rejected = await host.page.evaluate(() => window.__disabledBigPurchase);
    assert.equal(rejected.kind, 'big');
    assert.equal(rejected.key, 'clairvoyance');
    assert.equal(rejected.reason, 'big_upgrades_disabled');

    const after = await gameSnapshot(host.page);
    assert.equal(after.scores[0], 10000);
    assert.equal(after.currentShop.big.length, 0);
    assert.deepEqual(after.progression.bigUpgrades, []);
    assert.equal(activeGame.players[0].score, 10000);
    assert.equal(activeGame.players[0].progression.bigUpgrades.size, 0);
    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
