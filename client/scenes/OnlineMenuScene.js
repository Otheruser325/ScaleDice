import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';

export default class OnlineMenuScene extends Phaser.Scene {
    constructor() {
        super('OnlineMenuScene');
    }

    create() {
	    try {
          GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}
        try {
          GlobalAchievements.registerScene(this);
        } catch (e) {}
		
        this.add.text(600, 80, 'Online Mode', { fontSize: 48, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

        this.comingSoonText = this.add.text(600, 200, 'Coming soon...', { fontSize: 32, fontFamily: 'Orbitron, Arial' })
            .setOrigin(0.5);

        this.backBtn = this.add.text(600, 650, '← Back', {
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