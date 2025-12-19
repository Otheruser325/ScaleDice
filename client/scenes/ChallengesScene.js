import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';

export default class ChallengesScene extends Phaser.Scene {
  constructor() { super('ChallengesScene'); }
  create() {
	try {
      GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
    } catch (e) {}
    try {
      GlobalAchievements.registerScene(this);
    } catch (e) {}
    const cx = this.cameras.main.centerX;
    this.add.text(cx, 120, 'Challenges', { fontSize: 40, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);
    this.add.text(cx, 240, 'Coming soon...', { fontSize: 24, fontFamily: 'Orbitron, Arial', color: '#cccccc' }).setOrigin(0.5);
    this.backBtn = this.add.text(cx, 520, '← Back', { fontSize: 26, fontFamily: 'Orbitron, Arial', color: '#ff6666' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.backBtn.on('pointerdown', () => {
        GlobalAudio.playButton(this);
        this.scene.start('PlayModeScene');
    });
	this.input.keyboard.on('keydown-ESC', () => {
      GlobalAudio.playButton(this);
      this.scene.start('PlayModeScene');
    });
  }
}