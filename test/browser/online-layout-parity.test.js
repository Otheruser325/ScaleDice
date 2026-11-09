import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserHarness } from './support/online.js';

process.env.NODE_ENV = 'test';
process.env.STORAGE_MODE = 'memory';
process.env.SESSION_SECRET = 'browser-online-layout-parity-secret';
process.env.AUTH_RATE_LIMIT_DISABLED = '1';

const harness = createBrowserHarness({ sessionSecret: 'browser-online-layout-parity-secret' });
const {
  registerGuest,
  openGame,
  startScene,
  clickGame,
  startOnlineMatch
} = harness;

before(async () => {
  await harness.start();
});

after(async () => {
  await harness.stop();
});

function geometry(value) {
  if (!value) return null;
  return {
    x: value.x,
    y: value.y,
    fontSize: value.fontSize,
    fontFamily: value.fontFamily
  };
}

async function captureGameLayout(page, sceneKey) {
  return page.evaluate((key) => {
    const scene = window.__SCALE_DICE_TEST__.game.scene.getScene(key);
    const text = (object) => object ? {
      x: object.x,
      y: object.y,
      fontSize: object.style?.fontSize,
      fontFamily: object.style?.fontFamily
    } : null;
    const capturePlayer = (player) => player ? {
      icon: {
        x: player.icon.x,
        y: player.icon.y,
        scaleX: player.icon.scaleX
      },
      name: text(player.tag || player.name),
      score: text(player.scoreText || player.score),
      dice: text(player.diceText || player.dice),
      luck: text(player.luckText || player.luck),
      income: {
        ...text(player.incomeText || player.income),
        value: (player.incomeText || player.income)?.text
      },
      ring: {
        x: player.ring.x,
        y: player.ring.y,
        visible: player.ring.visible
      }
    } : null;
    const back = scene.children.list.find((child) => (
      child.type === 'Text' && (child.text === '<- BACK' || child.text === '← Back')
    ));
    return {
      header: text(scene.headerText),
      round: text(scene.roundText || scene.roundTitle),
      turn: text(scene.turnText || scene.info),
      lastRoll: text(scene.lastRollText),
      prediction: text(scene.predictionText),
      score: text(scene.scoreBreakdown),
      roll: text(scene.rollBtn),
      endTurn: text(scene.endTurnBtn),
      buyDice: text(scene.buyDiceBtn),
      buyEconomy: text(scene.buyEcoBtn),
      buyLuck: text(scene.buyLuckBtn),
      dice: (scene.diceSprites || []).slice(0, 2).map((die) => ({
        x: die.x,
        y: die.y,
        scaleX: die.scaleX,
        texture: die.texture?.key
      })),
      players: (scene.playerBar || []).map(capturePlayer),
      history: scene.history ? {
        x: scene.history.container.x,
        y: scene.history.container.y,
        width: scene.history.panelWidth,
        height: scene.history.panelHeight
      } : null,
      back: text(back),
      background: scene.children.list.some((child) => child.texture?.key === 'bg')
    };
  }, sceneKey);
}

function comparableGameLayout(layout) {
  const result = {};
  ['header', 'round', 'turn', 'lastRoll', 'prediction', 'score', 'roll', 'endTurn', 'buyDice', 'buyEconomy', 'buyLuck', 'back'].forEach((key) => {
    result[key] = geometry(layout[key]);
  });
  result.dice = layout.dice;
  result.players = (layout.players || []).map((player) => ({
    icon: player.icon,
    name: geometry(player.name),
    score: geometry(player.score),
    dice: geometry(player.dice),
    luck: geometry(player.luck),
    income: { ...geometry(player.income), value: player.income?.value },
    ring: player.ring
  }));
  result.history = layout.history;
  result.background = layout.background;
  return result;
}

async function capturePostGameLayout(page, sceneKey) {
  return page.evaluate((key) => {
    const scene = window.__SCALE_DICE_TEST__.game.scene.getScene(key);
    const texts = scene.children.list
      .filter((child) => child.type === 'Text')
      .map((child) => ({
        text: child.text,
        x: child.x,
        y: child.y,
        fontSize: child.style?.fontSize,
        fontFamily: child.style?.fontFamily
      }));
    const title = texts.find((entry) => entry.text.includes('GAME - RESULTS'));
    const playerOne = texts.find((entry) => entry.text.includes('Alpha') && entry.text.includes('#1'));
    const score = texts.find((entry) => entry.text.startsWith('Score:'));
    const back = texts.find((entry) => entry.text === 'RETURN TO MENU');
    return {
      title,
      playerOne,
      score,
      back,
      background: scene.children.list.some((child) => child.texture?.key === 'bg')
    };
  }, sceneKey);
}

