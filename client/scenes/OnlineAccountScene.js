import { connectTo, getServerUrl } from '../utils/SocketManager.js';
import {
  fetchMe,
  fetchProviders,
  guestLogin,
  guestRegister,
  logout,
  oauthUrl
} from '../utils/AuthManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';

export default class OnlineAccountScene extends Phaser.Scene {
  constructor() {
    super('OnlineAccountScene');
    this.user = null;
    this.providers = { guest: true, google: false, discord: false };
    this.returnTo = 'OnlineMenuScene';
    this.loginUserInput = null;
    this.loginPassInput = null;
    this.registerPassInput = null;
    this.container = null;
    this.busy = false;
  }

  init(data) {
    this.returnTo = data?.returnTo || 'OnlineMenuScene';
  }

  async create() {
    this.add.rectangle(640, 480, 1280, 960, 0x000000, 0.9);
    this.container = this.add.container(0, 0);
    this.events.once('shutdown', () => this.shutdown());

    const [user, providers] = await Promise.all([fetchMe(), fetchProviders()]);
    this.user = user;
    this.providers = providers;
    this.render();
  }

  clearUI() {
    this.destroyInputs();
    if (this.container) this.container.removeAll(true);
  }

  destroyInputs() {
    for (const key of ['loginUserInput', 'loginPassInput', 'registerPassInput']) {
      const input = this[key];
      if (!input) continue;
      try { input.destroy(); } catch (err) { /* ignore */ }
      if (input.node?.parentNode) input.node.parentNode.removeChild(input.node);
      this[key] = null;
    }
  }

