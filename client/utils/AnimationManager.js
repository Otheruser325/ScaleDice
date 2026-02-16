export async function animateDiceRoll(scene, finalFaces, activeDice) {
  const duration = 700;
  const jitter = 12;
  const interval = 40;

  const dice = Array.isArray(activeDice) && activeDice.length
    ? activeDice
    : scene.diceSprites.slice(0, finalFaces.length);

  dice.forEach(d => {
    d.setVisible(true);
    d.angle = 0;
    d.setScale(1);
    // ensure we have originalX/originalY (defensive)
    d.originalX = (typeof d.originalX === 'number') ? d.originalX : d.x;
    d.originalY = (typeof d.originalY === 'number') ? d.originalY : d.y;
    d.x = d.originalX;
    d.y = d.originalY;
  });

  let elapsed = 0;

  return new Promise(resolve => {
    const timer = scene.time.addEvent({
      delay: interval,
      loop: true,
      callback: () => {
        elapsed += interval;

        dice.forEach(die => {
          const temp = Phaser.Math.Between(1, 6);
          die.setTexture(`dice${temp}`);

          const ox = Phaser.Math.Between(-jitter, jitter);
          const oy = Phaser.Math.Between(-jitter, jitter);
          die.x += ox;
          die.y += oy;

          scene.tweens.add({
            targets: die,
            x: die.originalX,
            y: die.originalY,
            duration: 50,
            ease: 'Quad.easeOut',
          });
        });

        if (elapsed >= duration) {
          timer.remove();

          dice.forEach((die, i) => {
            const face = finalFaces[i] ?? Phaser.Math.Between(1, 6);
            die.setTexture(`dice${face}`);

            scene.tweens.add({
              targets: die,
              angle: Phaser.Math.Between(-90, 90),
              scale: 1,
              duration: 300,
              ease: 'Back.easeOut',
              onStart: () => {
                die.angle = Phaser.Math.Between(-180, 180);
                die.setScale(0.6);
                die.x = die.originalX;
                die.y = die.originalY;
              },
              onComplete: () => {
                die.angle = 0;
                die.x = die.originalX;
                die.y = die.originalY;
              }
            });
          });

          resolve();
        }
      }
    });
  });
}

export async function animateDiceSpin(scene, activeDice, spinningEntries, { onTick } = {}) {
  if (!scene || !scene.tweens || !scene.time) return;
  if (!Array.isArray(spinningEntries) || !spinningEntries.length) return;

  const visuals = [];
  const visualsByIndex = new Map();

  spinningEntries.forEach((entry) => {
    const die = activeDice?.[entry.index];
    if (!die) return;

    const coreRing = scene.add.circle(die.x, die.y, 34, 0x66ccff, 0.12).setDepth(20);
    coreRing.setStrokeStyle(2, 0x99eeff, 0.55);

    const orbitRing = scene.add.circle(die.x, die.y, 42, 0x66ccff, 0).setDepth(19);
    orbitRing.setStrokeStyle(1, 0x77ddff, 0.4);

    const dieSpinTween = scene.tweens.add({
      targets: die,
      angle: die.angle + 360,
      duration: 210,
      ease: 'Linear',
      repeat: -1
    });

    const ringPulseTween = scene.tweens.add({
      targets: coreRing,
      scaleX: 1.18,
      scaleY: 1.18,
      alpha: 0.2,
      duration: 360,
      yoyo: true,
      repeat: -1
    });

    const orbitTween = scene.tweens.addCounter({
      from: 0,
      to: 360,
      duration: 520,
      ease: 'Linear',
      repeat: -1,
      onUpdate: (tw) => {
        const angleRad = Phaser.Math.DegToRad(tw.getValue());
        orbitRing.x = die.x + Math.cos(angleRad) * 4;
        orbitRing.y = die.y + Math.sin(angleRad) * 4;
        orbitRing.angle = -tw.getValue();
        coreRing.x = die.x;
        coreRing.y = die.y;
      }
    });

    const visual = { die, coreRing, orbitRing, dieSpinTween, ringPulseTween, orbitTween, face: entry.face, seconds: entry.seconds || 0 };
    visuals.push(visual);
    visualsByIndex.set(entry.index, visual);
  });

  const maxSeconds = Math.max(...spinningEntries.map((entry) => entry.seconds || 0));

  for (let second = 1; second <= maxSeconds; second++) {
    const activeForSecond = spinningEntries.filter((entry) => (entry.seconds || 0) >= second);
    if (activeForSecond.length && typeof onTick === 'function') {
      onTick(second, activeForSecond);
    }
    // stop any dice whose spin duration has ended this second
    const endingNow = spinningEntries.filter((entry) => (entry.seconds || 0) === second);
    endingNow.forEach((entry) => {
      const v = visualsByIndex.get(entry.index);
      if (!v) return;
      try { v.dieSpinTween?.stop(); } catch (e) {}
      try { v.ringPulseTween?.stop(); } catch (e) {}
      try { v.orbitTween?.stop(); } catch (e) {}
      try { if (v.die && v.face) v.die.setTexture(`dice${v.face}`); } catch (e) {}
      try { v.die?.setAngle(0); } catch (e) {}
      try { v.coreRing?.destroy(); } catch (e) {}
      try { v.orbitRing?.destroy(); } catch (e) {}
      visualsByIndex.delete(entry.index);
    });
    await new Promise((resolve) => scene.time.delayedCall(1000, resolve));
  }

  visuals.forEach((v) => {
    try { v.dieSpinTween?.stop(); } catch (e) {}
    try { v.ringPulseTween?.stop(); } catch (e) {}
    try { v.orbitTween?.stop(); } catch (e) {}
    try { v.die?.setAngle(0); } catch (e) {}
    try { v.coreRing?.destroy(); } catch (e) {}
    try { v.orbitRing?.destroy(); } catch (e) {}
  });
}
