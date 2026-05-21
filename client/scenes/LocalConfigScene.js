import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalErrors from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';
import BigUpgradeCustomizer from '../utils/BigUpgradeCustomizer.js';
import { formatCompact } from '../utils/FormatManager.js';

export default class LocalConfigScene extends Phaser.Scene {
    constructor() {
        super('LocalConfigScene');

        this.selectedPlayers = 2;
        this.selectedRounds = 30;
        this.teamsEnabled = false;
        this.bigUpgradesEnabled = true;
        this.costMultIndex = 4;
        this.costMultipliers = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5];
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

        [2, 3, 4, 5, 6].forEach((num, i) => {
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

        [10, 20, 30, 40, 50, 75, 100].forEach((r, i) => {
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


    _handleCustomizeEscape() {
        if (this.customizeConfirmModal) {
            GlobalAudio.playButton(this);
            this.closeCustomizeConfirm();
            return true;
        }
        if (this.customizeEditorOpen && this.customizeEditorHandlers?.onCancel) {
            GlobalAudio.playButton(this);
            this.customizeEditorHandlers.onCancel();
            return true;
        }
        if (this.customizeModalOpen) {
            GlobalAudio.playButton(this);
            this.closeBigUpgradesCustomizeModal();
            return true;
        }
        return false;
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

    openBigUpgradesCustomizeModal() {
        if (this.customizeModalOpen) return;
        this.customizeModalOpen = true;

        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        const viewW = this.cameras.main.width;
        const viewH = this.cameras.main.height;

        // Reload customizer to get latest data from localStorage
        this.bigUpgradeCustomizer = new BigUpgradeCustomizer();

        // Overlay
        const overlay = this.add.rectangle(cx, cy, viewW, viewH, 0x000000, 0.85).setOrigin(0.5).setDepth(5000);
        overlay.setInteractive();
        this.customizeModalOverlay = overlay;
        this._setCustomizeDomPointerEvents(false);

        // Modal container
        this.customizeModalContainer = this.add.container(cx, cy).setDepth(5001);

        // Title
        this.customizeModalContainer.add(this.add.text(0, -390, t('CONFIG_CUSTOMIZE_TITLE', 'CUSTOMIZE BIG UPGRADES'), {
            fontSize: 32,
            fontFamily: 'Orbitron, Arial',
            color: '#ffff66'
        }).setOrigin(0.5));

        // Upgrades list (simple list view first)
        const maxBigUpgrades = 100;
        const activeUpgradesRaw = this.bigUpgradeCustomizer.getActiveUpgrades();
        const activeUpgrades = this.bigUpgradeSortAsc
            ? activeUpgradesRaw.slice().sort((a, b) => (a?.baseCost ?? Infinity) - (b?.baseCost ?? Infinity))
            : this.bigUpgradeSortDesc
                ? activeUpgradesRaw.slice().sort((a, b) => (b?.baseCost ?? -Infinity) - (a?.baseCost ?? -Infinity))
                : activeUpgradesRaw;
        const upgradesPerColumn = 12;
        const maxColumns = 5;
        const pageSize = 60;
        const totalPages = Math.max(1, Math.ceil(activeUpgrades.length / pageSize));
        this.bigUpgradeCustomizePage = Math.max(0, Math.min(this.bigUpgradeCustomizePage || 0, totalPages - 1));
        const canGoPrevPage = this.bigUpgradeCustomizePage > 0;
        const canGoNextPage = this.bigUpgradeCustomizePage < totalPages - 1;
        const pageStart = this.bigUpgradeCustomizePage * pageSize;
        const upgradesToShow = activeUpgrades.slice(pageStart, pageStart + pageSize);
        const columns = Math.max(1, Math.min(maxColumns, Math.ceil(upgradesToShow.length / upgradesPerColumn)));
        const maxUsableWidth = Math.max(520, viewW - 160);
        const columnWidth = Math.max(220, Math.min(320, Math.floor(maxUsableWidth / columns)));
        const rowWidth = Math.max(200, columnWidth - 20);
        const totalWidth = columnWidth * columns;
        const columnsStartX = -totalWidth / 2 + columnWidth / 2;
        const listTopY = -300;
        const rowHeight = 50;

        // Close button (X)
        const closeBtn = this.add.text(totalWidth / 2 - 16, -345, 'X', {
            fontSize: 28,
            fontFamily: 'Orbitron, Arial',
            color: '#ff6666'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.closeBigUpgradesCustomizeModal());
        this.customizeModalContainer.add(closeBtn);
        const counterText = this.add.text(0, -360, `Big Upgrades: ${activeUpgradesRaw.length}/${maxBigUpgrades}  •  Page ${this.bigUpgradeCustomizePage + 1}/${totalPages}`, {
            fontSize: 14,
            fontFamily: 'Orbitron, Arial',
            color: '#cccccc'
        }).setOrigin(0.5);
        this.customizeModalContainer.add(counterText);

        upgradesToShow.forEach((upgrade, index) => {
            const col = Math.floor(index / upgradesPerColumn);
            const row = index % upgradesPerColumn;
            const colX = columnsStartX + col * columnWidth;
            const rowY = listTopY + row * rowHeight;
            const isDefault = upgrade.key.startsWith('delete') === false && 
                            BigUpgradeCustomizer.DEFAULT_UPGRADES.some(d => d.key === upgrade.key);

            const rowBg = this.add.rectangle(colX, rowY, rowWidth, 40, 0x1a1a1a, 0.9);
            rowBg.setStrokeStyle(1, isDefault ? '#666666' : '#ffff66');
            this.customizeModalContainer.add(rowBg);

            const nameText = this.add.text(colX - rowWidth / 2 + 10, rowY - 8, upgrade.title || upgrade.key, {
                fontSize: 16,
                fontFamily: 'Orbitron, Arial',
                color: isDefault ? '#cccccc' : '#ffff66'
            }).setOrigin(0, 0.5);
            this.customizeModalContainer.add(nameText);

            const costText = this.add.text(colX + rowWidth / 2 - 92, rowY - 8, `${formatCompact(upgrade.baseCost || 0)}`, {
                fontSize: 14,
                fontFamily: 'Orbitron, Arial',
                color: '#aaaaaa'
            }).setOrigin(0, 0.5);
            this.customizeModalContainer.add(costText);

            const editBtn = this.add.text(colX + rowWidth / 2 - 36, rowY, '✎', {
                fontSize: 18,
                fontFamily: 'Orbitron, Arial',
                color: '#ffff66'
            }).setOrigin(0.5).setInteractive({ useHandCursor: true })
                .on('pointerdown', () => {
                    this.editBigUpgradeInModal(upgrade);
                });
            this.customizeModalContainer.add(editBtn);

            const deleteBtn = this.add.text(colX + rowWidth / 2 - 12, rowY, '✕', {
                fontSize: 18,
                fontFamily: 'Orbitron, Arial',
                color: '#ff6666'
            }).setOrigin(0.5).setInteractive({ useHandCursor: true })
                .on('pointerdown', () => {
                    if (isDefault) {
                        this.bigUpgradeCustomizer.deleteDefaultUpgrade(upgrade.key);
                    } else {
                        this.bigUpgradeCustomizer.deleteUpgrade(upgrade.key);
                    }
                    this.closeBigUpgradesCustomizeModal();
                    this.openBigUpgradesCustomizeModal();
                });
            this.customizeModalContainer.add(deleteBtn);
        });

        const rowsMax = Math.min(upgradesPerColumn, Math.max(1, upgradesToShow.length || 1));
        const listBottomY = listTopY + (rowsMax - 1) * rowHeight;

        // Add new button
        const addBtn = this.add.text(0, listBottomY + 40, t('CONFIG_ADD_UPGRADE', '+ ADD CUSTOM UPGRADE'), {
            fontSize: 18,
            fontFamily: 'Orbitron, Arial',
            color: '#66ff66',
            backgroundColor: '#222222',
            padding: { x: 10, y: 5 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
            .on('pointerdown', () => {
                if (activeUpgradesRaw.length >= maxBigUpgrades) {
                    GlobalAlerts.show(this, t('CONFIG_MAX_BIG_UPGRADES', 'Maximum of 100 big upgrades reached.'), 'checking');
                    return;
                }
                this.editBigUpgradeInModal(null);
            });
        this.customizeModalContainer.add(addBtn);

        const sortLabel = this.bigUpgradeSortAsc
            ? 'SORT: ASCENDING'
            : this.bigUpgradeSortDesc
                ? 'SORT: DESCENDING'
                : 'SORT: DEFAULT';
        const sortBtn = this.add.text(-200, listBottomY + 80, sortLabel, {
            fontSize: 16,
            fontFamily: 'Orbitron, Arial',
            color: '#ffff66',
            backgroundColor: '#222222',
            padding: { x: 10, y: 5 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
            .on('pointerdown', () => {
                if (!this.bigUpgradeSortAsc && !this.bigUpgradeSortDesc) {
                    this.bigUpgradeSortAsc = true;
                } else if (this.bigUpgradeSortAsc) {
                    this.bigUpgradeSortAsc = false;
                    this.bigUpgradeSortDesc = true;
                } else {
                    this.bigUpgradeSortDesc = false;
                }
                this.closeBigUpgradesCustomizeModal();
                this.openBigUpgradesCustomizeModal();
            });
        this.customizeModalContainer.add(sortBtn);

        const exportBtn = this.add.text(-20, listBottomY + 80, 'EXPORT', {
            fontSize: 16, fontFamily: 'Orbitron, Arial', color: '#66ccff', backgroundColor: '#222222', padding: { x: 10, y: 5 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.exportBigUpgradeSCD());
        this.customizeModalContainer.add(exportBtn);

        const importBtn = this.add.text(100, listBottomY + 80, 'IMPORT', {
            fontSize: 16, fontFamily: 'Orbitron, Arial', color: '#66ff66', backgroundColor: '#222222', padding: { x: 10, y: 5 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.importBigUpgradeSCD());
        this.customizeModalContainer.add(importBtn);
        if (canGoPrevPage) {
            const prevBtn = this.add.text((-totalWidth / 2) - 28, -20, '◀', { fontSize: 26, fontFamily: 'Orbitron, Arial', color: '#ffffff' })
                .setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
                    this.bigUpgradeCustomizePage = Math.max(0, this.bigUpgradeCustomizePage - 1);
                    this._reopenBigUpgradesCustomizeModal();
                });
            this.customizeModalContainer.add(prevBtn);
        }
        if (canGoNextPage) {
            const nextBtn = this.add.text((totalWidth / 2) + 28, -20, '▶', { fontSize: 26, fontFamily: 'Orbitron, Arial', color: '#ffffff' })
                .setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
                    this.bigUpgradeCustomizePage = Math.min(totalPages - 1, this.bigUpgradeCustomizePage + 1);
                    this._reopenBigUpgradesCustomizeModal();
                });
            this.customizeModalContainer.add(nextBtn);
        }

        const restoreBtn = this.add.text(260, listBottomY + 80, t('CONFIG_RESTORE_DEFAULTS', 'RESTORE DEFAULTS'), {
            fontSize: 16,
            fontFamily: 'Orbitron, Arial',
            color: '#ff6666',
            backgroundColor: '#222222',
            padding: { x: 10, y: 5 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
            .on('pointerdown', () => {
                this.showCustomizeConfirm(
                    t('CONFIG_RESTORE_CONFIRM', 'Restore all big upgrades to defaults? This will remove all custom upgrades.'),
                    () => {
                        this.bigUpgradeCustomizer.resetToDefaults();
                        this.bigUpgradeSortAsc = false;
                        this.bigUpgradeSortDesc = false;
                        this.closeBigUpgradesCustomizeModal();
                        this.openBigUpgradesCustomizeModal();
                    }
                );
            });
        this.customizeModalContainer.add(restoreBtn);

        // Done button
        const doneBtn = this.add.text(0, listBottomY + 130, t('UI_DONE', 'DONE'), {
            fontSize: 22,
            fontFamily: 'Orbitron, Arial',
            color: '#66ff66',
            backgroundColor: '#333333',
            padding: { x: 15, y: 8 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
            .on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.closeBigUpgradesCustomizeModal();
            });
        this.customizeModalContainer.add(doneBtn);
        this._installCustomizeHotkeys(
            () => this.closeBigUpgradesCustomizeModal(),
            canGoPrevPage ? (() => {
                this.bigUpgradeCustomizePage = Math.max(0, this.bigUpgradeCustomizePage - 1);
                this._reopenBigUpgradesCustomizeModal();
            }) : null,
            canGoNextPage ? (() => {
                this.bigUpgradeCustomizePage = Math.min(totalPages - 1, this.bigUpgradeCustomizePage + 1);
                this._reopenBigUpgradesCustomizeModal();
            }) : null
        );
    }

    closeBigUpgradesCustomizeModal() {
        this.customizeModalOpen = false;
        this.closeCustomizeConfirm();
        if (this.customizeModalContainer) {
            this.customizeModalContainer.destroy(true);
            this.customizeModalContainer = null;
        }
        if (Array.isArray(this.customizeModalDom)) {
            this.customizeModalDom.forEach(dom => {
                try { dom.destroy(); } catch (e) {}
            });
            this.customizeModalDom = null;
        }
        if (this.customizeModalOverlay) {
            try { this.customizeModalOverlay.destroy(); } catch (e) {}
            this.customizeModalOverlay = null;
        }
        this.customizeEditorOpen = false;
        this.customizeEditorHandlers = null;
        this._setCustomizeDomPointerEvents(false);
        this._removeCustomizeHotkeys();
    }

    _reopenBigUpgradesCustomizeModal() {
        const keepPage = this.bigUpgradeCustomizePage || 0;
        this.closeBigUpgradesCustomizeModal();
        this.bigUpgradeCustomizePage = keepPage;
        this.openBigUpgradesCustomizeModal();
    }

    _installCustomizeHotkeys(onEsc, onLeft, onRight, onEnter) {
        this._removeCustomizeHotkeys();
        this.customizeKeyHandlers = {
            esc: (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    if (this._handleCustomizeEscape()) return;
                    onEsc?.();
                }
            },
            page: (event) => {
                if (this.customizeConfirmModal) return;
                if (event.key === 'Enter' && onEnter) {
                    event.preventDefault();
                    onEnter();
                    return;
                }
                if (event.key === 'ArrowLeft' && onLeft) {
                    event.preventDefault();
                    onLeft();
                }
                if (event.key === 'ArrowRight' && onRight) {
                    event.preventDefault();
                    onRight();
                }
            }
        };
        window.addEventListener('keydown', this.customizeKeyHandlers.esc);
        window.addEventListener('keydown', this.customizeKeyHandlers.page);
    }

    _removeCustomizeHotkeys() {
        if (this.customizeKeyHandlers?.esc) {
            window.removeEventListener('keydown', this.customizeKeyHandlers.esc);
        }
        if (this.customizeKeyHandlers?.page) {
            window.removeEventListener('keydown', this.customizeKeyHandlers.page);
        }
        this.customizeKeyHandlers = null;
    }

    exportBigUpgradeSCD() {
        const payload = this.bigUpgradeCustomizer.exportToSCD();
        const blob = new Blob([payload], { type: 'application/x-scaledice' });
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = 'big-upgrades.scd';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(href);
        GlobalAlerts.show(this, 'Exported big upgrades as SCD.', 'checking');
    }

    importBigUpgradeSCD() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.scd';
        input.onchange = async (evt) => {
            const file = evt?.target?.files?.[0];
            if (!file) return;
            const text = await file.text();
            this.showCustomizeConfirm(
                'Import stored big upgrades to your customiser? This will REPLACE your current lineup!',
                () => {
                    try {
                        this.bigUpgradeCustomizer.importFromSCD(text);
                        this.closeBigUpgradesCustomizeModal();
                        this.openBigUpgradesCustomizeModal();
                        GlobalAlerts.show(this, 'Imported big upgrades from SCD.', 'checking');
                    } catch (e) {
                        GlobalAlerts.show(this, 'Invalid SCD file.', 'warning');
                    }
                }
            );
        };
        input.click();
    }

    showCustomizeConfirm(message, onConfirm) {
        if (this.customizeConfirmModal) {
            this.closeCustomizeConfirm();
        }

        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        const viewW = this.cameras.main.width;
        const viewH = this.cameras.main.height;

        const width = 560;
        const height = 220;

        const overlay = this.add.rectangle(cx, cy, viewW, viewH, 0x000000, 0.6).setDepth(6000).setInteractive();
        const panel = this.add.rectangle(cx, cy, width, height, 0x1e1e1e).setStrokeStyle(2, 0xffff66).setDepth(6001);
        const title = this.add.text(cx, cy - height / 2 + 26, t('UI_CONFIRM', 'CONFIRM'), {
            fontSize: 24,
            fontFamily: 'Orbitron, Arial',
            color: '#ffff66'
        }).setOrigin(0.5).setDepth(6002);
        const body = this.add.text(cx, cy, message, {
            fontSize: 18,
            fontFamily: 'Orbitron, Arial',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: width - 48 }
        }).setOrigin(0.5).setDepth(6002);

        const yesBtn = this.add.text(cx - 90, cy + height / 2 - 40, t('UI_YES', 'YES'), {
            fontSize: 20,
            fontFamily: 'Orbitron, Arial',
            color: '#66ff66'
        }).setOrigin(0.5).setDepth(6002).setInteractive({ useHandCursor: true });
        const noBtn = this.add.text(cx + 90, cy + height / 2 - 40, t('UI_NO', 'NO'), {
            fontSize: 20,
            fontFamily: 'Orbitron, Arial',
            color: '#ff6666'
        }).setOrigin(0.5).setDepth(6002).setInteractive({ useHandCursor: true });

        yesBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.closeCustomizeConfirm();
            if (typeof onConfirm === 'function') {
                onConfirm();
            }
        });
        noBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.closeCustomizeConfirm();
        });

        this.customizeConfirmModal = { overlay, panel, title, body, yesBtn, noBtn };
        this._setCustomizeDomPointerEvents(false);
    }

    closeCustomizeConfirm() {
        if (!this.customizeConfirmModal) return;
        const { overlay, panel, title, body, yesBtn, noBtn } = this.customizeConfirmModal;
        try { overlay?.destroy?.(); } catch (e) {}
        try { panel?.destroy?.(); } catch (e) {}
        try { title?.destroy?.(); } catch (e) {}
        try { body?.destroy?.(); } catch (e) {}
        try { yesBtn?.destroy?.(); } catch (e) {}
        try { noBtn?.destroy?.(); } catch (e) {}
        this.customizeConfirmModal = null;
        const hasDom = Array.isArray(this.customizeModalDom) && this.customizeModalDom.length > 0;
        this._setCustomizeDomPointerEvents(hasDom);
    }

    _setCustomizeDomPointerEvents(enabled) {
        try {
            const domContainer = this.game?.domContainer;
            if (domContainer) {
                domContainer.style.pointerEvents = enabled ? 'auto' : 'none';
            }
        } catch (e) {}
    }

    _syncDomContainerToCanvas() {
        try {
            const domContainer = this.game?.domContainer;
            const canvas = this.game?.canvas;
            const parent = canvas?.parentElement;
            if (!domContainer || !canvas || !parent) return;
            const canvasRect = canvas.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            const left = canvasRect.left - parentRect.left;
            const top = canvasRect.top - parentRect.top;
            domContainer.style.left = `${left}px`;
            domContainer.style.top = `${top}px`;
            domContainer.style.width = `${canvasRect.width}px`;
            domContainer.style.height = `${canvasRect.height}px`;
        } catch (e) {}
    }

    editBigUpgradeInModal(upgrade) {
        // Close current modal
        this.customizeModalOpen = false;
        if (this.customizeModalContainer) {
            this.customizeModalContainer.destroy(true);
            this.customizeModalContainer = null;
        }
        if (Array.isArray(this.customizeModalDom)) {
            this.customizeModalDom.forEach(dom => {
                try { dom.destroy(); } catch (e) {}
            });
            this.customizeModalDom = null;
        }
        if (this.customizeModalOverlay) {
            try { this.customizeModalOverlay.destroy(); } catch (e) {}
            this.customizeModalOverlay = null;
        }

        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        const viewW = this.cameras.main.width;
        const viewH = this.cameras.main.height;
        const maxBigUpgrades = 100;
        const isDefault = upgrade && BigUpgradeCustomizer.DEFAULT_UPGRADES.some(d => d.key === upgrade.key);
        const defaultDef = isDefault ? BigUpgradeCustomizer.DEFAULT_UPGRADES.find(d => d.key === upgrade.key) : null;
        const baseUpgrade = (isDefault && defaultDef) ? { ...defaultDef, ...upgrade } : (upgrade || {});

        // Extract current values from upgrade object BEFORE creating DOM
        const currentTitle = baseUpgrade?.title || '';
        const currentCost = (baseUpgrade?.baseCost ?? 100);
        const currentEffect = baseUpgrade?.effect || 'rollMultiplier';
        const currentValue = (baseUpgrade?.value ?? 0);
        const currentValues = baseUpgrade?.values || {};

        // Edit form overlay
        this._syncDomContainerToCanvas();
        const overlay = this.add.rectangle(cx, cy, viewW, viewH, 0x000000, 0.85).setOrigin(0.5).setDepth(5000);
        overlay.setInteractive();
        this.customizeModalOverlay = overlay;
        this._setCustomizeDomPointerEvents(true);

        this.customizeModalContainer = this.add.container(cx, cy).setDepth(5001);
        this.customizeModalOpen = true;
        this.customizeEditorOpen = true;

        const effectLabelByKey = {
            rollMultiplier: t('CONFIG_EFFECT_ROLL_MULT', 'Roll Multiplier'),
            comboMultiplier: t('CONFIG_EFFECT_COMBO_MULT', 'Combo Multiplier'),
            ecoMultiplier: t('CONFIG_EFFECT_ECO_MULT', 'Eco Multiplier'),
            economyCap: t('CONFIG_EFFECT_ECO_CAP', 'Economy Cap'),
            ecoRoundMultiplier: t('CONFIG_EFFECT_ECO_ROUND', 'Eco Round Multiplier'),
            predictChance: t('CONFIG_EFFECT_PREDICT', 'Predict Chance'),
            comboCostMultiplier: t('CONFIG_EFFECT_COMBO_COST', 'Combo Cost Multiplier'),
            interestRate: t('CONFIG_EFFECT_INTEREST', 'Interest Rate'),
            comboStreak: t('CONFIG_EFFECT_COMBO_STREAK', 'Combo Streak'),
            spinEffect: t('CONFIG_EFFECT_SPIN', 'Spin Effect')
        };
        const getEffectLabel = (key, fallback) => effectLabelByKey[key] || fallback || key;

        // Title
        const titleText = upgrade
            ? fmt('CONFIG_EDIT_UPGRADE_TITLE', 'EDIT UPGRADE - {0}', currentTitle)
            : t('CONFIG_CREATE_UPGRADE_TITLE', 'CREATE UPGRADE');
        this.customizeModalContainer.add(this.add.text(0, -360, titleText, {
            fontSize: 28,
            fontFamily: 'Orbitron, Arial',
            color: '#ffff66'
        }).setOrigin(0.5));

        // Show default effect info if editing a default
        if (isDefault && defaultDef) {
            const effectType = BigUpgradeCustomizer.EFFECT_TYPES.find(e => e.key === defaultDef.effect);
            const defaultEffectName = getEffectLabel(effectType?.key || defaultDef.effect, effectType?.name || defaultDef.effect);
            const defaultEffectText = fmt('CONFIG_DEFAULT_EFFECT', 'Default: {0}', defaultEffectName);
            this.customizeModalContainer.add(this.add.text(0, -320, defaultEffectText, {
                fontSize: 12,
                fontFamily: 'Orbitron, Arial',
                color: '#888888',
                fontStyle: 'italic'
            }).setOrigin(0.5));
        }

        // Form container with background
        const formBg = this.add.rectangle(0, 0, 720, 440, 0x0a0a0a, 0.8);
        formBg.setStrokeStyle(1, 0x444444);
        this.customizeModalContainer.add(formBg);

        // Form fields (DOM)
        const domElements = [];
        this.customizeModalDom = domElements;

        const rowStyle = 'display:flex; align-items:center; gap:12px;';
        const labelStyle = 'width:130px; text-align:left;';
        const inputStyle = 'flex:1; padding:6px 8px; font-family: monospace; background:#1a1a1a; color:#ffff66; border:1px solid #555555; border-radius:2px;';
        const smallInputStyle = 'flex:1; padding:4px 6px; font-family: monospace; background:#1a1a1a; color:#ffff66; border:1px solid #555555; border-radius:2px; font-size:12px;';
        const formWidth = 720;
        const formHeight = 440;
        const labelName = t('CONFIG_UPGRADE_NAME', 'Name:');
        const labelCost = t('CONFIG_UPGRADE_COST', 'Base Cost:');
        const labelEffect = t('CONFIG_UPGRADE_EFFECT', 'Effect:');
        const labelValue = t('CONFIG_UPGRADE_VALUE', 'Value:');
        const labelCapDelta = t('CONFIG_UPGRADE_CAP_DELTA', 'Cap Delta:');
        const labelChance = t('CONFIG_UPGRADE_CHANCE', 'Chance:');
        const labelMinSec = t('CONFIG_UPGRADE_MIN_SEC', 'Min Sec:');
        const labelMaxSec = t('CONFIG_UPGRADE_MAX_SEC', 'Max Sec:');
        const labelPerStreak = t('CONFIG_UPGRADE_PER_STREAK', 'Per Streak %:');
        const labelMultiplicative = t('CONFIG_UPGRADE_MULTIPLICATIVE', 'Multiplicative:');
        const labelSave = t('CONFIG_UPGRADE_SAVE', 'SAVE');
        const labelCancel = t('CONFIG_UPGRADE_CANCEL', 'CANCEL');
        const effectOptionsHtml = BigUpgradeCustomizer.EFFECT_TYPES.map(e => `<option value="${e.key}">${getEffectLabel(e.key, e.name)}</option>`).join('');
        const formHtml = `
            <div style="width:${formWidth}px; height:${formHeight}px; display:flex; justify-content:center; align-items:center; font-family: Orbitron, Arial; color:#cccccc; pointer-events:auto;">
                <div style="width:520px; display:flex; flex-direction:column; gap:12px;">
                    <div style="${rowStyle}">
                        <div style="${labelStyle}">${labelName}</div>
                        <input id="bu-name" type="text" style="${inputStyle}">
                    </div>
                    <div style="${rowStyle}">
                        <div style="${labelStyle}">${labelCost}</div>
                        <input id="bu-cost" type="number" min="10" style="${inputStyle}">
                    </div>
                    <div style="${rowStyle}">
                        <div style="${labelStyle}">${labelEffect}</div>
                        <select id="bu-effect" style="${inputStyle}">${effectOptionsHtml}</select>
                    </div>
                    <div id="bu-values" style="display:flex; flex-direction:column; gap:8px;"></div>
                    <div style="display:flex; justify-content:center; gap:24px; margin-top:6px;">
                        <button id="bu-save" style="padding:6px 14px; font-family: Orbitron, Arial; background:#223322; color:#66ff66; border:1px solid #335533; border-radius:2px; cursor:pointer;">${labelSave}</button>
                        <button id="bu-cancel" style="padding:6px 14px; font-family: Orbitron, Arial; background:#332222; color:#ff6666; border:1px solid #553333; border-radius:2px; cursor:pointer;">${labelCancel}</button>
                    </div>
                </div>
            </div>
        `;

        const formDom = this.add.dom(cx, cy).createFromHTML(formHtml).setDepth(5002);
        if (!formDom || !formDom.node) {
            console.warn('[BigUpgradeCustomizer] Failed to create edit DOM node.');
            this.closeBigUpgradesCustomizeModal();
            return;
        }
        formDom.node.style.pointerEvents = 'auto';
        formDom.node.style.display = 'block';
        formDom.node.style.width = `${formWidth}px`;
        formDom.node.style.height = `${formHeight}px`;
        if (formDom.updateSize) {
            formDom.updateSize();
        }
        formDom.setOrigin(0.5);
        formDom.setPosition(cx, cy);
        domElements.push(formDom);

        const nameInput = formDom.node.querySelector('#bu-name');
        const costInput = formDom.node.querySelector('#bu-cost');
        const effectSelect = formDom.node.querySelector('#bu-effect');
        const valuesWrap = formDom.node.querySelector('#bu-values');

        if (nameInput) nameInput.value = currentTitle;
        if (costInput) costInput.value = currentCost;
        if (effectSelect) effectSelect.value = currentEffect;

        const renderValueInputs = () => {
            if (!valuesWrap) return;
            const effectKey = effectSelect?.value || currentEffect;
            const useCurrent = effectKey === currentEffect;

            if (effectKey === 'spinEffect') {
                valuesWrap.innerHTML = `
                    <div style="${rowStyle} font-size:12px;">
                        <div style="${labelStyle}">${labelChance}</div>
                        <input id="bu-chance" type="number" min="0" max="1" step="0.01" style="${smallInputStyle}">
                    </div>
                    <div style="${rowStyle} font-size:12px;">
                        <div style="${labelStyle}">${labelMinSec}</div>
                        <input id="bu-minsec" type="number" min="0.1" step="0.1" style="${smallInputStyle}">
                    </div>
                    <div style="${rowStyle} font-size:12px;">
                        <div style="${labelStyle}">${labelMaxSec}</div>
                        <input id="bu-maxsec" type="number" min="0.1" step="0.1" style="${smallInputStyle}">
                    </div>
                `;
                const chanceInput = valuesWrap.querySelector('#bu-chance');
                const minSecInput = valuesWrap.querySelector('#bu-minsec');
                const maxSecInput = valuesWrap.querySelector('#bu-maxsec');
                if (chanceInput) chanceInput.value = useCurrent && currentValues.chance !== undefined ? currentValues.chance : 0.25;
                if (minSecInput) minSecInput.value = useCurrent && currentValues.minSec !== undefined ? currentValues.minSec : 2;
                if (maxSecInput) maxSecInput.value = useCurrent && currentValues.maxSec !== undefined ? currentValues.maxSec : 10;
            } else if (effectKey === 'comboStreak') {
                valuesWrap.innerHTML = `
                    <div style="${rowStyle} font-size:12px;">
                        <div style="${labelStyle}">${labelPerStreak}</div>
                        <input id="bu-percentage" type="number" min="0" max="1" step="0.01" style="${smallInputStyle}">
                    </div>
                    <div style="${rowStyle} font-size:12px;">
                        <div style="${labelStyle}">${labelMultiplicative}</div>
                        <input id="bu-multiplicative" type="checkbox" style="transform: scale(1.1);">
                    </div>
                `;
                const percentageInput = valuesWrap.querySelector('#bu-percentage');
                const multiplicativeCheckbox = valuesWrap.querySelector('#bu-multiplicative');
                if (percentageInput) percentageInput.value = useCurrent && currentValues.percentage !== undefined ? currentValues.percentage : 0.2;
                if (multiplicativeCheckbox) multiplicativeCheckbox.checked = useCurrent ? (currentValues.isMultiplicative || false) : false;
            } else if (effectKey === 'economyCap') {
                valuesWrap.innerHTML = `
                    <div style="${rowStyle} font-size:12px;">
                        <div style="${labelStyle}">${labelCapDelta}</div>
                        <input id="bu-value" type="number" step="1" style="${smallInputStyle}">
                    </div>
                `;
                const valueInput = valuesWrap.querySelector('#bu-value');
                if (valueInput) valueInput.value = useCurrent ? currentValue : 0;
            } else {
                valuesWrap.innerHTML = `
                    <div style="${rowStyle} font-size:12px;">
                        <div style="${labelStyle}">${labelValue}</div>
                        <input id="bu-value" type="number" min="0" step="0.01" style="${smallInputStyle}">
                    </div>
                `;
                const valueInput = valuesWrap.querySelector('#bu-value');
                if (valueInput) valueInput.value = useCurrent ? currentValue : 0;
            }
        };

        renderValueInputs();
        if (effectSelect) {
            effectSelect.addEventListener('change', () => renderValueInputs());
        }

        const onSave = () => {
            const nameVal = (nameInput?.value || '').trim();
            if (!nameVal) {
                GlobalAlerts.show(this, t('CONFIG_UPGRADE_NAME_REQUIRED', 'Please enter a name for the upgrade.'), 'warning');
                return;
            }
            const isNew = !(upgrade && upgrade.key);
            if (isNew && this.bigUpgradeCustomizer.getActiveUpgrades().length >= maxBigUpgrades) {
                GlobalAlerts.show(this, t('CONFIG_MAX_BIG_UPGRADES', 'Maximum of 100 big upgrades reached.'), 'checking');
                return;
            }
            const costVal = Number(costInput?.value) || 100;
            const effectVal = effectSelect?.value || 'rollMultiplier';

            const newUpgrade = {
                key: upgrade?.key || `custom_${Date.now()}`,
                title: nameVal,
                baseCost: costVal,
                effect: effectVal
            };

            const invalidNumber = (val, allowNegative = false) => !Number.isFinite(val) || (!allowNegative && val < 0);

            // Set values based on effect type
            if (effectVal === 'spinEffect') {
                const chanceInput = valuesWrap?.querySelector?.('#bu-chance');
                const minSecInput = valuesWrap?.querySelector?.('#bu-minsec');
                const maxSecInput = valuesWrap?.querySelector?.('#bu-maxsec');
                const chanceVal = Number(chanceInput?.value);
                const minSecVal = Number(minSecInput?.value);
                const maxSecVal = Number(maxSecInput?.value);
                if (invalidNumber(chanceVal) || invalidNumber(minSecVal) || invalidNumber(maxSecVal)) {
                    GlobalAlerts.show(this, t('CONFIG_EFFECT_VALUE_MIN', 'Effect values must be 0 or higher.'), 'warning');
                    return;
                }
                newUpgrade.values = {
                    chance: chanceVal,
                    minSec: minSecVal,
                    maxSec: maxSecVal
                };
            } else if (effectVal === 'comboStreak') {
                const percentageInput = valuesWrap?.querySelector?.('#bu-percentage');
                const multiplicativeCheckbox = valuesWrap?.querySelector?.('#bu-multiplicative');
                const percentageVal = Number(percentageInput?.value);
                if (invalidNumber(percentageVal)) {
                    GlobalAlerts.show(this, t('CONFIG_EFFECT_VALUE_MIN', 'Effect values must be 0 or higher.'), 'warning');
                    return;
                }
                newUpgrade.values = {
                    percentage: percentageVal,
                    isMultiplicative: multiplicativeCheckbox?.checked || false
                };
            } else if (effectVal === 'economyCap') {
                const valueInput = valuesWrap?.querySelector?.('#bu-value');
                const valueVal = Number(valueInput?.value);
                if (invalidNumber(valueVal, true)) {
                    GlobalAlerts.show(this, t('CONFIG_EFFECT_VALUE_INVALID', 'Effect value is invalid.'), 'warning');
                    return;
                }
                newUpgrade.value = valueVal;
            } else {
                const valueInput = valuesWrap?.querySelector?.('#bu-value');
                const valueVal = Number(valueInput?.value);
                if (invalidNumber(valueVal)) {
                    GlobalAlerts.show(this, t('CONFIG_EFFECT_VALUE_MIN', 'Effect values must be 0 or higher.'), 'warning');
                    return;
                }
                newUpgrade.value = valueVal;
            }

            this.bigUpgradeCustomizer.saveUpgrade(newUpgrade);
            GlobalAudio.playButton(this);
            this.closeBigUpgradesCustomizeModal();
            this.openBigUpgradesCustomizeModal();
        };

        const onCancel = () => {
            GlobalAudio.playButton(this);
            this.closeBigUpgradesCustomizeModal();
            this.openBigUpgradesCustomizeModal();
        };

        const saveBtn = formDom.node.querySelector('#bu-save');
        const cancelBtn = formDom.node.querySelector('#bu-cancel');
        saveBtn?.addEventListener('click', onSave);
        cancelBtn?.addEventListener('click', onCancel);
        const onKeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                onSave();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
            }
        };
        formDom.node.addEventListener('keydown', onKeydown);
        this.customizeEditorHandlers = { onSave, onCancel };
        this._installCustomizeHotkeys(onCancel, null, null, onSave);
    }

    refreshScene() {
        this.normalizeState();
        this.scene.restart();
    }
}
