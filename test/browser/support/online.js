import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const VIEWPORT = { width: 1280, height: 960 };
let createOnlineServer;

export function createBrowserHarness({ sessionSecret, lobbyOptions = {} } = {}) {
  let server;
  let baseUrl;
  let browser;

  async function start() {
    if (server) return;
    if (!createOnlineServer) {
      ({ createOnlineServer } = await import('../../../server/app.js'));
    }

    server = await createOnlineServer({
      env: 'test',
      sessionSecret,
      lobby: {
        rateLimit: false,
        pruneIntervalMs: 0,
        rollDelayMs: 10,
        startDelayMs: 10,
        rollGraceMs: 10000,
        timeoutGraceMs: 10,
        cleanupDelayMs: 20,
        ...lobbyOptions
      }
    });
    await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
    // The Windows headless GPU process can crash when several WebGL clients
    // are open at once. Keep the renderer software-backed on that host so the
    // multiplayer tests can exercise the game logic and layout reliably.
    const headlessArgs = ['--no-sandbox'];
    if (process.platform === 'win32') headlessArgs.push('--disable-gpu', '--enable-unsafe-swiftshader');
    browser = await chromium.launch({ headless: true, args: headlessArgs });
  }

  async function stop() {
    await browser?.close();
    browser = null;
    if (server) {
      await new Promise((resolve) => server.io.close(resolve));
      if (server.httpServer.listening) {
        await new Promise((resolve) => server.httpServer.close(resolve));
      }
      await server.closeRedis();
      server = null;
    }
  }

  function sessionCookie(response) {
    const header = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
    const match = header.match(/scaledice\.sid=([^;]+)/);
    return match ? match[1] : null;
  }

  async function registerGuest(password) {
    const response = await fetch(`${baseUrl}/auth/guest/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl
      },
      body: JSON.stringify({ password })
    });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    const body = JSON.parse(text);
    const cookie = sessionCookie(response);
    assert.ok(cookie, 'guest registration should set a session cookie');
    return { user: body.user, cookie };
  }

  async function openGame(cookie) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    if (cookie) {
      await context.addCookies([{
        name: 'scaledice.sid',
        value: cookie,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax'
      }]);
    }

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${baseUrl}/client/index.html?test=1`, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(
      () => window.__SCALE_DICE_TEST__?.game?.scene?.getScenes(true).length > 0,
      null,
      { timeout: 30000 }
    );
    await page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.game.scene.isActive('MenuScene'),
      null,
      { timeout: 30000 }
    );

    return { page, context, pageErrors };
  }

  async function startScene(page, sceneKey, data = undefined) {
    await page.evaluate(({ sceneKey, data }) => {
      window.__SCALE_DICE_TEST__.game.scene.stop('MenuScene');
      window.__SCALE_DICE_TEST__.game.scene.start(sceneKey, data);
    }, { sceneKey, data });
    await page.waitForFunction(
      (key) => window.__SCALE_DICE_TEST__.game.scene.isActive(key),
      sceneKey,
      { timeout: 15000 }
    );
  }

  async function clickGame(page, x, y) {
    const rect = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const bounds = canvas.getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    });
    assert.ok(rect, 'Phaser canvas should exist');
    await page.mouse.click(
      rect.left + (x / VIEWPORT.width) * rect.width,
      rect.top + (y / VIEWPORT.height) * rect.height
    );
  }

  async function sceneState(page, sceneKey, fn, arg) {
    return page.waitForFunction(
      ({ sceneKey, fnSource, arg }) => {
        const scene = window.__SCALE_DICE_TEST__?.game?.scene?.getScene(sceneKey);
        if (!scene) return false;
        return new Function('scene', 'arg', `return (${fnSource})(scene, arg);`)(scene, arg);
      },
      { sceneKey, fnSource: fn.toString(), arg },
      { timeout: 15000 }
    );
  }

  async function createOnlineLobby(host, { configure, timeLimitSeconds } = {}) {
    await startScene(
      host.page,
      'OnlineConfigScene',
      timeLimitSeconds === undefined ? undefined : { timeLimitSeconds }
    );
    if (configure) await configure(host.page);
    await clickGame(host.page, 600, 690);

    await host.page.waitForFunction(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene');
      return Boolean(
        scene?.code &&
        scene.players?.length > 0 &&
        typeof scene.config?.rounds === 'number' &&
        typeof scene.config?.timeLimitSeconds === 'number'
      );
    }, null, { timeout: 15000 });

    const created = await host.page.evaluate(() => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene');
      return { code: scene.code, config: scene.config, hostId: scene.myId };
    });
    assert.match(created.code, /^[A-HJ-NP-Z2-9]{6}$/);
    return created;
  }

  async function joinOnlineLobby(host, guest, code, expectedPlayers = 2) {
    const joinResult = await guest.page.evaluate(({ code }) => new Promise((resolve, reject) => {
      const socket = window.__SCALE_DICE_TEST__.getSocket();
      const timer = setTimeout(() => reject(new Error('join timed out')), 10000);
      socket.once('join-success', (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      socket.once('join-failed', (data) => {
        clearTimeout(timer);
        reject(new Error(`join failed: ${data?.reason || 'unknown'}`));
      });
      socket.emit('join-lobby', code);
    }), { code });
    assert.equal(joinResult.code, code);

    await startScene(guest.page, 'OnlineLobbyScene', { code });
    await host.page.waitForFunction(({ code, expectedPlayers }) => {
      const scene = window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene');
      return scene?.code === code && scene.players?.length === expectedPlayers;
    }, { code, expectedPlayers }, { timeout: 15000 });

    return joinResult;
  }

  async function readyAndStart(host, ...others) {
    const clients = [host, ...others];
    for (const client of clients) {
      await clickGame(client.page, 600, 650);
    }
    await host.page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.game.scene.getScene('OnlineLobbyScene')?.players.every((player) => player.ready),
      null,
      { timeout: 15000 }
    );
    await clickGame(host.page, 600, 730);

    await Promise.all(clients.map((client) => client.page.waitForFunction(
      () => window.__SCALE_DICE_TEST__.game.scene.isActive('OnlineGameScene'),
      null,
      { timeout: 15000 }
    )));
  }

  async function startOnlineMatch(host, guest, options = {}) {
    const created = await createOnlineLobby(host, options);
    await joinOnlineLobby(host, guest, created.code);
    await readyAndStart(host, guest);
    return created;
  }

  return {
    start,
    stop,
    registerGuest,
    openGame,
    startScene,
    clickGame,
    sceneState,
    createOnlineLobby,
    joinOnlineLobby,
    readyAndStart,
    startOnlineMatch,
    get server() {
      return server;
    },
    get baseUrl() {
      return baseUrl;
    },
    get browser() {
      return browser;
    }
  };
}
