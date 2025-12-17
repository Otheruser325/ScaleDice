import GlobalBackground from '../utils/BackgroundManager.js';

export default class PreloadScene extends Phaser.Scene {
    constructor() {
        super('PreloadScene');
    }

    preload() {
        this.cameras.main.setBackgroundColor('#000000');

        const titleStyle = { fontSize: '64px', color: '#ffffff', fontFamily: 'Orbitron, Arial' };
        const loadingStyle = { fontSize: '20px', color: '#000000', fontFamily: 'Orbitron, Arial' };

        this.add.text(600, 100, 'SCALE DICE', titleStyle).setOrigin(0.5);

        // Left/Right coordinates: keep the bar visually centered on x=600 width=300
        const barX = 600 - 150;
        const barY = 350;
        const barW = 300;
        const barH = 30;

        // Background
        const progressBarBg = this.add.rectangle(600, barY, barW, barH, 0x444444).setOrigin(0.5);

        const progressBarFill = this.add.rectangle(barX, barY, 0, barH, 0xFFEE55)
            .setOrigin(0, 0.5);

        this.loadingPercent = this.add.text(600, barY, '0%', loadingStyle)
            .setOrigin(0.5);

        this.loadingText = this.add.text(600, 300, 'Loading...', { fontSize: '28px', color: '#ffffff', fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

        this.load.on('progress', (value) => {
            progressBarFill.width = Math.max(2, Math.round(barW * value));
            this.loadingPercent.setText(`${Math.round(value * 100)}%`);
        });

        this.load.on('complete', () => {
            this.tweens.add({
                targets: [progressBarBg, progressBarFill, this.loadingPercent, this.loadingText],
                alpha: 0,
                duration: 400,
                onComplete: () => {
                    this.time.delayedCall(180, () => this.scene.start('MenuScene'));
                }
            });
        });

        GlobalBackground.createBackgroundPanel(this, { width: 920, height: 760, useImageIfAvailable: false });

        // ---- Assets ----
        this.load.audio('button', 'assets/audio/button.mp3');
        this.load.audio('dice', 'assets/audio/dice.mp3');
        this.load.audio('combo_pair', 'assets/audio/combo_pair.mp3');
        this.load.audio('combo_triple', 'assets/audio/combo_triple.mp3');
        this.load.audio('combo_fullHouse', 'assets/audio/combo_fullHouse.mp3');
        this.load.audio('combo_fourOfAKind', 'assets/audio/combo_fourOfAKind.mp3');
        this.load.audio('combo_fiveOfAKind', 'assets/audio/combo_fiveOfAKind.mp3');
        this.load.audio('combo_straight', 'assets/audio/combo_straight.mp3');
        this.load.audio('dice_league', 'assets/music/dice_league.mp3');
        this.load.audio('energy', 'assets/music/energy.mp3');
        this.load.audio('powerhouse', 'assets/music/powerhouse.mp3');

        this.load.json('changelog', 'config/changelog.json');

        this.load.image('bg', 'assets/bg/Background-floor.png');

        this.load.image('dice1', 'assets/dice/dice-six-faces-one.png');
        this.load.image('dice2', 'assets/dice/dice-six-faces-two.png');
        this.load.image('dice3', 'assets/dice/dice-six-faces-three.png');
        this.load.image('dice4', 'assets/dice/dice-six-faces-four.png');
        this.load.image('dice5', 'assets/dice/dice-six-faces-five.png');
        this.load.image('dice6', 'assets/dice/dice-six-faces-six.png');

        this.load.image('settingsIcon', 'assets/ui/settings.png');
        this.load.image('achievementIcon', 'assets/ui/achievement.png');
        this.load.image('helpIcon', 'assets/ui/help.png');
        this.load.image('changelogIcon', 'assets/ui/changelog.png');
        this.load.image('playerIcon', 'assets/ui/player.png');
        this.load.image('botIcon', 'assets/ui/robot.png');
    }

    create() {
		GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
		
        const saved = JSON.parse(localStorage.getItem('scaleDice_settings')) || {};
        const defaults = {
            audio: true,
            music: true,
            visualEffects: true,
            shuffleTrack: false,
            trackIndex: 0
        };

        const finalSettings = { ...defaults, ...saved };
        this.registry.set('settings', finalSettings);
    }
}