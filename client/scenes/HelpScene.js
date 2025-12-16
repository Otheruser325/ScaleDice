import GlobalAudio from '../utils/AudioManager.js';

export default class HelpScene extends Phaser.Scene {
    constructor() {
        super('HelpScene');
    }

    create() {
        this.popupOpen = false;
		
        this.add.text(600, 70, 'Help', {
            fontSize: '52px',
            fontFamily: 'Orbitron, Arial',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(600, 130, 'How to Play Scale Dice', {
            fontSize: '32px',
            fontFamily: 'Orbitron, Arial',
            color: '#ffff66'
        }).setOrigin(0.5);

        const helpText =
            "TBA";

        this.add.text(600, 390, helpText, {
            fontSize: '22px',
            fontFamily: 'Orbitron, Arial',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: 620 }
        }).setOrigin(0.5);

        this.comboBtn = this.add.text(900, 40, 'Special Rules', {
            fontSize: '22px',
            fontFamily: 'Orbitron, Arial',
            color: '#ffdd66'
        })
        .setOrigin(1, 0.5)
        .setInteractive();

        this.comboBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.showComboPopup();
        });

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

    showComboPopup() {
		this.popupOpen = true;
		
		this.backBtn.disableInteractive();
        if (this.comboBtn) this.comboBtn.disableInteractive();
		
        const bg = this.add.rectangle(600, 300, 600, 380, 0x000000, 0.75)
            .setStrokeStyle(3, 0xffffff);

        const title = this.add.text(600, 140, 'Special Rules', {
            fontSize: '32px',
            fontFamily: 'Orbitron, Arial',
            color: '#ffff66'
        }).setOrigin(0.5);

        const specialRules =
            "TBA";

        const rulesText = this.add.text(600, 320, specialRules, {
            fontSize: '20px',
            fontFamily: 'Orbitron, Arial',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: 520 }
        }).setOrigin(0.5);

        const closeBtn = this.add.text(600, 480, 'Close', {
            fontSize: 26,
            fontFamily: 'Orbitron, Arial',
            color: '#ff6666'
        })
        .setOrigin(0.5)
        .setInteractive();

        closeBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
			
            bg.destroy();
            title.destroy();
            rulesText.destroy();
            closeBtn.destroy();
			
			this.popupOpen = false;
            this.backBtn.setInteractive();
            if (this.comboBtn) this.comboBtn.setInteractive();
        });
    }
}