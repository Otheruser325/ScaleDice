import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';

export default class LocalConfigScene extends Phaser.Scene {
    constructor() {
        super('LocalConfigScene');

        this.selectedPlayers = 2;
        this.selectedRounds = 30;
        this.teamsEnabled = false;
        this.costMultIndex = 4;
        this.costMultipliers = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5];
        this.playerTeams = ['blue', 'red', 'blue', 'red', 'blue', 'red'];
        this.playerNames = ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"];
        this.isAI = [false, true, true, true, true, true];
        this.aiDifficulty = ["Medium", "Medium", "Medium", "Medium", "Medium", "Medium"];
        this.aiDifficultyLevels = [{
                name: "Baby",
                value: 0.5
            },
            {
                name: "Easy",
                value: 0.75
            },
            {
                name: "Medium",
                value: 1
            },
            {
                name: "Hard",
                value: 1.5
            },
            {
                name: "Nightmare",
                value: 2
            }
        ];
    }

    create() {
        GlobalBackground.registerScene(this, {
            key: 'bg',
            useImageIfAvailable: true
        });
        this.add.text(600, 50, 'Local Game Setup', {
            fontSize: 40,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        // ---------------- Players ----------------
        this.add.text(600, 110, 'Players', {
            fontSize: 28,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        [2, 3, 4].forEach((num, i) => {
            this.add.text(520 + i * 80, 150, String(num), {
                    fontSize: 26,
                    fontFamily: 'Orbitron, Arial',
                    color: num === this.selectedPlayers ? '#ffff66' : '#ffffff'
                }).setOrigin(0.5).setInteractive()
                .on('pointerdown', () => {
                    this.selectedPlayers = num;
                    this.refreshScene();
                });
        });

        // Player rows
        for (let i = 0; i < this.selectedPlayers; i++) {
            const y = 200 + i * 70;

            this.add.text(60, y, `P${i + 1}`, {
                fontSize: 22,
                fontFamily: 'Orbitron, Arial'
            }).setOrigin(0.5);

            // Name
            this.add.text(160, y, this.playerNames[i], {
                    fontSize: 22,
                    fontFamily: 'Orbitron, Arial',
                    backgroundColor: '#222222',
                    padding: {
                        x: 8,
                        y: 4
                    }
                })
                .setOrigin(0.5)
                .setInteractive()
                .on('pointerdown', () => {
                    const n = prompt(`Name for Player ${i + 1}`, this.playerNames[i]);
                    if (n) {
                        this.playerNames[i] = n.substring(0, 12);
                        this.refreshScene();
                    }
                });

            // AI toggle
            this.add.text(310, y, this.isAI[i] ? 'Computer' : 'Human', {
                    fontSize: 22,
                    fontFamily: 'Orbitron, Arial',
                    color: this.isAI[i] ? '#ff5555' : '#ffffff'
                })
                .setOrigin(0.5)
                .setInteractive({
                    useHandCursor: true
                })
                .on('pointerdown', () => {
                    this.isAI[i] = !this.isAI[i];
                    this.refreshScene();
                });

            // AI difficulty
            if (this.isAI[i]) {
                this.add.text(450, y, this.aiDifficulty[i], {
                        fontSize: 20,
                        fontFamily: 'Orbitron, Arial',
                        color: '#ffaa44'
                    })
                    .setOrigin(0.5)
                    .setInteractive({
                        useHandCursor: true
                    })
                    .on('pointerdown', () => {
                        const idx = this.aiDifficultyLevels.findIndex(
                            d => d.name === this.aiDifficulty[i]
                        );
                        this.aiDifficulty[i] =
                            this.aiDifficultyLevels[(idx + 1) % this.aiDifficultyLevels.length].name;
                        this.refreshScene();
                    });
            }

            // Team toggle
            if (this.teamsEnabled) {
                const team = this.playerTeams[i];
                this.add.text(560, y, team.toUpperCase(), {
                        fontSize: 20,
                        fontFamily: 'Orbitron, Arial',
                        color: team === 'blue' ? '#66aaff' : '#ff6666'
                    })
                    .setOrigin(0.5)
                    .setInteractive({
                        useHandCursor: true
                    })
                    .on('pointerdown', () => {
                        this.playerTeams[i] = team === 'blue' ? 'red' : 'blue';
                        this.refreshScene();
                    });
            }
        }

        // ---------------- Rounds ----------------
        this.add.text(600, 450, 'Rounds', {
            fontSize: 26,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        [10, 20, 30, 40, 50].forEach((r, i) => {
            this.add.text(450 + i * 80, 490, `${r}`, {
                    fontSize: 24,
                    fontFamily: 'Orbitron, Arial',
                    color: r === this.selectedRounds ? '#ffff66' : '#ffffff'
                }).setOrigin(0.5).setInteractive()
                .on('pointerdown', () => {
                    this.selectedRounds = r;
                    this.refreshScene();
                });
        });

        // ---------------- Rules ----------------
        this.add.text(600, 550, 'Rules & Scaling', {
            fontSize: 26,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        this.add.text(600, 590, `Teams: ${this.teamsEnabled ? 'ON' : 'OFF'}`, {
                fontSize: 22,
                fontFamily: 'Orbitron, Arial'
            })
            .setOrigin(0.5).setInteractive({
                useHandCursor: true
            })
            .on('pointerdown', () => {
                this.teamsEnabled = !this.teamsEnabled;
                this.refreshScene();
            });

        const mult = this.costMultipliers[this.costMultIndex];
        this.add.text(600, 630, `Upgrade Cost Multiplier: x${mult}`, {
                fontSize: 22,
                fontFamily: 'Orbitron, Arial'
            })
            .setOrigin(0.5).setInteractive({
                useHandCursor: true
            })
            .on('pointerdown', () => {
                this.costMultIndex = (this.costMultIndex + 1) % this.costMultipliers.length;
                this.refreshScene();
            });

        // ---------------- Start ----------------
        this.add.text(600, 720, 'START GAME', {
                fontSize: 32,
                fontFamily: 'Orbitron, Arial',
                color: '#66ff66'
            })
            .setOrigin(0.5).setInteractive({
                useHandCursor: true
            })
            .on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.scene.start('LocalGameScene', {
                    players: this.selectedPlayers,
                    rounds: this.selectedRounds,
                    names: this.playerNames.slice(0, this.selectedPlayers),
                    ai: this.isAI.slice(0, this.selectedPlayers),
                    difficulty: this.aiDifficulty.slice(0, this.selectedPlayers),
                    teamsEnabled: this.teamsEnabled,
                    teams: this.playerTeams.slice(0, this.selectedPlayers),
                    costMult: this.costMultipliers[this.costMultIndex]
                });
            });

        // Back
        this.add.text(80, 800, '← Back', {
                fontSize: 24,
                fontFamily: 'Orbitron, Arial',
                color: '#ff6666'
            })
            .setOrigin(0.5).setInteractive({
                useHandCursor: true
            })
            .on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.scene.start('PlayModeScene');
            });

        this.input.keyboard.on('keydown-ESC', () => {
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });
    }

    normalizeState() {
      const p = this.selectedPlayers;
      this.playerNames = this.playerNames || [];
      this.isAI = this.isAI || [];
      this.aiDifficulty = this.aiDifficulty || [];
      this.playerTeams = this.playerTeams || [];

      for (let i = 0; i < p; i++) {
        if (this.playerNames[i] == null) {
          this.playerNames[i] = `Player ${i + 1}`;
        }
        if (this.isAI[i] == null) {
          this.isAI[i] = (i !== 0);
        }
        if (this.aiDifficulty[i] == null) {
          this.aiDifficulty[i] = 'Medium';
        }
        if (this.playerTeams[i] == null) {
          this.playerTeams[i] = (i % 2 === 0) ? 'blue' : 'red';
        }
      }

      this.playerNames.length = p;
      this.isAI.length = p;
      this.aiDifficulty.length = p;
      this.playerTeams.length = p;

      if (this.isAI.every(v => v === true)) {
        this.isAI[0] = false;
      }

      if (this.teamsEnabled) {
        const blue = this.playerTeams.filter(t => t === 'blue').length;
        const red = this.playerTeams.filter(t => t === 'red').length;

        if (blue === p || red === p) {
          for (let i = 0; i < p; i++) {
            this.playerTeams[i] = (i % 2 === 0) ? 'blue' : 'red';
          }
        }
      }
    }

    refreshScene() {
        this.normalizeState();
        this.scene.restart();
    }
}