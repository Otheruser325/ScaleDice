import { getSocket } from '../utils/SocketManager.js';
import { fetchMe } from '../utils/AuthManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';

const FAILURE_MESSAGES = {
  lobby_notfound: 'That lobby no longer exists.',
  not_host: 'Only the host can start the match.',
  players_not_ready: 'Every player must be ready before the match can start.',
  teams_unbalanced: 'Teams must be balanced with at least one player on each side.',
  already_started: 'That match is already running.',
  host_unauthenticated: 'Please sign in again.',
  server_error: 'The server could not start the match.'
};

const TEAM_CHANGE_MESSAGES = {
  not_host: 'Only the host can change teams.',
  teams_disabled: 'Teams are not enabled for this lobby.',
  lobby_not_available: 'Team changes are closed once the match starts.',
  player_notfound: 'That player is no longer in the lobby.'
};

export default class OnlineLobbyScene extends Phaser.Scene {
  constructor() {
    super('OnlineLobbyScene');
    this.code = null;
    this.myId = null;
    this.players = [];
    this.hostUserId = null;
    this.config = {};
    this.playerListText = null;
    this.teamSummaryText = null;
    this.teamControls = [];
    this.readyBtn = null;
    this.startBtn = null;
    this.rulesText = null;
    this._handlers = null;
  }

  init(data) {
    this.code = data?.code || null;
    this.myId = null;
    this.players = [];
    this.hostUserId = null;
    this.config = {};
    this.teamControls = [];
  }

