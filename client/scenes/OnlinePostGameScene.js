import GlobalAudio from '../utils/AudioManager.js';

export default class OnlinePostGameScene extends Phaser.Scene {
    constructor() {
        super('OnlinePostGameScene');
    }

    create() {
        // Data injected by OnlineGameScene via registry
        const stats = this.registry.get("onlinePostGame");

        // Keep the results screen opaque even when another scene is still
        // winding down behind it.
        this.add.rectangle(640, 480, 1280, 960, 0x111111, 1);

        if (!stats) {
            this.add.text(600, 500, "No Results Available", { fontSize: 32, fontFamily: 'Orbitron, Arial' });
            return;
        }

        this.add.text(600, 50, "Online Game — Results", {
            fontSize: 40,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        if (stats.teamsEnabled) {
            this.renderTeamResults(stats);
            this.addReturnButton();
            return;
        }

        // --------------------------
        //   Determine Rankings
        // --------------------------
        const scores = Array.isArray(stats.scores) ? stats.scores : [];
        const names = Array.isArray(stats.names) ? stats.names : [];
        const comboStats = Array.isArray(stats.combos) ? stats.combos : [];
        const playerCount = stats.players || scores.length;

        const scoredPlayers = scores
            .map((score, index) => ({
                index,
                score
            }))
            .sort((a, b) => b.score - a.score);  // highest first

        const placements = new Array(playerCount);
        scoredPlayers.forEach((p, i) => placements[p.index] = i + 1);

        const rankColors = {
            1: "#FFD700",
            2: "#C0C0C0",
            3: "#CD7F32"
        };

        const buzzwords = {
            1: ["Winner winner!", "Dicetastic!", "Dice-tacular!"],
            2: ["Excellent performance!", "In-deucible!", "Outstanding!"],
            3: ["Good game!", "You did well!", "You show no mercy!"],
            other: ["Better luck next time!", "Pray to RNGesus!", "You'll be later gifted..."]
        };

        // --------------------------
        //     UI Layout Logic
        // --------------------------
        const totalPlayers = playerCount;
        let startY = 120;
        let titleSize = 26;
        let statSize = 20;
        let buzzSize = 22;
        let colX = [];

        if (totalPlayers === 2) {
            titleSize *= 1.2;
            statSize *= 1.5;
            buzzSize *= 1.5;
            colX = [300, 700];
        } else if (totalPlayers === 4) {
            colX = [300, 700];
        } else {
            colX = [200, 500, 800];
        }

        // --------------------------
        //    Render Result Blocks
        // --------------------------
        for (let i = 0; i < totalPlayers; i++) {
            const c = comboStats[i] || {
                pair: 0,
                twoPair: 0,
                triple: 0,
                fullHouse: 0,
                straight: 0,
                fourOfAKind: 0,
                fiveOfAKind: 0,
                threePair: 0,
                tripleTrend: 0,
                powerHouse: 0,
                sixOfAKind: 0
            };
            const name = names[i] || `Player ${i + 1}`;
            const score = scores[i] || 0;
            const placement = placements[i];

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
            const combosText =
`Score: ${score}

Pairs: ${c.pair}
Two Pairs: ${c.twoPair}
Triples: ${c.triple}
Full Houses: ${c.fullHouse}
Four-of-a-Kinds: ${c.fourOfAKind}
Five-of-a-Kinds: ${c.fiveOfAKind}
Three Pairs: ${c.threePair}
Triple Trends: ${c.tripleTrend}
Power Houses: ${c.powerHouse}
Six-of-a-Kinds: ${c.sixOfAKind}
Straights: ${c.straight}`;

            const spacing = totalPlayers === 2
                ? { titleToStats: 240, statsToBuzz: 220 }
                : { titleToStats: statSize * 5, statsToBuzz: buzzSize * 4.5 };

            // -- Title --
            this.add.text(x, y, title, {
                fontSize: titleSize,
                fontFamily: 'Orbitron, Arial',
                color: placeColor,
                align: "center",
                wordWrap: { width: 360 }
            }).setOrigin(0.5);

            // -- Stats --
            this.add.text(x, y + spacing.titleToStats, combosText, {
                fontSize: statSize,
                fontFamily: 'Orbitron, Arial',
                color: "#ffffff",
                align: "center"
            }).setOrigin(0.5);

            // -- Buzzword --
            this.add.text(
                x,
                y + spacing.titleToStats + spacing.statsToBuzz,
                `"${message}"`,
                {
                    fontSize: buzzSize,
                    fontFamily: 'Orbitron, Arial',
                    color: placeColor,
                    fontStyle: "italic",
                    align: "center"
                }
            ).setOrigin(0.5);
        }

        // --------------------------
        //     Return to Menu
        // --------------------------
        const back = this.add.text(640, 800, "Return to Menu", {
            fontSize: 26,
            fontFamily: 'Orbitron, Arial',
            color: "#ff6666"
        }).setOrigin(0.5).setInteractive();

        back.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }

    addReturnButton() {
        const back = this.add.text(640, 800, "Return to Menu", {
            fontSize: 26,
            fontFamily: 'Orbitron, Arial',
            color: "#ff6666"
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        back.on("pointerdown", () => {
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
                name: names[i] || `Player ${i + 1}`,
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

        const drawTeam = (team, x, label, panelColor, total) => {
            const members = team === 'blue' ? blue : red;
            const isWinner = winnerTeam === team;
            const accent = team === 'blue' ? '#99bbff' : '#ff9999';

            this.add.rectangle(x, 375, 520, 380, panelColor, 0.1)
                .setStrokeStyle(2, isWinner ? 0xffd700 : panelColor);
            this.add.text(x, 125, `${label} — ${total}`, {
                fontSize: 30,
                fontFamily: 'Orbitron, Arial',
                color: isWinner ? '#FFD700' : accent
            }).setOrigin(0.5);

            if (!members.length) {
                this.add.text(x, 300, 'No players', {
                    fontSize: 20,
                    fontFamily: 'Orbitron, Arial',
                    color: '#777777'
                }).setOrigin(0.5);
                return;
            }

            members.forEach((member, index) => {
                const y = 205 + index * 90;
                this.add.text(x - 210, y - 12, member.name, {
                    fontSize: 20,
                    fontFamily: 'Orbitron, Arial',
                    color: '#ffffff'
                }).setOrigin(0, 0.5);

                this.add.text(x + 210, y - 12, String(member.score), {
                    fontSize: 20,
                    fontFamily: 'Orbitron, Arial',
                    color: isWinner ? '#FFD700' : '#ffff88'
                }).setOrigin(1, 0.5);

                const combos = Object.entries(member.combos)
                    .filter(([, count]) => count > 0)
                    .map(([key, count]) => `${key}: ${count}`)
                    .join('  •  ');

                this.add.text(x, y + 24, combos || 'No combos achieved', {
                    fontSize: 13,
                    fontFamily: 'Orbitron, Arial',
                    color: combos ? '#cccccc' : '#777777',
                    align: 'center',
                    wordWrap: { width: 460 }
                }).setOrigin(0.5);
            });
        };

        drawTeam('blue', 320, 'BLUE TEAM', 0x003366, teamScores.blue);
        drawTeam('red', 880, 'RED TEAM', 0x440000, teamScores.red);

        this.add.text(600, 625, winnerTeam ? `${winnerTeam.toUpperCase()} TEAM WINS` : 'TIE GAME', {
            fontSize: 28,
            fontFamily: 'Orbitron, Arial',
            color: winnerTeam ? '#FFD700' : '#ffffff'
        }).setOrigin(0.5);
    }
}