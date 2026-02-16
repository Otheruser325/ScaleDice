import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalErrors from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';

export default class ChangelogScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ChangelogScene' });
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

    const CENTER_X = 600;
    let VIEW_WIDTH = 320;
    const VIEW_TOP = 160;
    const VIEW_HEIGHT = 780;
    const t = (key, fallback) => GlobalLocalization.t(key, fallback);

    const data = this.cache.json.get('changelog');
    if (!data) {
      console.warn('Changelog JSON missing');
      return;
    }

    const titleText = this.add.text(CENTER_X, 70, data.title ?? t('CHANGELOG_TITLE', 'CHANGELOG'), {
      fontSize: 48,
      fontFamily: 'Orbitron, Arial',
      color: '#ffffff'
    }).setOrigin(0.5);

    VIEW_WIDTH = Math.max(400, titleText.width + 40);

    this.content = this.add.container(CENTER_X - VIEW_WIDTH / 2, VIEW_TOP);

    let y = 0;
    data.entries.forEach((entry) => {
      const header = this.add.text(0, y, `v${entry.version} - ${entry.date}`, {
        fontSize: '28px',
        fontFamily: 'Orbitron, Arial',
        color: '#ffff66'
      });
      this.content.add(header);
      y += header.height + 6;

      if (entry.tags?.length) {
        const tagText = entry.tags.map((tag) => `[${tag}]`).join(' ');
        const tags = this.add.text(0, y, tagText, {
          fontSize: '16px',
          fontFamily: 'Orbitron, Arial',
          color: '#8ecae6'
        });
        this.content.add(tags);
        y += tags.height + 10;
      }

      entry.changes.forEach((change) => {
        const bullet = this.add.text(20, y, `- ${change}`, {
          fontSize: '20px',
          fontFamily: 'Orbitron, Arial',
          color: '#ffffff',
          wordWrap: { width: VIEW_WIDTH - 40 }
        });
        this.content.add(bullet);
        y += bullet.height + 8;
      });

      y += 18;
    });

    const maskShape = this.make.graphics();
    maskShape.fillRect(
      CENTER_X - VIEW_WIDTH / 2,
      VIEW_TOP,
      VIEW_WIDTH,
      VIEW_HEIGHT
    );

    const mask = maskShape.createGeometryMask();
    this.content.setMask(mask);

    this.scrollY = 0;
    this.maxScroll = Math.max(0, y - VIEW_HEIGHT);

    this.input.on('wheel', (_, __, ___, deltaY) => {
      this.scrollY = Phaser.Math.Clamp(
        this.scrollY + deltaY * 0.6,
        0,
        this.maxScroll
      );
      this.content.y = VIEW_TOP - this.scrollY;
    });

    const backBtn = this.add.text(100, 80, t('UI_BACK', '<- BACK'), {
      fontSize: 28,
      fontFamily: 'Orbitron, Arial',
      color: '#ff6666'
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('MenuScene');
    });

    this.input.keyboard.on('keydown-ESC', () => {
      GlobalAudio.playButton(this);
      this.scene.start('MenuScene');
    });
  }
}
