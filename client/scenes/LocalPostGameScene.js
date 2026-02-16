import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ChallengeManager from '../utils/ChallengeManager.js';
import GlobalErrors from '../utils/ErrorManager.js';
import { formatCompact } from '../utils/FormatManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';

export default class LocalPostGameScene extends Phaser.Scene {
    constructor() {
        super('LocalPostGameScene');
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
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
		
        const stats = this.registry.get("localPostGame") || {};
        const totalPlayers = stats.players || 0;

        this.add.text(600, 50, t('POSTGAME_TITLE', 'LOCAL GAME - RESULTS'), {
            fontSize: 40,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        // -------- Determine Rankings --------
        const scoredPlayers = (stats.scores || [])
            .map((score, index) => ({ index, score }))
            .sort((a, b) => b.score - a.score);

        const placements = new Array(stats.players || 0);
        scoredPlayers.forEach((p, i) => placements[p.index] = i + 1);

        // Determine if player won challenge
        let playerWon = false;
        if (stats.teamsEnabled && stats.teams && stats.scores) {
            const bluePlayers = [];
            const redPlayers = [];
            for (let i = 0; i < stats.players; i++) {
                const team = stats.teams[i] || 'blue';
                const score = stats.scores[i] || 0;
                if (team === 'blue') {
                    bluePlayers.push(score);
                } else {
                    redPlayers.push(score);
                }
            }
            const blueTotal = bluePlayers.reduce((s, p) => s + p, 0);
            const redTotal = redPlayers.reduce((s, p) => s + p, 0);
            const playerTeam = stats.teams[0] || 'blue';
            playerWon = playerTeam === 'blue' ? blueTotal >= redTotal : redTotal >= blueTotal;
        } else {
            playerWon = placements[0] === 1;
        }

        // Complete challenge if won
        if (stats.challengeKey && playerWon) {
          GlobalAchievements.completeChallenge(stats.challengeKey);
        }
        if (stats.challengeKey) {
          try {
            ChallengeManager.recordResult(stats.challengeKey, playerWon, {
              dateKey: stats.challengeDate,
              reward: stats.challengeReward
            });
          } catch (e) {}
        }

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
            // Sort by count descending
            comboLines.sort((a, b) => {
              const aCount = parseInt(a.split(': ')[1]);
              const bCount = parseInt(b.split(': ')[1]);
              return bCount - aCount;
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
                comboLines.length ? comboLines.join('  •  ') : t('POSTGAME_NO_COMBOS', 'No combos achieved'),
                {
                    fontSize: 12,
                    fontFamily: 'Orbitron, Arial',
                    color: comboLines.length ? '#cccccc' : '#777777',
                    align: 'center',
                    wordWrap: { width: 460 }
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

    drawTeam(blue, leftX, t('TEAM_BLUE_LABEL', 'BLUE TEAM'), blueTotal, blueWins, 0x003366);
    drawTeam(red, rightX, t('TEAM_RED_LABEL', 'RED TEAM'), redTotal, !blueWins, 0x440000);
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
                // Sort by count descending
                combosToShow.sort((a, b) => {
                  const aCount = parseInt(a.split(': ')[1]);
                  const bCount = parseInt(b.split(': ')[1]);
                  return bCount - aCount;
                });

                // Title (larger + coloured)
                this.add.text(x, y, title, {
                    fontSize: titleSize,
                    fontFamily: 'Orbitron, Arial',
                    color: placeColor,
                    align: "center"
                }).setOrigin(0.5);

                // Score line
                this.add.text(x, y + 34, GlobalLocalization.format('POSTGAME_SCORE_LINE', 'Score: {0}', formatCompact(score)), {
                    fontSize: statSize,
                    fontFamily: 'Orbitron, Arial',
                    color: "#ffff88",
                    align: "center"
                }).setOrigin(0.5);

                // Stats block (only combos earned)
                let combosY = y + 70;
                if (combosToShow.length) {
                  this.add.text(x, combosY, combosToShow.join('\n'), {
                      fontSize: statSize * 0.67,
                      fontFamily: 'Orbitron, Arial',
                      color: "#ffffff",
                      align: "center",
                      lineSpacing: -6
                  }).setOrigin(0.5);
                } else {
                  this.add.text(x, combosY, t('POSTGAME_NO_COMBOS', 'No combos achieved'), {
                      fontSize: statSize * 0.67,
                      fontFamily: 'Orbitron, Arial',
                      color: "#888888",
                      align: "center"
                  }).setOrigin(0.5);
                }

                // Buzzword (highlighted slightly bigger)
                const buzzY = combosY + (combosToShow.length > 0 ? combosToShow.length * (statSize * 0.67 + 2) + 20 : 30);
                this.add.text(x, buzzY, `"${message}"`, {
                    fontSize: buzzSize,
                    fontFamily: 'Orbitron, Arial',
                    color: placeColor,
                    fontStyle: "italic",
                    align: "center"
                }).setOrigin(0.5);
            }
        }

        // -------- Back Button --------
        const back = this.add.text(650, 800, t('POSTGAME_RETURN', 'RETURN TO MENU'), {
            fontSize: 26,
            fontFamily: 'Orbitron, Arial',
            color: "#ff6666"
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        back.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
		
		this.input.keyboard.on('keydown-ESC', () => {
          GlobalAudio.playButton(this);
          this.scene.start('MenuScene');
        });
    }
}

