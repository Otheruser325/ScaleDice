import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import { formatCompact } from '../utils/FormatManager.js';

export default class ChallengeConfigScene extends Phaser.Scene {
    constructor() {
        super('ChallengeConfigScene');
    }

    create() {
        try {
            GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}
        try {
            GlobalAchievements.registerScene(this);
        } catch (e) {}

        const config = this.registry.get("challengeConfig") || {};
        const cx = this.cameras.main.centerX;

        this.add.text(cx, 50, `${config.title || 'CHALLENGE'}`, {
            fontSize: 40,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        this.add.text(cx, 100, config.desc || 'Challenge description', {
            fontSize: 20,
            fontFamily: 'Orbitron, Arial',
            color: '#cccccc',
            align: 'center',
            wordWrap: { width: 600 }
        }).setOrigin(0.5);

        // Display config
        let y = 160;
        this.add.text(cx, y, `Players: ${config.players || 2}`, {
            fontSize: 22,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);
        y += 30;

        this.add.text(cx, y, `Rounds: ${config.rounds || 30}`, {
            fontSize: 22,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);
        y += 30;

        this.add.text(cx, y, `Cost Multiplier: x${config.costMult || 1}`, {
            fontSize: 22,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);
        y += 30;

        this.add.text(cx, y, `Big Upgrades: ${config.bigUpgradesEnabled ? 'Enabled' : 'Disabled'}`, {
            fontSize: 22,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);
        y += 30;

        if (config.teamsEnabled) {
            this.add.text(cx, y, `Teams: Enabled`, {
                fontSize: 22,
                fontFamily: 'Orbitron, Arial'
            }).setOrigin(0.5);
            y += 30;
        }

        // Players
        y += 20;
        this.add.text(cx, y, 'Players:', {
            fontSize: 24,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);
        y += 40;

        for (let i = 0; i < (config.players || 2); i++) {
            const name = config.names?.[i] || `P${i + 1}`;
            const isAI = config.ai?.[i] || false;
            const diff = config.difficulty?.[i] || 'Medium';
            const team = config.teams?.[i] || 'blue';

            const line = `${name} (${isAI ? `AI ${diff}` : 'Human'})${config.teamsEnabled ? ` - ${team.toUpperCase()}` : ''}`;
            this.add.text(cx, y, line, {
                fontSize: 18,
                fontFamily: 'Orbitron, Arial',
                color: isAI ? '#ff6666' : '#66ff66'
            }).setOrigin(0.5);
            y += 25;
        }

        // Start Game
        this.add.text(cx, 500, 'START CHALLENGE', {
            fontSize: 32,
            fontFamily: 'Orbitron, Arial',
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalGameScene', config);
        });

        // Back
        this.add.text(cx, 550, '← BACK', {
            fontSize: 24,
            fontFamily: 'Orbitron, Arial',
            color: '#ff6666'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('ChallengesScene');
        });

        this.input.keyboard.on('keydown-ESC', () => {
            GlobalAudio.playButton(this);
            this.scene.start('ChallengesScene');
        });
    }
}