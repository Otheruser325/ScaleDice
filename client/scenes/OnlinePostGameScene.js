import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import { formatCompact } from '../utils/FormatManager.js';

const FONT = 'Orbitron, Arial';

export default class OnlinePostGameScene extends Phaser.Scene {
    constructor() {
        super('OnlinePostGameScene');
    }

    create() {
        try {
            GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (err) { /* keep results readable if the background fails */ }


        // Data injected by OnlineGameScene via registry.
        const stats = this.registry.get('onlinePostGame');

        this.add.text(600, 50, 'ONLINE GAME - RESULTS', {
            fontSize: 40,
            fontFamily: FONT
        }).setOrigin(0.5);

        if (!stats) {
            this.add.text(600, 500, 'No Results Available', {
                fontSize: 32,
                fontFamily: FONT
            }).setOrigin(0.5);
            this.addReturnButton();
            return;
        }

        if (stats.teamsEnabled) {
            this.renderTeamResults(stats);
            this.addReturnButton();
            return;
        }

        const scores = Array.isArray(stats.scores) ? stats.scores : [];
        const names = Array.isArray(stats.names) ? stats.names : [];
        const comboStats = Array.isArray(stats.combos) ? stats.combos : [];
        const totalPlayers = stats.players || scores.length;

        const scoredPlayers = scores
            .map((score, index) => ({ index, score }))
            .sort((a, b) => b.score - a.score);
        const placements = new Array(totalPlayers);
        scoredPlayers.forEach((player, index) => { placements[player.index] = index + 1; });

        const rankColors = {
            1: '#FFD700',
            2: '#C0C0C0',
            3: '#CD7F32'
        };
        const buzzwords = {
            1: ['Winner winner!', 'Dicetastic!', 'Dice-tacular!'],
            2: ['Excellent performance!', 'In-deucible!', 'Outstanding!'],
            3: ['Good game!', 'You did well!', 'You show no mercy!'],
            other: ['Better luck next time!', 'Pray to RNGesus!', "You'll be later gifted..."]
        };

        // Mirrors LocalPostGameScene's grid, including the 2-player sizing.
        const startY = 140;
        let titleSize = 26;
        let statSize = 18;
        let buzzSize = 20;
        let colX = [];

        if (totalPlayers === 2) {
            titleSize *= 1.35;
            statSize *= 1.25;
            buzzSize *= 1.25;
            colX = [350, 850];
        } else if (totalPlayers === 4) {
            colX = [300, 900];
        } else {
            colX = [200, 600, 1000];
        }

        for (let i = 0; i < totalPlayers; i += 1) {
            const combos = comboStats[i] || {};
            const name = names[i] || `P${i + 1}`;
            const score = scores[i] || 0;
            const placement = placements[i] || (i + 1);
            const pool = buzzwords[placement] || buzzwords.other;
            const message = pool[Math.floor(Math.random() * pool.length)];
            const placeColor = rankColors[placement] || '#ffffff';

            let row;
            let col;
            if (totalPlayers === 2) {
                row = 0;
                col = i;
            } else if (totalPlayers === 4) {
                row = Math.floor(i / 2);
                col = i % 2;
            } else {
                row = Math.floor(i / 3);
                col = i % 3;
            }
            const x = colX[col];
            const y = startY + row * 260;

            const keysOrder = ['pair', 'twoPair', 'triple', 'fullHouse', 'fourOfAKind', 'fiveOfAKind', 'threePair', 'tripleTrend', 'powerHouse', 'sixOfAKind', 'straight'];
            const combosToShow = [];
            keysOrder.forEach((key) => {
                const value = combos[key] ?? 0;
                if (value > 0) combosToShow.push(`${key}: ${value}`);
            });
            combosToShow.sort((a, b) => {
                const aCount = parseInt(a.split(': ')[1], 10);
                const bCount = parseInt(b.split(': ')[1], 10);
                return bCount - aCount;
            });

            this.add.text(x, y, `${name} — #${placement}`, {
                fontSize: titleSize,
                fontFamily: FONT,
                color: placeColor,
                align: 'center'
            }).setOrigin(0.5);

            this.add.text(x, y + 34, `Score: ${formatCompact(score)}`, {
                fontSize: statSize,
                fontFamily: FONT,
                color: '#ffff88',
                align: 'center'
            }).setOrigin(0.5);

            const combosY = y + 70;
            if (combosToShow.length) {
                this.add.text(x, combosY, combosToShow.join('\n'), {
                    fontSize: statSize * 0.67,
                    fontFamily: FONT,
                    color: '#ffffff',
                    align: 'center',
                    lineSpacing: -6
                }).setOrigin(0.5);
            } else {
                this.add.text(x, combosY, 'No combos achieved', {
                    fontSize: statSize * 0.67,
                    fontFamily: FONT,
                    color: '#888888',
                    align: 'center'
                }).setOrigin(0.5);
            }

            const buzzY = combosY + (combosToShow.length > 0 ? combosToShow.length * (statSize * 0.67 + 2) + 20 : 30);
            this.add.text(x, buzzY, `"${message}"`, {
                fontSize: buzzSize,
                fontFamily: FONT,
                color: placeColor,
                fontStyle: 'italic',
                align: 'center'
            }).setOrigin(0.5);
        }

        this.addReturnButton();
    }

    addReturnButton() {
        const back = this.add.text(650, 800, 'RETURN TO MENU', {
            fontSize: 26,
            fontFamily: FONT,
            color: '#ff6666'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        back.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });

        this.input.keyboard.on('keydown-ESC', () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }

    renderTeamResults(stats) {
        const scores = Array.isArray(stats.scores) ? stats.scores : [];
        const names = Array.isArray(stats.names) ? stats.names : [];
        const comboStats = Array.isArray(stats.combos) ? stats.combos : [];
        const teams = Array.isArray(stats.teams) ? stats.teams : [];
        const playerCount = stats.players || scores.length;

        const blue = [];
        const red = [];
        for (let i = 0; i < playerCount; i += 1) {
            const member = {
                name: names[i] || `P${i + 1}`,
                score: scores[i] || 0,
                combos: comboStats[i] || {}
            };
            if (teams[i] === 'red') red.push(member);
            else blue.push(member);
        }

        const computed = {
            blue: blue.reduce((sum, player) => sum + player.score, 0),
            red: red.reduce((sum, player) => sum + player.score, 0)
        };
        const teamScores = stats.teamScores && Number.isFinite(stats.teamScores.blue) && Number.isFinite(stats.teamScores.red)
            ? stats.teamScores
            : computed;

        let winnerTeam = stats.winnerTeam;
        if (winnerTeam !== 'blue' && winnerTeam !== 'red') {
            winnerTeam = teamScores.blue === teamScores.red ? null : (teamScores.blue > teamScores.red ? 'blue' : 'red');
        }

        const leftX = 320;
        const rightX = 880;
        const startY = 140;
        const rowHeight = 110;

        const drawTeam = (players, x, title, total, isWinner, tint) => {
            const bgHeight = Math.max(300, players.length * rowHeight + 120);

            this.add.rectangle(x, 140, 520, bgHeight,
                isWinner ? 0xFFD700 : tint, isWinner ? 0.22 : 0.18
            ).setOrigin(0.5);

            this.add.text(x, 80, `${title} — ${formatCompact(total)}`, {
                fontSize: 30,
                fontFamily: FONT,
                color: isWinner ? '#FFD700' : '#ff9999'
            }).setOrigin(0.5);

            players.forEach((player, index) => {
                const y = startY + index * rowHeight;
                const comboLines = [];
                Object.entries(player.combos).forEach(([key, value]) => {
                    if (value > 0) comboLines.push(`${key}: ${value}`);
                });
                comboLines.sort((a, b) => {
                    const aCount = parseInt(a.split(': ')[1], 10);
                    const bCount = parseInt(b.split(': ')[1], 10);
                    return bCount - aCount;
                });

                const glow = this.add.rectangle(x, y + 10, 480, 90,
                    isWinner ? 0xFFD700 : tint, isWinner ? 0.15 : 0.08
                ).setOrigin(0.5);
                glow.setStrokeStyle(isWinner ? 2 : 1, isWinner ? 0xFFD700 : 0x666666);

                this.add.text(x - 160, y - 8, player.name, {
                    fontSize: 22,
                    fontFamily: FONT,
                    color: '#ffffff'
                }).setOrigin(0.5);

                this.add.text(x + 160, y - 8, formatCompact(player.score), {
                    fontSize: 22,
                    fontFamily: FONT,
                    color: isWinner ? '#FFD700' : '#ffff88'
                }).setOrigin(0.5);

                this.add.text(
                    x,
                    y + 26,
                    comboLines.length ? comboLines.join('  •  ') : 'No combos achieved',
                    {
                        fontSize: 12,
                        fontFamily: FONT,
                        color: comboLines.length ? '#cccccc' : '#777777',
                        align: 'center',
                        wordWrap: { width: 460 }
                    }
                ).setOrigin(0.5);
            });

            const buzzPool = isWinner
                ? ['Winner winner!', 'Dicetastic!', 'Dice-tacular!']
                : ['Better luck next time!', 'Pray to RNGesus!', "You'll be later gifted..."];
            this.add.text(x, startY + players.length * rowHeight + 40,
                `"${Phaser.Utils.Array.GetRandom(buzzPool)}"`,
                {
                    fontSize: 22,
                    fontFamily: FONT,
                    fontStyle: 'italic',
                    color: isWinner ? '#FFD700' : '#ff6666'
                }
            ).setOrigin(0.5);
        };

        drawTeam(blue, leftX, 'BLUE TEAM', teamScores.blue, winnerTeam === 'blue', 0x003366);
        drawTeam(red, rightX, 'RED TEAM', teamScores.red, winnerTeam === 'red', 0x440000);

        if (!winnerTeam) {
            this.add.text(600, 625, 'TIE GAME', {
                fontSize: 28,
                fontFamily: FONT,
                color: '#ffffff'
            }).setOrigin(0.5);
        }
    }
}
