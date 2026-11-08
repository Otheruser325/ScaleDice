import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalErrors from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';
import BigUpgradeCustomizer from '../utils/BigUpgradeCustomizer.js';
import BigUpgradeCustomizerUIMixin from '../utils/BigUpgradeCustomizerUI.js';
import { formatCompact } from '../utils/FormatManager.js';
import { COST_MULTIPLIERS, DEFAULT_GAME_SETUP, PLAYER_COUNTS, ROUND_OPTIONS } from '../config/gameSetup.js';

export default class LocalConfigScene extends Phaser.Scene {
    constructor() {
        super('LocalConfigScene');

        this.selectedPlayers = DEFAULT_GAME_SETUP.players;
        this.selectedRounds = DEFAULT_GAME_SETUP.rounds;
        this.teamsEnabled = DEFAULT_GAME_SETUP.teams;
        this.bigUpgradesEnabled = DEFAULT_GAME_SETUP.bigUpgradesEnabled;
        this.costMultIndex = COST_MULTIPLIERS.indexOf(DEFAULT_GAME_SETUP.costMultiplier);
        this.costMultipliers = [...COST_MULTIPLIERS];
        this.playerTeams = ['blue', 'red', 'blue', 'red', 'blue', 'red'];
        this.playerNames = ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"];
        this.isAI = [false, false, false, false, false, false];
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

        this.bigUpgradeCustomizer = new BigUpgradeCustomizer();
        this.customizeModalOpen = false;
        this.customizeModalContainer = null;
        this.bigUpgradeSortAsc = false;
        this.bigUpgradeSortDesc = false;
        this.customizeConfirmModal = null;
        this.customizeModalOverlay = null;
        this.customizeOverlays = [];
        this.customizeEditorOpen = false;
        this.customizeEditorHandlers = null;
        this.customizeKeyHandlers = null;
        this.bigUpgradeCustomizePage = 0;
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
        
        this.add.text(600, 50, t('LOCAL_SETUP_TITLE', 'LOCAL GAME - SETUP'), {
            fontSize: 40,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        // ---------------- Players ----------------
        this.add.text(600, 110, t('CONFIG_PLAYERS_UPPER', 'PLAYERS'), {
            fontSize: 28,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        PLAYER_COUNTS.forEach((num, i) => {
            this.add.text(440 + i * 80, 150, String(num), {
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
            const y = 200 + i * 50;

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
                    const promptText = GlobalLocalization.format('CONFIG_PROMPT_PLAYER_NAME', 'Name for Player {0}', i + 1);
                    const n = prompt(promptText, this.playerNames[i]);
                    if (n) {
                        this.playerNames[i] = n.substring(0, 12);
                        this.refreshScene();
                    }
                });

            // AI toggle
            this.add.text(310, y, this.isAI[i] ? t('CONFIG_AI', 'COMPUTER') : t('CONFIG_HUMAN', 'HUMAN'), {
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
                const diffX = this.teamsEnabled ? 550 : 450;
                this.add.text(diffX, y, this.aiDifficulty[i], {
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
                this.add.text(450, y, team.toUpperCase(), {
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
        this.add.text(600, 450, t('CONFIG_ROUNDS', 'ROUNDS'), {
            fontSize: 26,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        ROUND_OPTIONS.forEach((r, i) => {
            this.add.text(370 + i * 80, 490, `${r}`, {
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
        this.add.text(600, 550, t('CONFIG_RULES_SCALING', 'RULES & SCALING'), {
            fontSize: 26,
            fontFamily: 'Orbitron, Arial'
        }).setOrigin(0.5);

        this.add.text(600, 590, GlobalLocalization.format('CONFIG_TEAMS', 'TEAMS: {0}', this.teamsEnabled ? t('SET_ON', 'ON') : t('SET_OFF', 'OFF')), {
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

        this.add.text(600, 630, GlobalLocalization.format('CONFIG_BIG_UPGRADES', 'BIG UPGRADES: {0}', this.bigUpgradesEnabled ? t('SET_ON', 'ON') : t('SET_OFF', 'OFF')), {
                fontSize: 22,
                fontFamily: 'Orbitron, Arial'
            })
            .setOrigin(0.5).setInteractive({
                useHandCursor: true
            })
            .on('pointerdown', () => {
                this.bigUpgradesEnabled = !this.bigUpgradesEnabled;
                this.refreshScene();
            });

        if (this.bigUpgradesEnabled) {
            this.add.text(760, 630, t('CONFIG_CUSTOMIZE', 'CUSTOMIZE'), {
                    fontSize: 18,
                    fontFamily: 'Orbitron, Arial',
                    color: '#ffff66',
                    backgroundColor: '#333333',
                    padding: { x: 10, y: 5 }
                })
                .setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
                .on('pointerdown', () => {
                    GlobalAudio.playButton(this);
                    this.openBigUpgradesCustomizeModal();
                });
        }

        const mult = this.costMultipliers[this.costMultIndex];
        this.add.text(600, 670, GlobalLocalization.format('CONFIG_COST_MULTIPLIER', 'UPGRADE COST MULTIPLIER: x{0}', mult), {
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
        this.add.text(600, 750, t('CONFIG_START_GAME', 'START GAME'), {
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
                    bigUpgradesEnabled: this.bigUpgradesEnabled,
                    customBigUpgrades: this.bigUpgradeCustomizer.getActiveUpgrades(),
                    bigUpgradeSortAsc: this.bigUpgradeSortAsc,
                    bigUpgradeSortDesc: this.bigUpgradeSortDesc,
                    costMult: this.costMultipliers[this.costMultIndex]
                });
            });

        // Back
        this.add.text(80, 800, t('UI_BACK', '<- BACK'), {
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
            if (this._handleCustomizeEscape()) return;
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });

        this._syncDomContainerToCanvas();
        this.scale.on('resize', this._syncDomContainerToCanvas, this);
        this.events.once('shutdown', () => {
            try { this.scale.off('resize', this._syncDomContainerToCanvas, this); } catch (e) {}
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

Object.assign(LocalConfigScene.prototype, BigUpgradeCustomizerUIMixin);
