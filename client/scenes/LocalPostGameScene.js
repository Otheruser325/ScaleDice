import GlobalAudio from '../utils/AudioManager.js';
import { formatCompact } from '../utils/FormatManager.js';

export default class LocalPostGameScene extends Phaser.Scene {
    constructor() {
        super('LocalPostGameScene');
    }

    create() {
        const stats = this.registry.get("localPostGame") || {};
        const totalPlayers = stats.players || 0;

        this.add.text(600, 50, "Local Game — Results", {
            fontSize: 40,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        // -------- Determine Rankings --------
        const scoredPlayers = (stats.scores || [])
            .map((score, index) => ({ index, score }))
            .sort((a, b) => b.score - a.score);

        const placements = new Array(stats.players || 0);
        scoredPlayers.forEach((p, i) => placements[p.index] = i + 1);

        // Rank colors
        const rankColors = {
            1: "#FFD700", // Gold
            2: "#C0C0C0", // Silver
            3: "#CD7F32", // Bronze
        };

        // Positive buzzword per placement
        const buzzwords = {
            1: [
                "Winner winner!",
                "Dicetastic!",
                "Dice-tacular!"
            ],
            2: [
                "Excellent performance!",
                "In-deucible!",
                "Outstanding!"
            ],
            3: [
                "Good game!",
                "You did well!",
                "You show no mercy!"
            ],
            other: [
                "Better luck next time!",
                "Pray to RNGesus!",
                "You'll be later gifted..."
            ]
        };

        // If teams mode: summarize teams and show two big columns
        if (stats.teamsEnabled) {
    const bluePlayers = [];
    const redPlayers = [];

    for (let i = 0; i < stats.players; i++) {
        const team = stats.teams?.[i] || 'blue';
        const name = stats.names?.[i] || `P${i + 1}`;
        const score = stats.scores?.[i] || 0;
        const combos = stats.combos?.[i] || {};
        bluePlayers.push(team === 'blue' ? { i, name, score, combos } : null);
        redPlayers.push(team === 'red' ? { i, name, score, combos } : null);
    }

    const blue = bluePlayers.filter(Boolean);
    const red = redPlayers.filter(Boolean);

    const blueTotal = blue.reduce((s, p) => s + p.score, 0);
    const redTotal = red.reduce((s, p) => s + p.score, 0);

    const blueWins = blueTotal >= redTotal;

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
            fontFamily: 'Orbitron, Arial',
            color: isWinner ? '#FFD700' : '#ff9999'
        }).setOrigin(0.5);

        players.forEach((p, idx) => {
            const y = startY + idx * rowHeight;

            const comboLines = [];
            Object.entries(p.combos).forEach(([k, v]) => {
                if (v > 0) comboLines.push(`${k}: ${v}`);
            });

            const glow = this.add.rectangle(x, y + 10, 480, 90,
                isWinner ? 0xFFD700 : tint, isWinner ? 0.15 : 0.08
            ).setOrigin(0.5);

            glow.setStrokeStyle(isWinner ? 2 : 1, isWinner ? 0xFFD700 : 0x666666);

            this.add.text(x - 160, y - 8, p.name, {
                fontSize: 22,
                fontFamily: 'Orbitron, Arial',
                color: '#ffffff'
            }).setOrigin(0.5);

            this.add.text(x + 160, y - 8, formatCompact(p.score), {
                fontSize: 22,
                fontFamily: 'Orbitron, Arial',
                color: isWinner ? '#FFD700' : '#ffff88'
            }).setOrigin(0.5);

            this.add.text(
                x,
                y + 26,
                comboLines.length ? comboLines.join('  •  ') : 'No combos achieved',
                {
                    fontSize: 16,
                    fontFamily: 'Orbitron, Arial',
                    color: comboLines.length ? '#cccccc' : '#777777',
                    align: 'center'
                }
            ).setOrigin(0.5);
        });

        const buzzPool = isWinner
            ? ["Winner winner!", "Dicetastic!", "Dice-tacular!"]
            : ["Better luck next time!", "Pray to RNGesus!", "You'll be later gifted..."];

        this.add.text(x, startY + players.length * rowHeight + 40,
            `"${Phaser.Utils.Array.GetRandom(buzzPool)}"`,
            {
                fontSize: 22,
                fontFamily: 'Orbitron, Arial',
                fontStyle: 'italic',
                color: isWinner ? '#FFD700' : '#ff6666'
            }
        ).setOrigin(0.5);
    };

    drawTeam(blue, leftX, 'BLUE TEAM', blueTotal, blueWins, 0x003366);
    drawTeam(red, rightX, 'RED TEAM', redTotal, !blueWins, 0x440000);
} else {
            // non-team display: grid up to 3 columns, center-aligned
            let startY = 140;
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

            for (let i = 0; i < stats.players; i++) {
                const c = stats.combos[i] || {};
                const name = stats.names[i] || `P${i+1}`;
                const score = stats.scores[i] || 0;
                const placement = placements[i] || (i + 1);

                let row, col, x, y;

                if (totalPlayers === 2) {
                    row = 0;
                    col = i;
                    x = colX[col];
                    y = startY;
                } else if (totalPlayers === 4) {
                    row = Math.floor(i / 2);
                    col = i % 2;
                    x = colX[col];
                    y = startY + row * 260;
                } else {
                    row = Math.floor(i / 3);
                    col = i % 3;
                    x = colX[col];
                    y = startY + row * 260;
                }

                const pool = buzzwords[placement] || buzzwords.other;
                const message = pool[Math.floor(Math.random() * pool.length)];
                const placeColor = rankColors[placement] || "#ffffff";

                const title = `${name} — #${placement}`;

                // Build combos string but filter out zero counts and only present ones earned
                const combosToShow = [];
                const keysOrder = ['pair','twoPair','triple','fullHouse','fourOfAKind','fiveOfAKind','threePair','tripleTrend','powerHouse','sixOfAKind','straight'];
                keysOrder.forEach(k => {
                  const v = c[k] ?? 0;
                  if (v > 0) combosToShow.push(`${k}: ${v}`);
                });

                // Title (larger + coloured)
                this.add.text(x, y, title, {
                    fontSize: titleSize,
                    fontFamily: 'Orbitron, Arial',
                    color: placeColor,
                    align: "center"
                }).setOrigin(0.5);

                // Score line
                this.add.text(x, y + 34, `Score: ${formatCompact(score)}`, {
                    fontSize: statSize,
                    fontFamily: 'Orbitron, Arial',
                    color: "#ffff88",
                    align: "center"
                }).setOrigin(0.5);

                // Stats block (only combos earned)
                if (combosToShow.length) {
                  this.add.text(x, y + 70, combosToShow.join('\n'), {
                      fontSize: statSize,
                      fontFamily: 'Orbitron, Arial',
                      color: "#ffffff",
                      align: "center"
                  }).setOrigin(0.5);
                } else {
                  this.add.text(x, y + 70, 'No combos achieved', {
                      fontSize: statSize,
                      fontFamily: 'Orbitron, Arial',
                      color: "#888888",
                      align: "center"
                  }).setOrigin(0.5);
                }

                // Buzzword (highlighted slightly bigger)
                this.add.text(x, y + 150, `"${message}"`, {
                    fontSize: buzzSize,
                    fontFamily: 'Orbitron, Arial',
                    color: placeColor,
                    fontStyle: "italic",
                    align: "center"
                }).setOrigin(0.5);
            }
        }

        // -------- Back Button --------
        const back = this.add.text(650, 800, "Return to Menu", {
            fontSize: 26,
            fontFamily: 'Orbitron, Arial',
            color: "#ff6666"
        }).setOrigin(0.5).setInteractive();

        back.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }
}