  render() {
    this.clearUI();
    const add = (object) => {
      this.container.add(object);
      return object;
    };

    add(this.add.text(600, 100, 'ACCOUNT', {
      fontSize: 44,
      fontFamily: 'Orbitron, Arial',
      color: '#ffffff'
    }).setOrigin(0.5));

    if (this.user) {
      this.renderSignedIn(add);
    } else {
      this.renderSignedOut(add);
    }

    const back = add(this.add.text(600, 850, 'BACK', {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial',
      color: '#ff6666'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
    back.on('pointerdown', () => this.close());
    this.input.keyboard.off('keydown-ESC');
    this.input.keyboard.on('keydown-ESC', () => this.close());
  }

  renderSignedIn(add) {
    add(this.add.text(600, 210, `Signed in as ${this.user.name}`, {
      fontSize: 28,
      fontFamily: 'Orbitron, Arial',
      color: '#66ff66'
    }).setOrigin(0.5));

    const typeLabel = this.user.type === 'guest' ? 'Guest account' : `${this.user.type} account`;
    add(this.add.text(600, 260, typeLabel, {
      fontSize: 20,
      fontFamily: 'Orbitron, Arial',
      color: '#aaaaaa'
    }).setOrigin(0.5));

    if (this.user.type === 'guest') {
      add(this.add.text(600, 330, 'Keep your username and password safe — they are the only way back into this account.', {
        fontSize: 16,
        fontFamily: 'Orbitron, Arial',
        color: '#cccccc',
        align: 'center',
        wordWrap: { width: 760 }
      }).setOrigin(0.5));
    }

    const signOut = add(this.add.text(600, 430, 'SIGN OUT', {
      fontSize: 28,
      fontFamily: 'Orbitron, Arial',
      color: '#ff4444'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }));

    signOut.on('pointerdown', async () => {
      if (this.busy) return;
      this.busy = true;
      GlobalAudio.playButton(this);
      const signedOut = await logout();
      this.busy = false;
      if (!signedOut) {
        GlobalAlerts.show(this, 'Could not sign out. Check your connection and try again.', 'error');
        return;
      }
      this.user = null;
      // The socket handshake carries the session cookie. Replace the old
      // authenticated socket with a fresh anonymous one after logout.
      try { connectTo(); } catch (err) { /* keep the UI usable */ }
      this.game.events.emit('auth-updated', null);
      GlobalAlerts.show(this, 'Signed out.', 'success');
      this.render();
    });
  }

  renderSignedOut(add) {
    add(this.add.text(600, 170, 'Sign in to play online', {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial',
      color: '#ffffff'
    }).setOrigin(0.5));

    // Existing guest account
    add(this.add.text(600, 235, 'GUEST ACCOUNT', {
      fontSize: 20,
      fontFamily: 'Orbitron, Arial',
      color: '#66aaff'
    }).setOrigin(0.5));

    this.loginUserInput = this.makeInput(600, 285, {
      placeholder: 'Username (or guest number)',
      width: '320px'
    });
    this.loginPassInput = this.makeInput(600, 335, {
      placeholder: 'Password',
      width: '320px',
      type: 'password'
    });

    const loginBtn = add(this.add.text(600, 390, 'SIGN IN', {
      fontSize: 24,
      fontFamily: 'Orbitron, Arial',
      color: '#66ff66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
    loginBtn.on('pointerdown', () => this.signIn());

    // New guest account
    add(this.add.text(600, 480, 'NEW GUEST ACCOUNT', {
      fontSize: 20,
      fontFamily: 'Orbitron, Arial',
      color: '#ffaa44'
    }).setOrigin(0.5));

    this.registerPassInput = this.makeInput(600, 530, {
      placeholder: 'Choose a password (6+ characters)',
      width: '320px',
      type: 'password'
    });

    const registerBtn = add(this.add.text(600, 585, 'CREATE GUEST ACCOUNT', {
      fontSize: 24,
      fontFamily: 'Orbitron, Arial',
      color: '#00ffaa'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
    registerBtn.on('pointerdown', () => this.createGuest());

    // OAuth providers are only offered when the server has credentials.
    let y = 665;
    if (this.providers.google) {
      const google = add(this.add.text(600, y, 'SIGN IN WITH GOOGLE', {
        fontSize: 22,
        fontFamily: 'Orbitron, Arial',
        color: '#ffeb3b'
      }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
      google.on('pointerdown', () => this.startOAuth('google'));
      y += 50;
    }
    if (this.providers.discord) {
      const discord = add(this.add.text(600, y, 'SIGN IN WITH DISCORD', {
        fontSize: 22,
        fontFamily: 'Orbitron, Arial',
        color: '#7289da'
      }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
      discord.on('pointerdown', () => this.startOAuth('discord'));
    }
  }

  makeInput(x, y, { placeholder, width, type = 'text' }) {
    const input = this.add.dom(x, y, 'input', {
      width,
      fontSize: '20px',
      padding: '6px',
      type,
      placeholder,
      background: 'transparent',
      outline: 'none',
      color: '#ffffff'
    });
    try {
      if (input.node) {
        input.node.autocomplete = 'off';
        input.node.style.borderRadius = '6px';
        input.node.style.textAlign = 'center';
      }
    } catch (err) { /* ignore */ }
    return input;
  }

  async signIn() {
    if (this.busy) return;
    const username = (this.loginUserInput?.node?.value || '').trim();
    const password = this.loginPassInput?.node?.value || '';
    if (!username || !password) {
      GlobalAlerts.show(this, 'Enter your username and password.', 'warning');
      return;
    }

    this.busy = true;
    GlobalAudio.playButton(this);
    const result = await guestLogin(username, password);
    this.busy = false;

    if (!result.ok) {
      GlobalAlerts.show(this, result.error || 'Sign in failed.', 'error');
      return;
    }
    this.complete(result.user);
  }

  async createGuest() {
    if (this.busy) return;
    const password = this.registerPassInput?.node?.value || '';
    if (password.length < 6) {
      GlobalAlerts.show(this, 'Password must be at least 6 characters.', 'warning');
      return;
    }

    this.busy = true;
    GlobalAudio.playButton(this);
    const result = await guestRegister(password);
    this.busy = false;

    if (!result.ok) {
      GlobalAlerts.show(this, result.error || 'Could not create the guest account.', 'error');
      return;
    }
    this.showCreatedAccount(result.user, password);
  }

  showCreatedAccount(user, password) {
    this.user = user;
    this.clearUI();
    const add = (object) => this.container.add(object);

    add(this.add.text(600, 180, 'GUEST ACCOUNT CREATED', {
      fontSize: 34,
      fontFamily: 'Orbitron, Arial',
      color: '#66ff66'
    }).setOrigin(0.5));

    add(this.add.text(600, 270, 'Save these details. They cannot be recovered.', {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial',
      color: '#ffaa66'
    }).setOrigin(0.5));

    add(this.add.text(600, 360, `Username: ${user.name}`, {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial',
      color: '#ffffff'
    }).setOrigin(0.5));

    add(this.add.text(600, 410, `Password: ${password}`, {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial',
      color: '#ffffff'
    }).setOrigin(0.5));

    const continueBtn = add(this.add.text(600, 520, 'CONTINUE', {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial',
      color: '#66ff66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
    continueBtn.on('pointerdown', () => this.complete(user));
  }

  startOAuth(provider) {
    GlobalAudio.playButton(this);
    if (!this.providers[provider]) return;
    // A full-page redirect keeps the provider flow simple and lets the server
    // set the session cookie on its own origin.
    window.location.href = oauthUrl(provider) || `${getServerUrl()}/auth/${provider}`;
  }

  complete(user) {
    if (!user) return;
    this.user = user;
    // A guest sign-in sets the session cookie after this page's socket already
    // connected. Reconnect so the new handshake is authenticated by the server.
    try { connectTo(); } catch (err) { /* waitForConnection handles retries */ }
    this.game.events.emit('auth-updated', user);
    this.close();
  }

  close() {
    GlobalAudio.playButton(this);
    this.scene.resume(this.returnTo);
    this.scene.stop();
  }

  shutdown() {
    this.destroyInputs();
    this.container = null;
  }
}
