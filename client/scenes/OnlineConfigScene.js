import { getSocket, waitForConnection } from '../utils/SocketManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import BigUpgradeCustomizer from '../utils/BigUpgradeCustomizer.js';
import BigUpgradeCustomizerUIMixin from '../utils/BigUpgradeCustomizerUI.js';
import { COST_MULTIPLIERS, DEFAULT_GAME_SETUP, PLAYER_COUNTS, ROUND_OPTIONS } from '../config/gameSetup.js';

export default class OnlineConfigScene extends Phaser.Scene {
  constructor() {
    super('OnlineConfigScene');
    this.selectedPlayers = DEFAULT_GAME_SETUP.players;
    this.selectedRounds = DEFAULT_GAME_SETUP.rounds;
    this.teamsEnabled = DEFAULT_GAME_SETUP.teams;
    this.selectedTurnTimer = 30;
    this.bigUpgradesEnabled = DEFAULT_GAME_SETUP.bigUpgradesEnabled;
    this.costMultiplier = DEFAULT_GAME_SETUP.costMultiplier;
    this.bigUpgradeCustomizer = new BigUpgradeCustomizer();
    this.customizeModalOpen = false;
    this.customizeModalContainer = null;
    this.customizeModalDom = null;
    this.bigUpgradeSortAsc = false;
    this.bigUpgradeSortDesc = false;
    this.customizeConfirmModal = null;
    this.customizeModalOverlay = null;
    this.customizeOverlays = [];
    this.customizeEditorOpen = false;
    this.customizeEditorHandlers = null;
    this.customizeKeyHandlers = null;
    this.bigUpgradeCustomizePage = 0;
    this.lineupSummaryText = null;
    this._handlers = null;
    this._timeout = null;
  }

  init(data) {
    if (data?.players) this.selectedPlayers = data.players;
    if (data?.rounds) this.selectedRounds = data.rounds;
    if (typeof data?.teams === 'boolean') this.teamsEnabled = data.teams;
    if (data?.timeLimitSeconds) this.selectedTurnTimer = data.timeLimitSeconds;
    if (typeof data?.bigUpgradesEnabled === 'boolean') this.bigUpgradesEnabled = data.bigUpgradesEnabled;
    if (Number.isFinite(Number(data?.costMultiplier))) this.costMultiplier = Number(data.costMultiplier);
  }

