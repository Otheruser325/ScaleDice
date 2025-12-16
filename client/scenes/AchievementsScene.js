import GlobalAudio from '../utils/AudioManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';
import { formatCompact } from '../utils/FormatManager.js';

export default class AchievementsScene extends Phaser.Scene {
  constructor() {
    super('AchievementsScene');
  }

  create() {
    const centerX = 600;
    this.add.text(centerX, 60, 'Achievements', { fontSize: 40, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

    const data = GlobalAchievements.getAll();
    const unlocked = data.unlocked || {};
    const totals = data.totals || {};

    const items = [
      { key: 'firstPlay', title: "I'm New to This", desc: 'Play Scale Dice for the first time.' },
      { key: 'rounds100', title: 'Late Warrior', desc: 'Progress 100 rounds in total.' },
      { key: 'rounds500', title: 'Late Nights', desc: 'Progress 500 rounds in total.' },
      { key: 'score1000', title: "Pilin' Up!", desc: 'Score 1,000 points in a match.' },
      { key: 'score10000', title: "Rackin' Up!", desc: 'Score 10,000 points in a match.' },
      { key: 'score100000', title: 'Hard Labour', desc: 'Score 100,000 points in a match.' },
      { key: 'score1000000', title: 'Millionaire', desc: 'Score 1,000,000 points in a match.' },
      { key: 'fourOfAKind', title: 'Big Shot', desc: 'Roll a Four-of-a-kind.' },
      { key: 'fiveOfAKind', title: 'Perfection', desc: 'Roll a Five-of-a-kind.' },
      { key: 'sixOfAKind', title: 'Diceomania', desc: 'Roll a Six-of-a-kind.' }
    ];

    // centre the grid nicely
    const cols = 2;
    const startX = 220; // left column X
    const startY = 140;
    const spacingX = 520;
    const spacingY = 120;

    let unlockedCount = 0;
    items.forEach((it, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * spacingX;
      const y = startY + row * spacingY;

      const achieved = !!unlocked[it.key];
      if (achieved) unlockedCount++;

      const color = achieved ? '#66ff66' : '#999999';
      const title = this.add.text(x, y, it.title, { fontSize: 20, fontFamily: 'Orbitron, Arial', color }).setOrigin(0);
      const desc = this.add.text(x, y + 28, it.desc, { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#cccccc' }).setOrigin(0);
      if (achieved) {
        this.add.text(x + 380, y, 'COMPLETED', { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#66ff66' }).setOrigin(1, 0);
      } else {
        this.add.text(x + 380, y, 'LOCKED', { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#777777' }).setOrigin(1, 0);
      }
    });

    const totalCount = items.length;
    this.add.text(centerX, 640, `Unlocked: ${unlockedCount} / ${totalCount}`, { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0.5);
    this.add.text(centerX, 670, `Games: ${totals.gamesPlayed || 0}  Rounds: ${totals.roundsPlayed || 0}  Best: ${formatCompact(totals.bestSingleMatchScore || 0)}`, { fontSize: 16, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0.5);

    const back = this.add.text(centerX, 760, '← Back', { fontSize: 26, fontFamily: 'Orbitron, Arial', color: '#ff6666' }).setOrigin(0.5).setInteractive();
    back.on('pointerdown', () => {
      if (GlobalAudio) GlobalAudio.playButton(this);
      this.scene.start('MenuScene');
    });
  }
}