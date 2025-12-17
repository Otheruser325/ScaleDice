import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';

export default class PlayModeScene extends Phaser.Scene {
  constructor() {
    super('PlayModeScene');
  }

  create() {
	GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
	
    const centerX = this.cameras.main.centerX;
    this.add.text(centerX, 80, 'Play', { fontSize: 48, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

    const iconSize = 128;
    const iconPadding = 14;
    const margin = 24;

    const topY = margin + iconSize / 2;
    const leftStartX = margin + iconSize / 2;
    const rightStartX = this.cameras.main.width - margin - iconSize / 2;

    const makeIcon = (x, y, key, label, targetScene) => {
      const img = this.add
        .image(x, y, key)
        .setDisplaySize(iconSize, iconSize)
        .setInteractive({ useHandCursor: true });

      const txt = this.add
        .text(x, y + iconSize / 2 + 8, label, {
          fontSize: 14,
          fontFamily: 'Orbitron, Arial',
          color: '#ffffff'
        })
        .setOrigin(0.5, 0);

      img.on('pointerover', () => img.setScale(1.06));
      img.on('pointerout', () => img.setScale(1.0));
      img.on('pointerdown', () => {
        GlobalAudio.playButton(this);
        if (targetScene) this.scene.start(targetScene);
      });

      return { img, txt };
    };

    makeIcon(leftStartX, topY, 'settingsIcon', 'Settings', 'SettingsScene');
    makeIcon(leftStartX + (iconSize + iconPadding), topY, 'achievementIcon', 'Achievements', 'AchievementsScene');
    makeIcon(rightStartX - (iconSize + iconPadding), topY, 'helpIcon', 'Help', 'HelpScene');
    makeIcon(rightStartX, topY, 'changelogIcon', 'Changelog', 'ChangelogScene');

    const makeWideBtn = (y, label, cb, opts = {}) => {
      const w = opts.width || 520;
      const h = opts.height || 56;
      const bg = this.add.rectangle(centerX, y, w, h, 0x222222).setStrokeStyle(2, 0x444444).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const txt = this.add.text(centerX, y, label, { fontSize: 28, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0.5);
      bg.on('pointerover', () => { bg.setFillStyle(0x2b2b2b); txt.setScale(1.03); });
      bg.on('pointerout',  () => { bg.setFillStyle(0x222222); txt.setScale(1.0); });
      bg.on('pointerdown', () => { GlobalAudio.playButton(this); cb(); });
      return { bg, txt };
    };

    makeWideBtn(220, 'Local Play', () => this.scene.start('LocalConfigScene'));
    makeWideBtn(300, 'Online Play', () => this.scene.start('OnlineMenuScene'));
    makeWideBtn(380, 'Challenges', () => this.scene.start('ChallengesScene'));
    
    const backBtn = this.add.text(centerX, 460, '← Back', { fontSize: 26, fontFamily: 'Orbitron, Arial', color: '#ff6666' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => { GlobalAudio.playButton(this); this.scene.start('MenuScene'); });
	this.input.keyboard.on('keydown-ESC', () => {
      GlobalAudio.playButton(this);
      this.scene.start('MenuScene');
    });
  }
}