import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalErrors from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';

export default class PlayModeScene extends Phaser.Scene {
  constructor() {
    super('PlayModeScene');
  }

  create() {
    try {
      GlobalErrors.setScene(this);
    } catch (e) {}
    try {
      GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
    } catch (e) {}
    try {
      GlobalAchievements.registerScene(this);
    } catch (e) {}

    GlobalLocalization.init(this);
    const settings = GlobalSettings.get(this);
    GlobalLocalization.setLanguage(this, settings.language || 'English');

    const centerX = this.cameras.main.centerX;
    const t = (key, fallback) => GlobalLocalization.t(key, fallback);

    this.add.text(centerX, 60, t('APP_TITLE', 'SCALE DICE'), { fontSize: 60, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

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

      this.add
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
    };

    makeIcon(leftStartX, topY, 'settingsIcon', t('UI_SETTINGS', 'SETTINGS'), 'SettingsScene');
    makeIcon(leftStartX + (iconSize + iconPadding), topY, 'achievementIcon', t('UI_ACHIEVEMENTS', 'ACHIEVEMENTS'), 'AchievementsScene');
    makeIcon(rightStartX - (iconSize + iconPadding), topY, 'helpIcon', t('UI_HELP', 'HELP'), 'HelpScene');
    makeIcon(rightStartX, topY, 'changelogIcon', t('UI_CHANGELOG', 'CHANGELOG'), 'ChangelogScene');

    const makeWideBtn = (y, label, cb, opts = {}) => {
      const w = opts.width || 520;
      const h = opts.height || 56;
      const bg = this.add.rectangle(centerX, y, w, h, 0x222222).setStrokeStyle(2, 0x444444).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const txt = this.add.text(centerX, y, label, { fontSize: 28, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0.5);
      bg.on('pointerover', () => { bg.setFillStyle(0x2b2b2b); txt.setScale(1.03); });
      bg.on('pointerout', () => { bg.setFillStyle(0x222222); txt.setScale(1.0); });
      bg.on('pointerdown', () => { GlobalAudio.playButton(this); cb(); });
      return { bg, txt };
    };

    makeWideBtn(220, t('UI_LOCAL_PLAY', 'LOCAL PLAY').toUpperCase(), () => this.scene.start('LocalConfigScene'));
    makeWideBtn(300, t('UI_ONLINE_PLAY', 'ONLINE PLAY').toUpperCase(), () => this.scene.start('OnlineMenuScene'));
    makeWideBtn(380, t('CHALLENGES_TITLE', 'CHALLENGES'), () => this.scene.start('ChallengesScene'));

    const footerY = this.cameras.main.height - 40;
    const musicText = this.add.text(centerX, footerY, '', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#cccccc' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const refreshMusic = () => {
      const musicOn = GlobalSettings.get(this)?.music !== false;
      musicText.setText(musicOn ? t('UI_MUSIC_ON', 'MUSIC: ON') : t('UI_MUSIC_OFF', 'MUSIC: OFF'));
    };
    refreshMusic();

    musicText.on('pointerdown', () => {
      if (!GlobalAudio || typeof GlobalAudio.toggleMusic !== 'function') return;
      GlobalAudio.toggleMusic(this);
      refreshMusic();
      GlobalAudio.playButton(this);
    });

    if (GlobalAudio && typeof GlobalAudio.playMusic === 'function') GlobalAudio.playMusic(this);

    const backBtn = this.add.text(centerX, 460, t('UI_BACK', '<- BACK'), { fontSize: 26, fontFamily: 'Orbitron, Arial', color: '#ff6666' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => { GlobalAudio.playButton(this); this.scene.start('MenuScene'); });
    this.input.keyboard.on('keydown-ESC', () => {
      GlobalAudio.playButton(this);
      this.scene.start('MenuScene');
    });
  }
}