  async create() {
    if (!this.code) {
      this.scene.start('OnlineMenuScene');
      return;
    }

    this.add.rectangle(640, 480, 1280, 960, 0x111111, 0.97);
    this.add.text(600, 55, 'LOBBY', {
      fontSize: 44,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);

    const codeText = this.add.text(600, 120, `CODE: ${this.code}`, {
      fontSize: 30,
      fontFamily: 'Orbitron, Arial',
      color: '#ffff66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    codeText.on('pointerdown', () => {
      try {
        navigator.clipboard?.writeText(this.code);
        codeText.setColor('#aaffaa');
        this.time.delayedCall(250, () => codeText.setColor('#ffff66'));
      } catch (err) { /* clipboard may be unavailable */ }
    });
    this.add.text(600, 155, 'Click the code to copy it.', {
      fontSize: 15,
      fontFamily: 'Orbitron, Arial',
      color: '#888888'
    }).setOrigin(0.5);

    this.playerListText = this.add.text(600, 300, 'Waiting for lobby data...', {
      fontSize: 22,
      fontFamily: 'Orbitron, Arial',
      align: 'center',
      lineSpacing: 8
    }).setOrigin(0.5);

    this.teamSummaryText = this.add.text(600, 500, '', {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial',
      color: '#aaddff'
    }).setOrigin(0.5).setVisible(false);

    this.rulesText = this.add.text(1050, 90, '', {
      fontSize: 17,
      fontFamily: 'Orbitron, Arial',
      color: '#66ff66',
      align: 'left',
      lineSpacing: 6
    }).setOrigin(0, 0);

    this.readyBtn = this.add.text(600, 650, 'READY: NO', {
      fontSize: 30,
      fontFamily: 'Orbitron, Arial',
      color: '#ffaa66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.readyBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      getSocket().emit('toggle-ready', this.code);
    });

    this.startBtn = this.add.text(600, 730, 'START MATCH', {
      fontSize: 32,
      fontFamily: 'Orbitron, Arial',
      color: '#888888'
    }).setOrigin(0.5).setVisible(false).setInteractive({ useHandCursor: true });
    this.startBtn.on('pointerdown', () => this.startMatch());

    const leaveBtn = this.add.text(80, 55, 'LEAVE', {
      fontSize: 24,
      fontFamily: 'Orbitron, Arial',
      color: '#ff6666'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    leaveBtn.on('pointerdown', () => this.leave());

    this.input.keyboard.on('keydown-ESC', () => this.leave());

    const me = await fetchMe();
    this.myId = me?.id || null;
    if (!this.myId) {
      this.scene.start('OnlineMenuScene');
      return;
    }

    this.installHandlers();
    getSocket().emit('request-lobby-data', this.code);
  }

  installHandlers() {
    const socket = getSocket();
    this._handlers = {
      data: (data) => this.updateLobby(data),
      updated: (data) => this.updateLobby(data),
      starting: (data) => {
        GlobalAudio.playButton(this);
        this.scene.start('OnlineGameScene', {
          code: this.code,
          config: data?.config || this.config
        });
      },
      deleted: () => {
        GlobalAlerts.show(this, 'The lobby was closed.', 'warning');
        this.scene.start('OnlineMenuScene');
      },
      failed: (data) => {
        GlobalAlerts.show(this, FAILURE_MESSAGES[data?.reason] || 'Could not start the match.', 'error');
      },
      teamFailed: (data) => {
        GlobalAlerts.show(this, TEAM_CHANGE_MESSAGES[data?.reason] || 'Could not change that team.', 'error');
      },
      authRequired: () => {
        GlobalAlerts.show(this, 'Please sign in again.', 'warning');
        this.scene.start('OnlineMenuScene');
      },
      denied: () => {
        GlobalAlerts.show(this, 'You are no longer a member of that lobby.', 'warning');
        this.scene.start('OnlineMenuScene');
      }
    };

    socket.on('lobby-data', this._handlers.data);
    socket.on('lobby-updated', this._handlers.updated);
    socket.on('game-starting', this._handlers.starting);
    socket.on('lobby-deleted', this._handlers.deleted);
    socket.on('game-failed', this._handlers.failed);
    socket.on('team-change-failed', this._handlers.teamFailed);
    socket.on('auth-required', this._handlers.authRequired);
    socket.on('lobby-data-denied', this._handlers.denied);

    this.events.once('shutdown', () => this.removeHandlers());
  }

  removeHandlers() {
    const socket = getSocket();
    if (socket?.off && this._handlers) {
      socket.off('lobby-data', this._handlers.data);
      socket.off('lobby-updated', this._handlers.updated);
      socket.off('game-starting', this._handlers.starting);
      socket.off('lobby-deleted', this._handlers.deleted);
      socket.off('game-failed', this._handlers.failed);
      socket.off('team-change-failed', this._handlers.teamFailed);
      socket.off('auth-required', this._handlers.authRequired);
      socket.off('lobby-data-denied', this._handlers.denied);
    }
    this._handlers = null;
  }

  updateLobby(data) {
    if (!data || data.code !== this.code) return;

    this.players = (Array.isArray(data.players) ? data.players : []).map((player) => ({
      id: player.id,
      name: player.name || 'Player',
      team: player.team === 'red' ? 'red' : player.team === 'blue' ? 'blue' : null,
      ready: !!player.ready,
      connected: player.connected !== false
    }));
    this.hostUserId = data.hostUserId || this.players[0]?.id || null;
    this.config = data.config || this.config;
    this.render();
  }

  clearTeamControls() {
    for (const control of this.teamControls) {
      try { control.destroy(); } catch (err) { /* scene cleanup best-effort */ }
    }
    this.teamControls = [];
  }

  teamsAreValid() {
    if (!this.config.teams) return true;
    if (this.players.length < 2) return false;
    const blue = this.players.filter((player) => player.team === 'blue').length;
    const red = this.players.filter((player) => player.team === 'red').length;
    return this.players.every((player) => player.team === 'blue' || player.team === 'red')
      && blue > 0
      && red > 0
      && Math.abs(blue - red) <= 1;
  }

  renderTeamControls(isHost, teamsEnabled) {
    this.clearTeamControls();
    this.teamSummaryText.setVisible(teamsEnabled);
    if (!teamsEnabled) return;

    const blue = this.players.filter((player) => player.team === 'blue').length;
    const red = this.players.filter((player) => player.team === 'red').length;
    this.teamSummaryText.setText(`BLUE TEAM: ${blue}  |  RED TEAM: ${red}`);
    this.teamSummaryText.setColor(this.teamsAreValid() ? '#aaddff' : '#ffaa66');

    if (!isHost) return;

    const heading = this.add.text(930, 205, 'TEAM ASSIGNMENTS', {
      fontSize: 14,
      fontFamily: 'Orbitron, Arial',
      color: '#888888'
    }).setOrigin(0, 0.5);
    this.teamControls.push(heading);

    this.players.forEach((player, index) => {
      const color = player.team === 'red' ? '#ff9999' : '#99bbff';
      const shortName = player.name.length > 12 ? `${player.name.slice(0, 12)}…` : player.name;
      const control = this.add.text(930, 240 + index * 34, `${shortName} [${(player.team || '—').toUpperCase()}]`, {
        fontSize: 15,
        fontFamily: 'Orbitron, Arial',
        color
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      control.on('pointerdown', () => this.changeTeam(player));
      this.teamControls.push(control);
    });
  }

  changeTeam(player) {
    const isHost = !!this.myId && String(this.hostUserId) === String(this.myId);
    if (!isHost || !this.config.teams || !player) return;
    if (player.team !== 'blue' && player.team !== 'red') return;

    getSocket().emit('set-player-team', {
      code: this.code,
      playerId: player.id,
      team: player.team === 'blue' ? 'red' : 'blue'
    });
  }

  render() {
    const isHost = !!this.myId && String(this.hostUserId) === String(this.myId);
    const me = this.players.find((player) => String(player.id) === String(this.myId));
    const teamsEnabled = !!this.config.teams;
    const allReady = this.players.length > 0 && this.players.every((player) => player.ready);
    const teamsValid = this.teamsAreValid();

    const lines = this.players.map((player) => {
      const hostTag = String(player.id) === String(this.hostUserId) ? '★ ' : '';
      const selfTag = String(player.id) === String(this.myId) ? ' (you)' : '';
      const teamTag = teamsEnabled && player.team ? ` [${player.team.toUpperCase()}]` : '';
      return `${hostTag}${player.name}${teamTag}${selfTag} — ${player.ready ? 'READY' : 'NOT READY'}`;
    });
    this.playerListText.setText(lines.length ? lines.join('\n') : 'Waiting for players...');

    if (me) {
      this.readyBtn.setText(`READY: ${me.ready ? 'YES' : 'NO'}`);
      this.readyBtn.setColor(me.ready ? '#66ff66' : '#ffaa66');
    } else {
      this.readyBtn.setText('READY: NO').setColor('#ffaa66');
    }

    this.startBtn.setVisible(isHost);
    this.startBtn.setColor(allReady && this.players.length >= 2 && teamsValid ? '#66ff66' : '#888888');

    const maxPlayers = this.config.players || 2;
    this.rulesText.setText([
      `Players: ${this.players.length}/${maxPlayers}`,
      `Rounds: ${this.config.rounds || 30}`,
      `Big upgrades: ${this.config.bigUpgradesEnabled ? 'ON' : 'OFF'}`,
      `Teams: ${teamsEnabled ? 'ON' : 'OFF'}`,
      `Turn timer: ${this.config.timeLimitSeconds || 30}s`
    ].join('\n'));

    this.renderTeamControls(isHost, teamsEnabled);
  }

  startMatch() {
    const isHost = !!this.myId && String(this.hostUserId) === String(this.myId);
    if (!isHost) return;
    if (this.players.length < 2 || !this.players.every((player) => player.ready)) {
      GlobalAlerts.show(this, 'Every player must be ready first.', 'warning');
      return;
    }
    if (!this.teamsAreValid()) {
      GlobalAlerts.show(this, 'Teams must be balanced with at least one player on each side.', 'warning');
      return;
    }
    GlobalAudio.playButton(this);
    getSocket().emit('start-game', this.code);
  }

  leave() {
    GlobalAudio.playButton(this);
    getSocket().emit('leave-lobby', this.code);
    this.scene.start('OnlineMenuScene');
  }
}
