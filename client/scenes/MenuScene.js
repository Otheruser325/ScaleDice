import GlobalAudio from '../utils/AudioManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';

export default class MenuScene extends Phaser.Scene {
    constructor() {
        super('MenuScene');
    }

    create() {
        const centerX = 600;

        // Title
        this.add
            .text(centerX, 80, 'SCALE DICE', {
                fontSize: 48,
                fontFamily: 'Orbitron, Arial'
            })
            .setOrigin(0.5);

        // Helper to create menu buttons consistently
        const makeButton = (y, label, sceneKey) => {
            const btn = this.add
                .text(centerX, y, label, {
                    fontSize: 32,
                    fontFamily: 'Orbitron, Arial'
                })
                .setOrigin(0.5)
                .setInteractive({ useHandCursor: true });

            btn.on('pointerover', () => btn.setScale(1.05));
            btn.on('pointerout', () => btn.setScale(1.0));

            btn.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.scene.start(sceneKey);
            });

            return btn;
        };

        // Main menu buttons (grouped & evenly spaced)
        makeButton(200, 'Play', 'PlayModeScene');
        makeButton(260, 'Achievements', 'AchievementsScene');
        makeButton(320, 'Settings', 'SettingsScene');
        makeButton(380, 'Help', 'HelpScene');
        makeButton(440, 'Changelog', 'ChangelogScene');

        // Start / resume music safely
        if (GlobalAudio && typeof GlobalAudio.playMusic === 'function') GlobalAudio.playMusic(this);
        // Initialise achievement popups
        if (GlobalAchievements && typeof GlobalAchievements.renderScene === 'function') GlobalAchievements.registerScene(this);
    }
}