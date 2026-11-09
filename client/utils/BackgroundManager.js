function hasDrawableSource(source) {
  if (!source || typeof source !== 'object') return false;
  if (source.complete === false) return false;

  const width = Number(source.width ?? source.naturalWidth ?? source.videoWidth ?? 0);
  const height = Number(source.height ?? source.naturalHeight ?? source.videoHeight ?? 0);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
}

class BackgroundManager {
  static _scene = null;
  static _bg = null;
  static _opts = {};

  /**
   * Register a scene to attach the global background to.
   * opts = { key: 'bg' (asset key), width, height, padding, tint, useImageIfAvailable (true) }
   */
  static registerScene(scene, opts = {}) {
    if (!scene || !scene.add) return;

    const imageKey = opts.key || 'bg';
    let src = null;
    try {
      if (scene.textures.exists(imageKey)) {
        const texture = scene.textures.get(imageKey);
        src = texture?.getSourceImage ? texture.getSourceImage() : null;
      }
    } catch (e) {
      src = null;
    }

    const useImage = !!opts.useImageIfAvailable && hasDrawableSource(src);
    if (BackgroundManager._scene === scene) {
      const bg = BackgroundManager._bg;
      const attached = !!bg && bg.scene === scene && bg.active !== false &&
        (scene.children?.list?.includes(bg) || !!bg.parentContainer);
      const hasImage = !!bg?.texture && bg.texture.key === imageKey;
      // If the first registration happened before the texture decoded, retry
      // now that the image is available instead of keeping the fallback.
      if (attached && (!opts.useImageIfAvailable || hasImage || !useImage)) return;
      BackgroundManager.unregisterScene(scene);
    }

    BackgroundManager.unregisterScene();

    BackgroundManager._scene = scene;
    BackgroundManager._opts = { ...(opts || {}) };

    const cam = scene.cameras.main;
    const w = cam ? cam.width : scene.scale?.width;
    const h = cam ? cam.height : scene.scale?.height;
    const centerX = cam ? cam.centerX : (w / 2);
    const centerY = cam ? cam.centerY : (h / 2);

    // A texture key can exist before its image is decoded. Rendering an image
    // whose source is null causes CanvasRenderer.drawImage(null) to throw, so
    // only take the image path when the source has real dimensions.
    let img = null;
    if (useImage) {
      try {
        img = scene.add.image(centerX, centerY, imageKey).setOrigin(0.5).setDepth(opts.depth ?? -1000);
      } catch (e) {
        img = null;
      }
    }

    if (img) {
      let frame = null;
      try {
        frame = scene.textures.getFrame(imageKey);
      } catch (e) {
        frame = null;
      }

      const imgW = frame && frame.width ? frame.width : (src.width || src.naturalWidth || src.videoWidth || null);
      const imgH = frame && frame.height ? frame.height : (src.height || src.naturalHeight || src.videoHeight || null);

      if (imgW && imgH && w && h) {
        const scale = Math.max(w / imgW, h / imgH);
        const displayW = Math.round(imgW * scale);
        const displayH = Math.round(imgH * scale);
        img.setDisplaySize(displayW, displayH);
      } else {
        if (w && h) img.setDisplaySize(w, h);
        console.warn('[BackgroundManager] could not read texture natural size reliably — using setDisplaySize(canvasW,canvasH).', { imageKey, frame, src });
      }

      if (opts.tint) {
        try { img.setTint(opts.tint); } catch (e) {}
      }

      try { img.setScrollFactor(0); } catch (e) {}
      BackgroundManager._bg = img;
    } else {
      const pad = (typeof opts.padding === 'number') ? opts.padding : 28;
      const panelW = opts.width || Math.max(800, (w ? w : 800) - (pad * 2));
      const panelH = opts.height || Math.max(640, (h ? h : 640) - (pad * 2));

      const outer = scene.add.rectangle(centerX, centerY, panelW + 16, panelH + 16, 0x0f0f0f)
        .setStrokeStyle(2, 0x1b1b1b)
        .setDepth(opts.depth ?? -1000);
      const panel = scene.add.rectangle(centerX, centerY, panelW, panelH, 0x222222).setDepth((opts.depth ?? -1000) + 1);

      const container = scene.add.container(0, 0, [outer, panel]);
      container.setDepth(opts.depth ?? -1000);

      try {
        container.list.forEach(c => c.setScrollFactor?.(0));
      } catch (e) {}

      BackgroundManager._bg = container;
    }

    try {
      if (BackgroundManager._bg && BackgroundManager._bg.setScrollFactor) BackgroundManager._bg.setScrollFactor(0);
      if (BackgroundManager._bg && BackgroundManager._bg.list) {
        BackgroundManager._bg.list.forEach(c => c.setScrollFactor?.(0));
      }
      // Keep the background behind every scene object even if another system
      // adds a low-depth object before the scene finishes creating its UI.
      if (BackgroundManager._bg && scene.children?.sendToBack) {
        scene.children.sendToBack(BackgroundManager._bg);
      }
    } catch (e) {}

    if (scene.events && typeof scene.events.once === 'function') {
      scene.events.once('shutdown', () => BackgroundManager.unregisterScene(scene));
      scene.events.once('destroy', () => BackgroundManager.unregisterScene(scene));
    }

    // Some scenes are entered before the image is fully decoded. The panel is
    // intentionally safe to render at that point, but it must be replaced once
    // the texture becomes drawable. Retry on the scene clock (which is cleared
    // when the scene shuts down) so this also works for lobby/post-game scenes
    // that do not otherwise refresh their background.
    if (opts.useImageIfAvailable && !useImage && !opts._retry) {
      const retry = (remaining) => {
        if (!scene || BackgroundManager._scene !== scene) return;
        if (BackgroundManager._bg?.texture?.key === imageKey) return;
        try {
          BackgroundManager.registerScene(scene, { ...opts, _retry: true });
        } catch (e) { /* fallback remains usable */ }
        if (remaining > 1 && BackgroundManager._scene === scene &&
            BackgroundManager._bg?.texture?.key !== imageKey) {
          try { scene.time?.delayedCall(300, () => retry(remaining - 1)); } catch (e) { /* ignore */ }
        }
      };
      try { scene.time?.delayedCall(0, () => retry(8)); } catch (e) { /* ignore */ }
    }
  }

  static unregisterScene(scene = null) {
    if (scene && BackgroundManager._scene !== scene) return;

    const bg = BackgroundManager._bg;
    BackgroundManager._bg = null;
    BackgroundManager._scene = null;
    BackgroundManager._opts = {};

    try {
      if (bg?.destroy) bg.destroy(true);
    } catch (e) {
      console.warn('[BackgroundManager] cleanup error', e);
    }
  }

  // Backwards compatible
  static createBackgroundPanel(scene, opts = {}) {
    BackgroundManager.registerScene(scene, { ...opts, useImageIfAvailable: !!opts.useImageIfAvailable });
    if (!BackgroundManager._bg) return { outer: null, panel: null };
    if (BackgroundManager._bg.list) {
      const outer = BackgroundManager._bg.list[0] || null;
      const panel = BackgroundManager._bg.list[1] || null;
      return { outer, panel };
    } else {
      return { outer: null, panel: BackgroundManager._bg };
    }
  }
}

const GlobalBackground = BackgroundManager;
export default GlobalBackground;
