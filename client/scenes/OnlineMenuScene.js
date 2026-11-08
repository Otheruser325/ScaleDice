import {
  getSocket,
  waitForConnection,
  emitAuthUser
} from '../utils/SocketManager.js';
import {
  fetchMe,
  consumeAuthRedirect
} from '../utils/AuthManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalErrors from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';

export default class OnlineMenuScene extends Phaser.Scene {
  constructor() {
    super('OnlineMenuScene');
    this.user = null;
    this.joinInput = null;
    this.ui = null;
    this.statusText = null;
    this.accountText = null;
    this.socket = null;
    this._onAuthUpdated = null;
    this._onConnect = null;
    this._onDisconnect = null;
    this._joinTimer = null;
    this._joinHandlers = null;
  }

  async create() {
    try { GlobalErrors.setScene(this); } catch (err) { /* ignore */ }
    try { GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true }); } catch (err) { /* ignore */ }
    try { GlobalAchievements.registerScene(this); } catch (err) { /* ignore */ }
    GlobalLocalization.init(this);
    const settings = GlobalSettings.get(this);
    GlobalLocalization.setLanguage(this, settings.language || 'English');
    const t = (key, fallback) => GlobalLocalization.t(key, fallback);

    this.add.text(600, 60, t('ONLINE_TITLE', 'ONLINE MODE'), {
      fontSize: 48,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);

    const backBtn = this.add.text(80, 880, t('UI_BACK', '<- BACK'), {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial',
      color: '#ff6666'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('PlayModeScene');
    });
    this.input.keyboard.on('keydown-ESC', () => {
      GlobalAudio.playButton(this);
      this.scene.start('PlayModeScene');
    });

    this.ui = this.add.container(0, 0);
    this.statusText = this.add.text(600, 820, '', {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial',
      color: '#999999',
      align: 'center'
    }).setOrigin(0.5);

    this._onAuthUpdated = async () => {
      await this.refreshAuth();
      this.bindSocket();
      this.buildUI();
    };
    this.game.events.on('auth-updated', this._onAuthUpdated);
    this.events.once('shutdown', () => this.shutdown());

    const notice = consumeAuthRedirect();
    await this.refreshAuth();
    this.buildUI();

    if (notice?.status === 'success') {
      GlobalAlerts.show(this, `Signed in${notice.provider ? ` with ${notice.provider}` : ''}.`, 'success');
    } else if (notice?.status === 'error') {
      GlobalAlerts.show(this, notice.error || 'Sign in failed. Please try again.', 'error');
    }

    this.bindSocket();
  }

  async refreshAuth() {
    this.user = await fetchMe();
    if (this.user) emitAuthUser(this.user);
  }

  // Signing in after the page loaded replaces the socket so its handshake sees
  // the new session cookie. Rebind the menu handlers to the current socket.
  bindSocket() {
    if (this.socket?.off) {
      if (this._onConnect) this.socket.off('connect', this._onConnect);
      if (this._onDisconnect) this.socket.off('disconnect', this._onDisconnect);
    }

    const socket = getSocket();
    this.socket = socket;
    this._onConnect = () => {
      this.updateConnectionStatus();
      if (this.user) emitAuthUser(this.user);
    };
    this._onDisconnect = () => this.updateConnectionStatus();
    socket.on?.('connect', this._onConnect);
    socket.on?.('disconnect', this._onDisconnect);
    this.updateConnectionStatus();
  }

  updateConnectionStatus() {
    if (!this.statusText) return;
    let connected = false;
    try { connected = !!getSocket()?.connected; } catch (err) { connected = false; }
    this.statusText.setText(connected ? 'Connected' : 'Connecting to online services...');
    this.statusText.setColor(connected ? '#66ff66' : '#ffaa66');
  }

  clearUI() {
    if (this.joinInput) {
      try { this.joinInput.destroy(); } catch (err) { /* ignore */ }
      this.joinInput = null;
    }
    if (this.ui) this.ui.removeAll(true);
    if (this.accountText) {
      try { this.accountText.destroy(); } catch (err) { /* ignore */ }
      this.accountText = null;
    }
  }

  buildUI() {
    this.clearUI();

    const accountLabel = this.user ? this.user.name : 'Not signed in';
    this.accountText = this.add.text(1010, 40, accountLabel, {
      fontSize: 24,
      fontFamily: 'Orbitron, Arial',
      color: this.user ? '#66ff66' : '#cccccc'
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    this.accountText.on('pointerdown', () => this.openAccount());

    if (!this.user) {
      const prompt = this.add.text(600, 250, 'Sign in to play online', {
        fontSize: 32,
        fontFamily: 'Orbitron, Arial',
        color: '#ffffff'
      }).setOrigin(0.5);
      const signIn = this.add.text(600, 340, 'SIGN IN / CREATE ACCOUNT', {
        fontSize: 28,
        fontFamily: 'Orbitron, Arial',
        color: '#66aaff',
        backgroundColor: '#1d2b3a',
        padding: { x: 18, y: 10 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      signIn.on('pointerdown', () => this.openAccount());
      this.ui.add([prompt, signIn]);
      return;
    }

    const createBtn = this.add.text(600, 210, 'CREATE LOBBY', {
      fontSize: 32,
      fontFamily: 'Orbitron, Arial',
      color: '#66ff66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    createBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('OnlineConfigScene');
    });

    const joinLabel = this.add.text(600, 300, 'OR JOIN A LOBBY', {
      fontSize: 24,
      fontFamily: 'Orbitron, Arial',
      color: '#ffffff'
    }).setOrigin(0.5);

    this.joinInput = this.add.dom(600, 370, 'input', {
      width: '200px',
      fontSize: '22px',
      padding: '6px',
      type: 'text',
      placeholder: 'Lobby code',
      background: 'transparent',
      outline: 'none',
      color: '#ffffff'
    });
    try {
      if (this.joinInput.node) {
        this.joinInput.node.maxLength = 6;
        this.joinInput.node.autocomplete = 'off';
        this.joinInput.node.style.textAlign = 'center';
        this.joinInput.node.style.letterSpacing = '4px';
      }
    } catch (err) { /* ignore */ }

    const joinBtn = this.add.text(600, 440, 'JOIN LOBBY', {
      fontSize: 28,
      fontFamily: 'Orbitron, Arial',
      color: '#33aaff'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    joinBtn.on('pointerdown', () => this.joinLobby());

    const hint = this.add.text(600, 520, 'Ask the host for their 6-character code.', {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial',
      color: '#aaaaaa'
    }).setOrigin(0.5);

    this.ui.add([createBtn, joinLabel, joinBtn, hint]);
  }

  openAccount() {
    GlobalAudio.playButton(this);
    this.scene.launch('OnlineAccountScene', { returnTo: 'OnlineMenuScene' });
    this.scene.pause();
  }

  async joinLobby() {
    if (this._joinTimer) {
      clearTimeout(this._joinTimer);
      this._joinTimer = null;
    }
    if (this._joinHandlers) this.removeJoinHandlers();

    const socket = getSocket();
    if (!socket?.connected) {
      const connected = await waitForConnection(5000, socket);
      if (!connected) {
        GlobalAlerts.show(this, 'Could not reach the online server.', 'error');
        return;
      }
    }

    const code = (this.joinInput?.node?.value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,6}$/.test(code)) {
      GlobalAlerts.show(this, 'Enter a valid 4-6 character lobby code.', 'warning');
      return;
    }

    this._joinHandlers = {
      success: (data) => {
        this.removeJoinHandlers();
        this.scene.start('OnlineLobbyScene', { code: data?.code || code });
      },
      failed: (data) => {
        this.removeJoinHandlers();
        const messages = {
          notfound: 'No lobby exists with that code.',
          full: 'That lobby is full.',
          game_started: 'That game has already started.',
          unauthenticated: 'Please sign in again.',
          rate_limited: 'Too many attempts. Please wait a moment.',
          invalid_code: 'That lobby code is not valid.'
        };
        GlobalAlerts.show(this, messages[data?.reason] || 'Could not join that lobby.', 'error');
      },
      authRequired: () => {
        this.removeJoinHandlers();
        GlobalAlerts.show(this, 'Please sign in again.', 'warning');
        this.openAccount();
      }
    };

    socket.once('join-success', this._joinHandlers.success);
    socket.once('join-failed', this._joinHandlers.failed);
    socket.once('auth-required', this._joinHandlers.authRequired);
    socket.emit('join-lobby', code);

    this._joinTimer = setTimeout(() => {
      this.removeJoinHandlers();
      GlobalAlerts.show(this, 'The join request timed out. Please try again.', 'warning');
    }, 8000);
  }

  removeJoinHandlers() {
    if (this._joinTimer) {
      clearTimeout(this._joinTimer);
      this._joinTimer = null;
    }
    const socket = getSocket();
    if (socket?.off && this._joinHandlers) {
      socket.off('join-success', this._joinHandlers.success);
      socket.off('join-failed', this._joinHandlers.failed);
      socket.off('auth-required', this._joinHandlers.authRequired);
    }
    this._joinHandlers = null;
  }

  shutdown() {
    this.removeJoinHandlers();
    if (this._onAuthUpdated) {
      this.game.events.off('auth-updated', this._onAuthUpdated);
      this._onAuthUpdated = null;
    }
    const socket = this.socket;
    if (socket?.off) {
      if (this._onConnect) socket.off('connect', this._onConnect);
      if (this._onDisconnect) socket.off('disconnect', this._onDisconnect);
    }
    this.socket = null;
    this._onConnect = null;
    this._onDisconnect = null;
    this.clearUI();
  }
}