test('online game uses the local game scene layout', {
  timeout: 120000
}, async () => {
  const local = await openGame();
  const hostAuth = await registerGuest('layout-parity-host');
  const guestAuth = await registerGuest('layout-parity-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    await startScene(local.page, 'LocalGameScene', {
      players: 2,
      rounds: 5,
      names: ['Local Alpha', 'Local Beta'],
      ai: [false, false]
    });
    await local.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('LocalGameScene');
      return scene?.playerBar?.length === 2 && scene?.rollBtn;
    }, null, { timeout: 15000 });
    const localLayout = await captureGameLayout(local.page, 'LocalGameScene');

    await startOnlineMatch(host, guest, { timeLimitSeconds: 300 });
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.playerBar?.length === 2 &&
        scene?.currentPlayerIndex === 0 &&
        scene?.localPlayerIndex === 0;
    }, null, { timeout: 15000 });
    const onlineLayout = await captureGameLayout(host.page, 'OnlineGameScene');

    assert.deepEqual(comparableGameLayout(onlineLayout), comparableGameLayout(localLayout));
    assert.equal(onlineLayout.background, true, 'the online game keeps the shared background');

    assert.deepEqual(host.pageErrors, []);
    assert.deepEqual(guest.pageErrors, []);
    assert.deepEqual(local.pageErrors, []);
  } finally {
    await local.context.close();
    await host.context.close();
    await guest.context.close();
  }
});

test('online post-game uses the local results layout', {
  timeout: 120000
}, async () => {
  const local = await openGame();
  const online = await openGame();
  const stats = {
    players: 2,
    names: ['Alpha', 'Beta'],
    scores: [1500, 900],
    combos: [
      { pair: 2, triple: 1 },
      { fullHouse: 1 }
    ],
    teamsEnabled: false
  };

  try {
    await local.page.evaluate((payload) => {
      window.__SCALE_DICE_TEST__.game.registry.set('localPostGame', payload);
    }, stats);
    await startScene(local.page, 'LocalPostGameScene');
    const localLayout = await capturePostGameLayout(local.page, 'LocalPostGameScene');

    await online.page.evaluate((payload) => {
      window.__SCALE_DICE_TEST__.game.registry.set('onlinePostGame', payload);
    }, stats);
    await startScene(online.page, 'OnlinePostGameScene');
    const onlineLayout = await capturePostGameLayout(online.page, 'OnlinePostGameScene');

    assert.deepEqual(geometry(onlineLayout.title), geometry(localLayout.title));
    assert.deepEqual(geometry(onlineLayout.playerOne), geometry(localLayout.playerOne));
    assert.deepEqual(geometry(onlineLayout.score), geometry(localLayout.score));
    assert.deepEqual(geometry(onlineLayout.back), geometry(localLayout.back));
    assert.equal(onlineLayout.background, true, 'the online post-game keeps the shared background');

    assert.deepEqual(local.pageErrors, []);
    assert.deepEqual(online.pageErrors, []);
  } finally {
    await local.context.close();
    await online.context.close();
  }
});

test('leaving a two-player online match returns to the online menu without a crash', {
  timeout: 120000
}, async () => {
  const hostAuth = await registerGuest('layout-leave-host');
  const guestAuth = await registerGuest('layout-leave-guest');
  const host = await openGame(hostAuth.cookie);
  const guest = await openGame(guestAuth.cookie);

  try {
    await startOnlineMatch(host, guest, { timeLimitSeconds: 300 });
    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene?.localPlayerIndex === 0 && scene?.currentPlayerIndex === 0;
    }, null, { timeout: 15000 });

    const back = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.children.list.find((child) => (
        child.type === 'Text' && child.text === '<- BACK'
      ));
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(back, 'the Back button is rendered');
    await clickGame(host.page, back.x, back.y);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      return scene.children.list.some((child) => child.type === 'Text' && child.text === 'Yes');
    }, null, { timeout: 15000 });
    const yes = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineGameScene');
      const button = scene.children.list.find((child) => (
        child.type === 'Text' && child.text === 'Yes'
      ));
      if (!button) return null;
      const bounds = button.getBounds();
      return { x: bounds.centerX, y: bounds.centerY };
    });
    assert.ok(yes, 'the leave confirmation is rendered');
    await clickGame(host.page, yes.x, yes.y);

    await host.page.waitForFunction(() => (
      window.__SCALE_DICE_TEST__.game.scene.isActive('OnlineMenuScene')
    ), null, { timeout: 15000 });
    assert.equal(
      await host.page.evaluate(() => window.__SCALE_DICE_TEST__.game.scene.isActive('OnlineGameScene')),
      false
    );
    assert.deepEqual(host.pageErrors, []);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