  create() {
    try {
      GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
    } catch (err) { /* keep the setup usable if background setup fails */ }

    // Pick up any changes made in the local setup customizer.
    this.bigUpgradeCustomizer = new BigUpgradeCustomizer();

    this.add.text(600, 50, 'ONLINE GAME - SETUP', {
      fontSize: 40,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);

    this.add.text(600, 120, 'PLAYERS', {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);

    PLAYER_COUNTS.forEach((count, index) => {
      this.add.text(440 + index * 80, 165, String(count), {
        fontSize: 26,
        fontFamily: 'Orbitron, Arial',
        color: count === this.selectedPlayers ? '#ffff66' : '#ffffff'
      }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.selectedPlayers = count;
        this.refreshScene();
      });
    });

    this.add.text(600, 250, 'ROUNDS', {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);

    ROUND_OPTIONS.forEach((rounds, index) => {
      this.add.text(320 + index * 80, 300, String(rounds), {
        fontSize: 24,
        fontFamily: 'Orbitron, Arial',
        color: rounds === this.selectedRounds ? '#ffff66' : '#ffffff'
      }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.selectedRounds = rounds;
        this.refreshScene();
      });
    });

    this.add.text(600, 360, 'RULES & SCALING', {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);

    this.add.text(600, 410, `TEAMS: ${this.teamsEnabled ? 'ON' : 'OFF'}`, {
      fontSize: 24,
      fontFamily: 'Orbitron, Arial',
      color: this.teamsEnabled ? '#66aaff' : '#ffaa66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.teamsEnabled = !this.teamsEnabled;
      this.refreshScene();
    });

    this.add.text(600, 510, 'TURN TIMER (SECONDS)', {
      fontSize: 22,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);

    [15, 20, 30, 45, 60].forEach((seconds, index) => {
      this.add.text(440 + index * 80, 548, String(seconds), {
        fontSize: 22,
        fontFamily: 'Orbitron, Arial',
        color: seconds === this.selectedTurnTimer ? '#ffff66' : '#ffffff'
      }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.selectedTurnTimer = seconds;
        this.refreshScene();
      });
    });

    this.add.text(600, 598, `BIG UPGRADES: ${this.bigUpgradesEnabled ? 'ON' : 'OFF'}`, {
      fontSize: 22,
      fontFamily: 'Orbitron, Arial',
      color: this.bigUpgradesEnabled ? '#66ff66' : '#ffaa66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.bigUpgradesEnabled = !this.bigUpgradesEnabled;
      this.refreshScene();
    });

    if (this.bigUpgradesEnabled) {
      this.add.text(760, 598, 'CUSTOMIZE', {
        fontSize: 18,
        fontFamily: 'Orbitron, Arial',
        color: '#ffff66',
        backgroundColor: '#333333',
        padding: { x: 10, y: 5 }
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        GlobalAudio.playButton(this);
        this.openBigUpgradesCustomizeModal();
      });
    }

    this.add.text(600, 630, `UPGRADE COST MULTIPLIER: x${this.costMultiplier}`, {
      fontSize: 22,
      fontFamily: 'Orbitron, Arial',
      color: '#66ccff'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      const index = COST_MULTIPLIERS.indexOf(this.costMultiplier);
      this.costMultiplier = COST_MULTIPLIERS[(index + 1) % COST_MULTIPLIERS.length];
      this.refreshScene();
    });

    this.lineupSummaryText = this.add.text(600, 660, this.lineupSummaryLabel(), {
      fontSize: 15,
      fontFamily: 'Orbitron, Arial',
      color: '#aaaaaa'
    }).setOrigin(0.5);

    const createBtn = this.add.text(600, 690, 'CREATE LOBBY', {
      fontSize: 34,
      fontFamily: 'Orbitron, Arial',
      color: '#66ff66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    createBtn.on('pointerdown', () => this.createLobby());

    const back = this.add.text(80, 850, '<- BACK', {
      fontSize: 24,
      fontFamily: 'Orbitron, Arial',
      color: '#ff6666'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('OnlineMenuScene');
    });
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._handleCustomizeEscape()) return;
      this.scene.start('OnlineMenuScene');
    });

    this._syncDomContainerToCanvas();
    this.scale.on('resize', this._syncDomContainerToCanvas, this);
    this.events.once('shutdown', () => {
      this.removeHandlers();
      try { this.closeBigUpgradesCustomizeModal(); } catch (err) { /* ignore */ }
      try { this.scale.off('resize', this._syncDomContainerToCanvas, this); } catch (err) { /* ignore */ }
    });
  }

  lineupSummaryLabel() {
    const activeCustomUpgrades = this.bigUpgradeCustomizer.getActiveUpgrades().length;
    return this.bigUpgradesEnabled
      ? `Local dice unlocks, luck, economy, combos, and big upgrades are active. Big-upgrade lineup: ${activeCustomUpgrades} entries.`
      : 'Local dice unlocks, luck, economy, and combos are active; big upgrades are disabled.';
  }

  refreshLineupSummary() {
    if (!this.lineupSummaryText || this.lineupSummaryText.active === false) return;
    this.lineupSummaryText.setText(this.lineupSummaryLabel());
  }

  refreshScene() {
    this.scene.restart({
      players: this.selectedPlayers,
      rounds: this.selectedRounds,
      teams: this.teamsEnabled,
      timeLimitSeconds: this.selectedTurnTimer,
      bigUpgradesEnabled: this.bigUpgradesEnabled,
      costMultiplier: this.costMultiplier
    });
  }

  async createLobby() {
    if (this._handlers) return;
    GlobalAudio.playButton(this);

    const socket = getSocket();
    if (!socket?.connected) {
      const connected = await waitForConnection(5000, socket);
      if (!connected) {
        GlobalAlerts.show(this, 'Could not reach the online server.', 'error');
        return;
      }
    }

    this._handlers = {
      created: (data) => {
        this.removeHandlers();
        this.scene.start('OnlineLobbyScene', { code: data?.code || data });
      },
      failed: (data) => {
        this.removeHandlers();
        const messages = {
          unauthenticated: 'Your session expired. Please sign in again.',
          rate_limited: 'Too many lobbies created. Please wait a moment.',
          lobby_limit: 'You already host the maximum number of lobbies.',
          server_full: 'The server is full. Please try again later.',
          invalid_config: 'Those lobby settings are not valid.'
        };
        GlobalAlerts.show(this, messages[data?.reason] || 'Could not create the lobby.', 'error');
        if (data?.reason === 'unauthenticated') this.scene.start('OnlineMenuScene');
      },
      authRequired: () => {
        this.removeHandlers();
        GlobalAlerts.show(this, 'Please sign in to create a lobby.', 'warning');
        this.scene.start('OnlineMenuScene');
      }
    };

    socket.once('lobby-created', this._handlers.created);
    socket.once('create-failed', this._handlers.failed);
    socket.once('auth-required', this._handlers.authRequired);
    socket.emit('create-lobby', {
      players: this.selectedPlayers,
      rounds: this.selectedRounds,
      teams: this.teamsEnabled,
      timeLimitSeconds: this.selectedTurnTimer,
      bigUpgradesEnabled: this.bigUpgradesEnabled,
      costMultiplier: this.costMultiplier,
      // Send the raw customizer list so deleted defaults stay deleted and
      // overrides keep their effect data; the server sanitizes and merges it.
      customBigUpgrades: this.bigUpgradeCustomizer.customUpgrades
    });

    this._timeout = setTimeout(() => {
      this.removeHandlers();
      GlobalAlerts.show(this, 'The server did not respond. Please try again.', 'warning');
    }, 8000);
  }

  removeHandlers() {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    const socket = getSocket();
    if (socket?.off && this._handlers) {
      socket.off('lobby-created', this._handlers.created);
      socket.off('create-failed', this._handlers.failed);
      socket.off('auth-required', this._handlers.authRequired);
    }
    this._handlers = null;
  }
}

Object.assign(OnlineConfigScene.prototype, BigUpgradeCustomizerUIMixin);

const baseCloseBigUpgradesCustomizeModal = OnlineConfigScene.prototype.closeBigUpgradesCustomizeModal;
OnlineConfigScene.prototype.closeBigUpgradesCustomizeModal = function (...args) {
  const result = baseCloseBigUpgradesCustomizeModal.apply(this, args);
  try { this.refreshLineupSummary?.(); } catch (err) { /* scene may be shutting down */ }
  return result;
};
