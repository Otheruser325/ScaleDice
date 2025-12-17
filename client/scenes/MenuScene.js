import GlobalAudio from '../utils/AudioManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
	GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
	
    const centerX = this.cameras.main.centerX;
    const centerY = 140;

    this.add.text(centerX, 60, 'SCALE DICE', {
      fontSize: 48,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);

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

    const playBtnY = this.cameras.main.centerY;
    const playBtn = this.add.text(centerX, playBtnY, '▶ Play', {
      fontSize: 96,
      fontFamily: 'Orbitron, Arial',
      color: '#66ff66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    playBtn.on('pointerover', () => {
      playBtn.setScale(1.03);
      playBtn.setStyle({ color: '#ffeb8a' });
    });
    playBtn.on('pointerout', () => {
      playBtn.setScale(1.0);
      playBtn.setStyle({ color: '#66ff66' });
    });
    playBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('PlayModeScene');
    });

    const footerY = this.cameras.main.height - 40;
    const musicText = this.add.text(centerX, footerY, 'Music: On', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#cccccc' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    musicText.on('pointerdown', () => {
      if (!GlobalAudio || typeof GlobalAudio.toggleMusic !== 'function') return;
      GlobalAudio.toggleMusic(this);
      musicText.setText(GlobalAudio.isMusicOn ? 'Music: On' : 'Music: Off');
      GlobalAudio.playButton(this);
    });

    // Start / resume music safely
    if (GlobalAudio && typeof GlobalAudio.playMusic === 'function') GlobalAudio.playMusic(this);

    // Initialise achievements manager
    if (GlobalAchievements && typeof GlobalAchievements.registerScene === 'function') {
      GlobalAchievements.registerScene(this);
    }
  }
}