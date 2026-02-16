import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalErrors from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';

export default class OnlineMenuScene extends Phaser.Scene {
    constructor() {
        super('OnlineMenuScene');
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
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);

        this.add.text(600, 80, t('ONLINE_TITLE', 'Online Mode'), { fontSize: 48, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

        this.comingSoonText = this.add.text(600, 200, t('CHALLENGE_COMING_SOON', 'Coming Soon...'), { fontSize: 32, fontFamily: 'Orbitron, Arial' })
            .setOrigin(0.5);

        this.backBtn = this.add.text(600, 650, t('UI_BACK', '<- BACK'), {
            fontSize: 28,
            fontFamily: 'Orbitron, Arial',
            color: '#ff6666'
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

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

