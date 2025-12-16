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