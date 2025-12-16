import GlobalAudio from '../utils/AudioManager.js';

export default class OnlineMenuScene extends Phaser.Scene {
    constructor() {
        super('OnlineMenuScene');
    }

    create() {
        this.add.text(600, 80, 'Online Mode', { fontSize: 48, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

        this.comingSoonText = this.add.text(600, 200, 'Coming soon...', { fontSize: 32, fontFamily: 'Orbitron, Arial' })
            .setOrigin(0.5);

        this.backBtn = this.add.text(600, 650, '← Back', {
            fontSize: 28,
            fontFamily: 'Orbitron, Arial',
            color: '#ff6666'
        })
        .setOrigin(0.5)
        .setInteractive();

        this.backBtn.on('pointerdown', () => {
			if (this.popupOpen) return; 
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }
}