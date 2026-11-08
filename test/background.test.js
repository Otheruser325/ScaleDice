import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import GlobalBackground from '../client/utils/BackgroundManager.js';

function makeNode(type) {
  return {
    type,
    list: [],
    setDepth() { return this; },
    setOrigin() { return this; },
    setStrokeStyle() { return this; },
    setScrollFactor() { return this; },
    setDisplaySize() { return this; },
    setTint() { return this; },
    destroy() {}
  };
}

function makeScene(source) {
  const calls = [];
  const scene = {
    add: {
      image() {
        calls.push('image');
        return makeNode('image');
      },
      rectangle() {
        calls.push('rectangle');
        return makeNode('rectangle');
      },
      container(x, y, list) {
        calls.push('container');
        const container = makeNode('container');
        container.list = list;
        return container;
      }
    },
    textures: {
      exists: () => true,
      get: () => ({ getSourceImage: () => source }),
      getFrame: () => null
    },
    cameras: {
      main: { width: 1280, height: 960, centerX: 640, centerY: 480 }
    },
    events: { once() {} },
    scale: { width: 1280, height: 960 }
  };
  return { scene, calls };
}

afterEach(() => {
  GlobalBackground.unregisterScene();
});

test('background falls back to a panel when the texture source is not drawable', () => {
  const { scene, calls } = makeScene(null);

  GlobalBackground.registerScene(scene, { key: 'bg', useImageIfAvailable: true });

  assert.equal(calls.includes('image'), false);
  assert.equal(calls.includes('rectangle'), true);
  assert.equal(calls.includes('container'), true);
});

test('background uses the image path when the texture source is ready', () => {
  const { scene, calls } = makeScene({ width: 640, height: 480, complete: true });

  GlobalBackground.registerScene(scene, { key: 'bg', useImageIfAvailable: true });

  assert.equal(calls.includes('image'), true);
  assert.equal(calls.includes('rectangle'), false);
});
