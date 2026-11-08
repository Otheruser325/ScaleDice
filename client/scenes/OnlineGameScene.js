import { getSocket } from '../utils/SocketManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import { animateDiceRoll, animateDiceSpin } from '../utils/AnimationManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';
import { COMBO_DISPLAY_NAMES, checkCombo, showComboText, playComboFX } from '../utils/ComboManager.js';
import { formatCompact } from '../utils/FormatManager.js';

// Phaser can measure a text object as zero-sized before its font is ready.
// Attach an explicit hit area to every text control so it remains clickable
// regardless of the measured text bounds.
function makeTextButton(text, width, height) {
  text.setInteractive(
    new Phaser.Geom.Rectangle(0, 0, width, height),
    Phaser.Geom.Rectangle.Contains
  );
  if (text.input) text.input.cursor = 'pointer';
  return text;
}

const SHOP_BIG_UPGRADE_PAGE_SIZE = 12;

export default class OnlineGameScene extends Phaser.Scene {
  constructor() {
    super('OnlineGameScene');
  }

  init(data) {
    this.roomCode = data.code || null;

    // authoritative display/state set by server game-state
    this.playerSlots = [];
    this.localPlayerIndex = null;
    this.currentPlayerIndex = null;

    // defaults — server will override via game-state
    this.gameConfig = {
      players: data.players ?? 2,
      rounds: data.rounds ?? 30,
      teams: false,
      timeLimitSeconds: 30,
      progression: true,
      costMultiplier: data.config?.costMultiplier ?? 1
    };

    // If the scene was started with a config (from OnlineLobbyScene), apply it
    if (data && data.config) {
      this.gameConfig.players = data.config.players ?? this.gameConfig.players;
      this.gameConfig.rounds = data.config.rounds ?? this.gameConfig.rounds;
      this.gameConfig.teams = data.config.teams === true;
      this.gameConfig.timeLimitSeconds = data.config.timeLimitSeconds ?? this.gameConfig.timeLimitSeconds;
      this.gameConfig.progression = true;
      this.gameConfig.costMultiplier = data.config.costMultiplier ?? this.gameConfig.costMultiplier;
    } else {
      this.gameConfig.players = data.players ?? this.gameConfig.players;
      this.gameConfig.rounds = data.rounds ?? this.gameConfig.rounds;
      this.gameConfig.teams = data.teams === true;
      this.gameConfig.progression = true;
    }

    // runtime
    this.currentRound = 1;
    this.scores = [];
    this.comboStats = [];
    this.waitingForRoll = [];
    this.teamScores = null;
    this._hasRolledThisTurn = false;
    this._rollInProgress = false;
    this.progressionEnabled = true;
    this.currentShop = null;
    this.shopOpen = false;
    this.prediction = null;

    // timer (client side mirror only)
    this.turnTimer = null;
    this.turnTimeoutSeconds = 30;
    this._lastTurnLogKey = null;
    this._rollicaneActive = false;
    this._achievementsRecorded = false;
    this._gameEnded = false;
    this._achievementSequenceStarted = false;
    this._achievementSequenceFinished = false;
    this.history = null;
    this.bigUpgradePage = 0;
    this.bigUpgradePageCount = 1;
    this._consecutiveFullHouse = 0;
  }

  create() {
    this.exitLocked = true;
    this.debug = false;
    try { GlobalAchievements.registerScene(this); } catch (err) { /* ignore */ }

    if (this.debug) console.log('[OnlineGameScene] create() room=', this.roomCode);

    this.add.rectangle(600, 480, 1280, 960, 0x111111, 0.95);
    this.roundTitle = this.add.text(600, 50, 'Online Game', { fontSize: 32 }).setOrigin(0.5);
    this.teamScoreText = this.add.text(600, 100, '', {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial',
      color: '#aaddff'
    }).setOrigin(0.5).setVisible(false);
    this.info = this.add.text(600, 180, '', { fontSize: 24, align: 'center' }).setOrigin(0.5);
    this.predictionText = this.add.text(600, 130, '', {
      fontSize: 16,
      fontFamily: 'Orbitron, Arial',
      color: '#88ff88'
    }).setOrigin(0.5);

    this.shopBtn = this.add.text(1090, 300, 'SHOP', {
      fontSize: 22,
      fontFamily: 'Orbitron, Arial',
      color: '#66ccff'
    }).setOrigin(0.5).setVisible(false);
    makeTextButton(this.shopBtn, 90, 40);
    this.shopBtn.on('pointerdown', () => this.toggleShop());
    this.shopContainer = this.add.container(0, 0).setDepth(3000).setVisible(false);

    // Roll button (client -> server). Text bounds can be zero before the font
    // is measured in a headless browser, so give it an explicit hit area.
    this.rollBtn = this.add.text(600, 300, 'Roll Dice', {
      fontSize: 32,
      fontFamily: 'Orbitron, Arial',
      color: '#999999'
    })
      .setOrigin(0.5)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, 210, 50), Phaser.Geom.Rectangle.Contains)
      .on('pointerdown', () => {
        if (this.localPlayerIndex === null || this.currentPlayerIndex !== this.localPlayerIndex) return;
        this.rollBtn.disableInteractive();
        this.rollBtn.setText('Rolling...');
        this.onRollPressed();
      });

    // End Turn (optional, server drives flow)
    this.endTurnBtn = this.add.text(600, 360, 'End Turn', {
      fontSize: 20,
      fontFamily: 'Orbitron, Arial',
      color: '#ffaa66'
    }).setOrigin(0.5);
    makeTextButton(this.endTurnBtn, 150, 40);
    this.endTurnBtn.on('pointerdown', () => {
      if (this.localPlayerIndex === null || this.currentPlayerIndex !== this.localPlayerIndex) return;
      if (!this._hasRolledThisTurn) {
        this.info.setText('You must roll before ending your turn.');
        return;
      }
      getSocket().emit('player-end-turn', { code: this.roomCode, playerIndex: this.localPlayerIndex });
      this.endTurnBtn.disableInteractive();
    });
    this.endTurnBtn.disableInteractive();

    this.timerText = this.add.text(600, 580, '', { fontSize: 20 }).setOrigin(0.5);

    // dice sprites (up to six for local progression)
    this.diceSprites = [];
    const startX = 600 - (6 * 70) / 2;
    const y = 240;
    for (let i = 0; i < 6; i++) {
      const s = this.add.image(startX + i * 70, y, 'dice1').setScale(0.9).setVisible(false);
      s.originalX = s.x; s.originalY = s.y;
      this.diceSprites.push(s);
    }

    this.scoreBreakdown = this.add.text(600, 420, '', {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial',
      align: 'center',
      color: '#ffffaa',
      lineSpacing: -2
    }).setOrigin(0.5).setAlpha(0).setDepth(50);

    this.playerBar = [];
    this.createHistoryLog();

    this.addBackButton();
    this.installSocketHandlers();

    // Identity is established by the HTTP session during the socket handshake;
    // the game never promotes a cached/local value to a player identity.

    // request server authoritative state
    if (getSocket()) {
      getSocket().emit('request-game-state', { code: this.roomCode });
      // fallback: if no current player index arrived quickly, re-request once
      this.time.delayedCall(250, () => {
        if (this.debug) console.log('[OnlineGameScene] fallback check — currentPlayerIndex =', this.currentPlayerIndex);
        if ((this.currentPlayerIndex === null || typeof this.currentPlayerIndex === 'undefined') && getSocket()) {
          if (this.debug) console.log('[OnlineGameScene] re-requesting game-state (fallback)');
          getSocket().emit('request-game-state', { code: this.roomCode });
        }
      });
    } else {
      this.info.setText('Not connected to server.');
    }

    // small flag so handlers don't run before scene is ready
    this._sceneReady = true;
    this._logActivity(`Game started — Room ${this.roomCode}`);
  }

  // -----------------------
  // Player bar helpers
  // -----------------------
  createPlayerBar() {
    // destroy previous visuals (if any)
    if (Array.isArray(this.playerBar) && this.playerBar.length) {
      this.playerBar.forEach(item => {
        if (item.icon) item.icon.destroy();
        if (item.tag) item.tag.destroy();
        if (item.ring) item.ring.destroy();
        if (item.scoreText) item.scoreText.destroy();
        if (item.progressText) item.progressText.destroy();
      });
    }
    this.playerBar = [];

    const total = this.playerSlots.length || 1;
    const spacing = 200;
    const startX = 600 - ((total - 1) * spacing) / 2;
    const y = 850;

    for (let i = 0; i < total; i++) {
      const icon = this.add.image(startX + i * spacing, y, 'playerIcon').setScale(0.7).setVisible(false);
      const tag = this.add.text(startX + i * spacing, y + 70, `P${i + 1}`, { fontSize: 26, color: '#ffffff' }).setOrigin(0.5).setVisible(false);
      const scoreText = this.add.text(startX + i * spacing, y - 70, '0', { fontSize: 20, color: '#ffff88' }).setOrigin(0.5).setVisible(false);
      const progressText = this.add.text(startX + i * spacing, y + 42, '', { fontSize: 14, color: '#aaddff' }).setOrigin(0.5).setVisible(false);
      const ring = this.add.rectangle(startX + i * spacing, y, 90, 90, 0x66ccff, 0.25).setStrokeStyle(3, 0x66ccff).setVisible(false);
      this.playerBar.push({ ring, icon, tag, scoreText, progressText });
    }

    this.updatePlayerBar();
  }

  updatePlayerBar() {
    const total = this.playerSlots.length || 1;
    const spacing = 200;
    const startX = 600 - ((total - 1) * spacing) / 2;
    const y = 850;

    this.playerBar.forEach((slot, idx) => {
      const x = startX + idx * spacing;

      // reposition visuals in case layout changed
      if (slot.icon) { slot.icon.x = x; slot.icon.y = y; slot.icon.setVisible(idx < total); }
      if (slot.tag) { slot.tag.x = x; slot.tag.y = y + 70; slot.tag.setVisible(idx < total); }        if (slot.scoreText) { slot.scoreText.x = x; slot.scoreText.y = y - 70; slot.scoreText.setVisible(idx < total); }
      if (slot.progressText) { slot.progressText.x = x; slot.progressText.y = y + 42; slot.progressText.setVisible(idx < total); }
      if (slot.ring) { slot.ring.x = x; slot.ring.y = y; slot.ring.setVisible(idx < total); }

      if (slot.ring) slot.ring.setVisible(idx < total);

      if (this.playerSlots[idx]) {
        // Avatar URLs from OAuth providers are not loaded textures; use the
        // bundled player icon and keep the account name in the label.
        slot.icon.setTexture('playerIcon');
        slot.icon.setVisible(true);
        const playerTeam = this.playerSlots[idx].team;
        slot.tag.setText(this.playerSlots[idx].name || `P${idx + 1}`);
        slot.tag.setColor(playerTeam === 'red' ? '#ff9999' : playerTeam === 'blue' ? '#99bbff' : '#ffffff');
        // Guest names are long; keep adjacent tags from touching in 2P games.
        slot.tag.setFontSize(total <= 2 ? 22 : 24);
        slot.tag.setVisible(true);
        if (slot.ring) {
          const teamColor = playerTeam === 'red' ? 0xff7777 : playerTeam === 'blue' ? 0x77bbff : 0x66ccff;
          slot.ring.setFillStyle(teamColor, 0.16);
          slot.ring.setStrokeStyle(idx === this.currentPlayerIndex ? 4 : 3, idx === this.currentPlayerIndex ? 0xffffff : teamColor);
        }

        const sc = (this.scores && typeof this.scores[idx] === 'number') ? String(this.scores[idx]) : '0';
        if (slot.scoreText) { slot.scoreText.setText(sc).setVisible(true); }
        const progression = this.playerSlots[idx].progression;
        if (slot.progressText) {
          if (this.progressionEnabled && progression) {
            const effectiveLuck = Number(progression.effectiveLuck || 1).toFixed(1);
            slot.progressText.setText(`🎲 ${progression.diceUnlocked || 1}  🍀 ${effectiveLuck}  💰 +${progression.economyIncome || 0}`);
            slot.progressText.setVisible(true);
          } else {
            slot.progressText.setText('').setVisible(false);
          }
        }

        if (this.playerSlots[idx].connected === false) {
          slot.icon.setTint(0x444444);
          slot.tag.setText(`${this.playerSlots[idx].name} (left)`);
          if (slot.scoreText) slot.scoreText.setTint(0x444444);
        } else {
          slot.icon.clearTint();
          if (slot.scoreText) slot.scoreText.clearTint();
        }
      } else {
        slot.icon.setVisible(false);
        slot.tag.setVisible(false);
        if (slot.scoreText) slot.scoreText.setVisible(false);
      }
    });
  }

  // -----------------------
  // Socket handlers
  // -----------------------
  installSocketHandlers() {
    const s = getSocket();
    if (!s) return;

    // store bound handlers so we can remove them cleanly
    this._handlers = {
      gameState: (p) => { if (this.debug) console.log('[socket] game-state', p); this.applyGameState(p); },
      turnStart: (p) => { if (this.debug) console.log('[socket] turn-start', p); this.onTurnStart(p); },
      turnResult: (p) => { if (this.debug) console.log('[socket] turn-result', p); this.onTurnResult(p); },
      playerTimeout: (p) => { if (this.debug) console.log('[socket] player-timeout', p); this.onPlayerTimeout(p); },
      playerLeft: (p) => this.onPlayerLeft(p),
      gameStarting: (p) => this.onGameStarting(p),
      gameFinished: (p) => this.endGame(p),
      lobbyDeleted: (p) => this.onLobbyDeleted(p),
      playerRolling: (p) => this.onPlayerRolling(p),
      endTurnFailed: (p) => { if (p && p.reason === 'not_rolled') this.info.setText('You must roll before ending your turn.'); },
      upgradeResult: (p) => this.onUpgradeResult(p),
      upgradeFailed: (p) => this.onUpgradeFailed(p),
      scoreDrain: (p) => this.onScoreDrain(p),
      prediction: (p) => this.onPrediction(p),
      stateDenied: (p) => this.onStateDenied(p),
      authRequired: (p) => this.onAuthRequired(p),
      gameFailed: (p) => this.onGameFailed(p)
    };

    s.on('game-state', this._handlers.gameState);
    s.on('turn-start', this._handlers.turnStart);
    s.on('turn-result', this._handlers.turnResult);
    s.on('player-timeout', this._handlers.playerTimeout);
    s.on('player-left', this._handlers.playerLeft);
    s.on('game-starting', this._handlers.gameStarting);
    s.on('game-finished', this._handlers.gameFinished);
    s.on('lobby-deleted', this._handlers.lobbyDeleted);
    s.on('player-rolling', this._handlers.playerRolling);
    s.on('end-turn-failed', this._handlers.endTurnFailed);
    s.on('upgrade-result', this._handlers.upgradeResult);
    s.on('upgrade-failed', this._handlers.upgradeFailed);
    s.on('score-drain', this._handlers.scoreDrain);
    s.on('player-prediction', this._handlers.prediction);

    // legacy / alternative names
    s.on('game-over', this._handlers.gameFinished); // support either event name
    s.on('game-state-denied', this._handlers.stateDenied);
    s.on('auth-required', this._handlers.authRequired);
    s.on('game-failed', this._handlers.gameFailed);

    // ensure cleanup on scene stop
    this.events.once('shutdown', () => this.shutdown());
    this.events.once('destroy', () => this.shutdown());
  }

  // -----------------------
  // Game starting (server told lobby->game)
  // -----------------------
  onGameStarting(payload) {
    // server: lobby -> game transition. Request fresh game-state to sync.
    if (!this._sceneReady) return;
    if (!getSocket()) return;
    getSocket().emit('request-game-state', { code: this.roomCode });
  }

  // -----------------------
  // Turn lifecycle
  // -----------------------
  onTurnStart(payload) {
    // accept multiple shape variants
    const playerIndex = (typeof payload.playerIndex === 'number')
      ? payload.playerIndex
      : (typeof payload.currentPlayerIndex === 'number' ? payload.currentPlayerIndex : null);

    if (playerIndex === null) {
      console.warn('onTurnStart: invalid payload (no player index)', payload);
      return;
    }

    const round = typeof payload.round === 'number' ? payload.round : this.currentRound;
    const timeLimitSeconds = typeof payload.timeLimitSeconds === 'number' ? payload.timeLimitSeconds : this.turnTimeoutSeconds;

    // clear previous client timer
    this.clearTurnTimer();

    // update current player + round
    this.currentPlayerIndex = playerIndex;
    this.currentRound = round;
    // Turn-start can change scores through income, interest, or catch-up
    // boosts, so apply the server snapshot before drawing the player bar.
    if (Array.isArray(payload.scores) && (!this.playerSlots.length || payload.scores.length === this.playerSlots.length)) {
      this.scores = payload.scores.slice();
    }
    if (Array.isArray(payload.comboStats) && (!this.playerSlots.length || payload.comboStats.length === this.playerSlots.length)) {
      this.comboStats = payload.comboStats.map((combo) => combo || this.makeDefaultComboStats(1)[0]);
    }
    if (payload.progression && this.playerSlots[playerIndex]) {
      this.playerSlots[playerIndex].progression = payload.progression;
    }
    this.updateRoundTitle();

    // UI highlight
    this.updatePlayerBar();
    this.teamScores = payload.teamScores || this.computeTeamScores();
    this.updateTeamDisplay();

    const name = (this.playerSlots[playerIndex] && this.playerSlots[playerIndex].name) || `P${playerIndex + 1}`;
    const turnLogKey = `${this.currentRound}:${playerIndex}`;
    if (this._lastTurnLogKey !== turnLogKey) {
      this._lastTurnLogKey = turnLogKey;
      this._logActivity(`${name}'s turn started`);
      if (payload.income > 0) this._logActivity(`${name} received ${payload.income} income`);
      if (payload.interest > 0) this._logActivity(`${name} received ${payload.interest} interest`);
      if (payload.energyBoost > 0) this._logActivity(`${name} received an Energy Boost (${payload.energyBoost})`);
      if (payload.megaEnergyBoost > 0) this._logActivity(`${name} received MEGA ENERGY (${payload.megaEnergyBoost})`);
    }

    // A game-state refresh can arrive after a roll (or while a roll is being
    // resolved), not only at turn start. Trust the server's flags instead of
    // always re-enabling the local controls.
    const hasRolled = payload.currentPlayerHasRolled === true;
    const rolling = payload.currentPlayerRolling === true;
    this._rollInProgress = rolling;
    this._hasRolledThisTurn = this.localPlayerIndex === playerIndex ? hasRolled : false;
    this.progressionEnabled = true;
    this.currentShop = payload.shop || null;

    if (Object.prototype.hasOwnProperty.call(payload, 'prediction')) {
      const prediction = Array.isArray(payload.prediction) ? payload.prediction.slice() : null;
      this.prediction = prediction;
      if (this.predictionText) {
        this.predictionText.setText(prediction ? `Prediction: ${prediction.join(', ')}` : '');
      }
    } else {
      this.prediction = null;
      if (this.predictionText) this.predictionText.setText('');
    }

    if (this.localPlayerIndex === playerIndex) {
      const bonuses = [];
      if (payload.income > 0) bonuses.push(`+${payload.income} income`);
      if (payload.interest > 0) bonuses.push(`+${payload.interest} interest`);
      if (payload.energyBoost > 0) bonuses.push(`+${payload.energyBoost} energy`);
      if (payload.megaEnergyBoost > 0) bonuses.push(`+${payload.megaEnergyBoost} mega energy`);

      if (rolling) {
        this.info.setText('🎲 Rolling...');
        this.rollBtn.setText('Rolling...').setStyle({ color: '#c4c70bd2' }).disableInteractive();
        this.endTurnBtn.disableInteractive();
        this.endTurnBtn.setStyle({ color: '#888888' });
      } else if (hasRolled) {
        this.info.setText(`🎲 Your roll${bonuses.length ? `  (${bonuses.join(', ')})` : ''}`);
        this.rollBtn.setText('Results').setStyle({ color: '#888888' }).disableInteractive();
        this.endTurnBtn.setInteractive();
        this.endTurnBtn.setStyle({ color: '#ff4444' });
      } else {
        this.info.setText(`🎲 Your turn${bonuses.length ? `  (${bonuses.join(', ')})` : ''}`);
        this.rollBtn.setText('Roll Dice').setStyle({ color: '#66ff66' }).setInteractive();
        this.endTurnBtn.disableInteractive();
        this.endTurnBtn.setStyle({ color: '#888888' });
      }
      this.startTurnTimer(timeLimitSeconds, payload?.turnExpiresAt || null);
    } else {
      this.info.setText(rolling
        ? `🎲 ${name} is rolling...`
        : hasRolled
          ? `🎲 ${name} has rolled`
          : `🎲 ${name}'s turn`);
      this.rollBtn.setText(rolling ? 'Rolling...' : 'Waiting...')
        .setStyle({ color: '#999999' })
        .disableInteractive();
      this.endTurnBtn.disableInteractive();
      this.endTurnBtn.setStyle({ color: '#888888' });
      this.startTurnTimer(timeLimitSeconds, payload?.turnExpiresAt || null);
    }
    this.updateShopUI();
  }

  // unify result rendering for turn-result and player-timeout
  async _renderTurnResult(payload = {}, { isTimeout = false } = {}) {
    if (!payload || typeof payload.playerIndex !== 'number') {
      console.warn('_renderTurnResult: invalid payload', payload);
      return;
    }

    if (payload.turnExpiresAt) {
      const remSec = Math.max(0, Math.ceil((payload.turnExpiresAt - Date.now()) / 1000));
      this.startTurnTimer(remSec, payload.turnExpiresAt);
    }

    const playerIndex = payload.playerIndex;
    const dice = Array.isArray(payload.dice) ? payload.dice : [];
    const scored = payload.scored;
    const combo = payload.combo;

    // Ensure arrays length matches current player count
    const playerCount = this.playerSlots.length || this.scores.length || 0;
    if (!Array.isArray(this.comboStats) || this.comboStats.length !== playerCount) {
      this.comboStats = this.makeDefaultComboStats(playerCount);
    }
    if (!Array.isArray(this.scores) || this.scores.length !== playerCount) {
      this.scores = Array(playerCount).fill(0);
    }

    // Animate however many dice the active local progression has unlocked.
    if (dice.length) {
      try {
        await animateDiceRoll(this, dice, this.diceSprites.slice(0, dice.length));
      } catch (err) {
        console.warn('animateDiceRoll failed', err);
      }
    }

    // apply final textures and hide dice the player has not unlocked
    if (dice.length) {
      this.diceSprites.forEach((sprite, i) => {
        if (i < dice.length) sprite.setTexture(`dice${dice[i]}`).setVisible(true);
        else sprite.setVisible(false);
      });
    }

    const spinEntries = Array.isArray(payload.rollicaneSpins) ? payload.rollicaneSpins : [];
    if (spinEntries.length) {
      await this.runRollicanePresentation(payload, dice);
    }

    // server authoritative arrays (scores/comboStats)
    if (Array.isArray(payload.scores) && payload.scores.length === playerCount) {
      this.scores = payload.scores.slice();
    } else if (typeof scored === 'number') {
      // if server didn't send full scores, apply to local index only (fallback)
      this.scores[playerIndex] = scored + (this.scores[playerIndex] || 0);
    }

    if (Array.isArray(payload.comboStats) && payload.comboStats.length === playerCount) {
      // ensure we have objects for each slot
      this.comboStats = payload.comboStats.map(c => (c || this.makeDefaultComboStats(1)[0]));
    }
    if (payload.progression && this.playerSlots[playerIndex]) {
      this.playerSlots[playerIndex].progression = payload.progression;
    }
    this.currentShop = payload.shop || this.currentShop;
    this.prediction = null;
    this.teamScores = payload.teamScores || this.computeTeamScores();
    this.updateTeamDisplay();

    // Show combo fx (client-side visual)
    if (combo && this.comboRulesEnabled()) {
      try {
        playComboFX(this, combo.key);
        showComboText(this, combo.type || combo.key, combo.intensity || 1);
        if (GlobalAudio && combo.key && typeof GlobalAudio.comboSFX === 'function') {
          GlobalAudio.comboSFX(this, combo.key);
        }
      } catch (err) {
        console.warn('combo display error', err);
      }
    }

    // Update breakdown - if scored provided show final, else show base
    if (dice.length && typeof scored !== 'undefined') {
      this.diceScoringDisplay(dice, scored, payload);
    } else if (dice.length) {
      const base = dice.reduce((a, b) => a + b, 0);
      this.diceScoringDisplay(dice, base, payload);
    }

    // show results header
    const resultName = (this.playerSlots[playerIndex] && this.playerSlots[playerIndex].name) || `P${playerIndex + 1}`;
    if (this.localPlayerIndex === playerIndex) {
      this.info.setText(`🎲 Your roll`);
    } else {
      this.info.setText(`🎲 ${resultName}'s roll`);
    }
    this.rollBtn.setText('Results').setStyle({ color: '#888888' });
    this._hasRolledThisTurn = true;
    this.currentShop = null;
    this._rollInProgress = false;
    this.updateShopUI();

    const comboLabel = combo?.key ? ` (${COMBO_DISPLAY_NAMES[combo.key] || combo.key})` : '';
    const scoredLabel = typeof scored === 'number' ? scored : 0;
    this._logActivity(`${resultName} rolled [${dice.join(', ')}] -> +${scoredLabel}${comboLabel}${isTimeout ? ' (timeout)' : ''}`);
    if (this.localPlayerIndex === playerIndex) this.recordRollAchievements(payload);

    this.updatePlayerBar();

    // Local play enables End Turn as soon as the roll result is on screen.
    // Match that instead of making online players wait through an extra delay.
    if (!isTimeout && this.localPlayerIndex === playerIndex && this.currentPlayerIndex === playerIndex) {
      this._hasRolledThisTurn = true;
      this.endTurnBtn.setInteractive();
      this.endTurnBtn.setStyle({ color: '#ff4444' });
    } else {
      this.endTurnBtn.disableInteractive();
      this.endTurnBtn.setStyle({ color: '#888888' });
    }

    // clear the client timer (server confirmed outcome)
    this.clearTurnTimer();
  }

  // called when server sends 'turn-result'
  onTurnResult(payload) {
    this._renderTurnResult(payload, { isTimeout: false });
  }

  // called when server emits 'player-timeout'
  onPlayerTimeout(payload) {
    if (payload.turnExpiresAt) {
      const remSec = Math.max(0, Math.ceil((payload.turnExpiresAt - Date.now()) / 1000));
      this.startTurnTimer(remSec, payload.turnExpiresAt);
    }
    this._renderTurnResult(payload, { isTimeout: true });
  }

  // -----------------------
  // Roll press (client)
  // -----------------------
  onRollPressed() {
    if (!getSocket()) return;
    if (this.localPlayerIndex === null) return;

    if (GlobalAudio) {
      if (typeof GlobalAudio.playDice === 'function') {
        GlobalAudio.playDice(this);
      }
    }
    getSocket().emit('player-roll', { code: this.roomCode, playerIndex: this.localPlayerIndex });
  }

  // -----------------------
  // Game-state application
  // -----------------------
  applyGameState(payload = {}) {
    const players = Array.isArray(payload.players) ? payload.players : [];

    // build display playerSlots (id, name, avatar, connected)
    this.playerSlots = players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || 'playerIcon',
      team: p.team === 'red' ? 'red' : p.team === 'blue' ? 'blue' : null,
      connected: p.connected !== false,
      progression: p.progression || null,
      diceUnlocked: p.diceUnlocked || 1
    }));

    // local index detection (server may provide)
    if (typeof payload.localIndex === 'number') {
      this.localPlayerIndex = payload.localIndex;
    } else if (payload.localId) {
      const idx = this.playerSlots.findIndex(p => String(p.id) === String(payload.localId));
      this.localPlayerIndex = idx >= 0 ? idx : null;
    } else {
      // The server owns identity. Without localIndex/localId this client is an
      // observer only; never promote a cached value to a player identity.
      this.localPlayerIndex = null;
    }

    // Local play unlocks this when a human match starts; online matches are
    // always human, so unlock it as soon as this client's seat is known.
    if (Number.isInteger(this.localPlayerIndex)) {
      try { GlobalAchievements.maybeUnlock('firstPlay'); } catch (err) { /* ignore */ }
    }

    this.progressionEnabled = true;
    this.currentShop = payload.shop || null;

    // apply config override if present
    if (payload.config) {
      this.gameConfig.players = payload.config.players ?? this.gameConfig.players;
      this.gameConfig.rounds = payload.config.rounds ?? this.gameConfig.rounds;
      this.gameConfig.teams = payload.config.teams === true;
      this.gameConfig.timeLimitSeconds = payload.config.timeLimitSeconds ?? this.gameConfig.timeLimitSeconds;
      this.gameConfig.progression = true;
      this.gameConfig.costMultiplier = payload.config.costMultiplier ?? this.gameConfig.costMultiplier;
    }
    this.teamScores = payload.teamScores || this.computeTeamScores();

    // ensure arrays sized properly
    const playerCount = this.playerSlots.length;
    this.scores = (Array.isArray(payload.scores) && payload.scores.length === playerCount)
      ? payload.scores.slice()
      : Array(playerCount).fill(0);

    this.comboStats = (Array.isArray(payload.comboStats) && payload.comboStats.length === playerCount)
      ? payload.comboStats.map(c => (c || this.makeDefaultComboStats(1)[0]))
      : this.makeDefaultComboStats(playerCount);

    this.waitingForRoll = (Array.isArray(payload.waitingForRoll) && payload.waitingForRoll.length === playerCount)
      ? payload.waitingForRoll.slice()
      : Array(playerCount).fill(false);

    // round/room
    this.currentRound = typeof payload.round === 'number' ? payload.round : this.currentRound;
    this.totalRounds = this.gameConfig.rounds;
    this.roomCode = payload.room || this.roomCode;

    // Update UI
    this.roundTitle.setText(`Online Game — Round ${this.currentRound}/${this.totalRounds}`);
    this.createPlayerBar();
    this.updatePlayerBar();

    // If server included whose turn it is, trigger turn-start handling
    const cpIndex = (typeof payload.currentPlayerIndex === 'number')
      ? payload.currentPlayerIndex
      : (typeof payload.currentIndex === 'number' ? payload.currentIndex : null);

    if (cpIndex !== null) {
      this.currentPlayerIndex = cpIndex;
      if (this.debug) console.log('[OnlineGameScene] applyGameState -> start turn', cpIndex, 'timeLimit:', payload.timeLimitSeconds);
      this.onTurnStart({
        playerIndex: cpIndex,
        round: this.currentRound,
        timeLimitSeconds: typeof payload.timeLimitSeconds === 'number' ? payload.timeLimitSeconds : this.turnTimeoutSeconds,
        turnExpiresAt: payload.turnExpiresAt ?? null,
        currentPlayerHasRolled: payload.currentPlayerHasRolled === true,
        currentPlayerRolling: payload.currentPlayerRolling === true,
        prediction: payload.prediction,
        progressionEnabled: this.progressionEnabled,
        shop: payload.shop || null
      });
    } else {
      // no current player index in payload — clear any transient controls
      this.currentPlayerIndex = null;
      this.rollBtn.setText('Roll Dice').disableInteractive().setStyle({ color: '#999999' });
      this.endTurnBtn.disableInteractive();
    }
  }

  createHistoryLog() {
    const pad = 12;
    const panelWidth = 420;
    const panelHeight = 380;
    const panelX = this.scale.width;
    const panelY = 400;

    this.history = {
      container: this.add.container(panelX, panelY).setDepth(950),
      bg: this.add.rectangle(0, 0, panelWidth, panelHeight, 0x000000, 0.75).setOrigin(1, 0),
      title: this.add.text(-10, 8, 'Activity Log', {
        fontSize: 14,
        fontFamily: 'Orbitron, Arial',
        color: '#66ff66'
      }).setOrigin(1, 0)
    };

    const textX = -panelWidth + pad + 4;
    const textY = 32;
    this.history.text = this.add.text(textX, textY, '', {
      fontSize: 12,
      fontFamily: 'Orbitron, Arial',
      color: '#ffffff',
      align: 'left',
      wordWrap: { width: panelWidth - pad * 2 }
    }).setOrigin(0, 0);

    this.history.hint = this.add.text(-12, panelHeight - 18, 'Scroll to view more', {
      fontSize: 10,
      fontFamily: 'Orbitron, Arial',
      color: '#888888'
    }).setOrigin(1, 0);
    this.history.container.add([this.history.bg, this.history.title, this.history.text, this.history.hint]);

    const maskGraphics = this.make.graphics({}, false);
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(panelX - panelWidth + pad, panelY + textY, panelWidth - pad * 2, panelHeight - textY - pad);
    this.history.maskGraphics = maskGraphics;
    this.history.mask = maskGraphics.createGeometryMask();
    this.history.text.setMask(this.history.mask);
    this.history.entries = [];
    this.history.scrollY = 0;
    this.history.maxScroll = 0;
    this.history.panelWidth = panelWidth;
    this.history.panelHeight = panelHeight;
    this.history.textX = textX;
    this.history.textY = textY;

    this.history.wheelHandler = (pointer, gameObjects, deltaX, deltaY) => {
      const px = pointer.x;
      const py = pointer.y;
      const left = panelX - panelWidth;
      const top = panelY;
      const right = panelX;
      const bottom = panelY + panelHeight;
      if (px >= left && px <= right && py >= top && py <= bottom) {
        const step = Math.sign(deltaY) * 24;
        this.history.scrollY = Phaser.Math.Clamp(
          this.history.scrollY + step,
          0,
          Math.max(0, this.history.maxScroll)
        );
        this._refreshHistoryDisplay();
      }
    };
    this.input.on('wheel', this.history.wheelHandler);

    this.history.bg.setInteractive();
    this.history.bg.on('pointerdown', () => {
      this.history.scrollY = 0;
      this._refreshHistoryDisplay();
    });
  }

  _refreshHistoryDisplay() {
    if (!this.history) return;
    this.history.text.setText(this.history.entries.join('\n\n'));

    const metrics = this.history.text.getBounds();
    const contentHeight = metrics.height || 0;
    const visibleHeight = this.history.panelHeight - this.history.textY - 12;
    this.history.maxScroll = Math.max(0, contentHeight - visibleHeight);
    this.history.text.y = this.history.textY - this.history.scrollY;

    try { this.tweens.killTweensOf(this.history.text); } catch (err) { /* ignore */ }
  }

  _logActivity(message) {
    if (!this.history) return;
    const timestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    this.history.entries.unshift(`[${timestamp}] ${message}`);
    this.history.entries = this.history.entries.slice(0, 300);
    this.history.scrollY = 0;
    this._refreshHistoryDisplay();
  }

  closeHistoryLog() {
    if (!this.history) return;
    try { this.input.off('wheel', this.history.wheelHandler); } catch (err) { /* ignore */ }
    try { this.history.mask?.destroy(); } catch (err) { /* ignore */ }
    try { this.history.maskGraphics?.destroy(); } catch (err) { /* ignore */ }
    try { this.history.container?.destroy(true); } catch (err) { /* ignore */ }
    this.history = null;
  }

  async runRollicanePresentation(payload = {}, dice = []) {
    const spins = Array.isArray(payload.rollicaneSpins) ? payload.rollicaneSpins : [];
    if (!spins.length) return;

    this._rollicaneActive = true;
    this.info.setText('Dice Spin...');
    const multiplier = Number(payload.diceMultiplier || 1) *
      (payload.combo ? Number(payload.comboMultiplier || 1) : 1);

    try {
      await animateDiceSpin(this, this.diceSprites.slice(0, dice.length), spins, {
        onTick: (_second, activeForSecond) => {
          const tickBase = activeForSecond.reduce(
            (sum, entry) => sum + (Number(entry.face) || 0),
            0
          );
          const tickGain = Math.floor(tickBase * Math.max(1, multiplier));
          if (tickGain <= 0) return;

          const tickText = this.add.text(600, 260, `Dice Spin +${tickGain}`, {
            fontSize: 20,
            fontFamily: 'Orbitron, Arial',
            color: '#99eeff'
          }).setOrigin(0.5).setDepth(30);
          this.tweens.add({
            targets: tickText,
            y: 230,
            alpha: 0,
            duration: 650,
            onComplete: () => tickText.destroy()
          });
        }
      });
    } catch (err) {
      console.warn('Rollicane presentation failed', err);
    } finally {
      this._rollicaneActive = false;
    }

    if (Number(payload.rollicaneBonus) > 0) {
      this._logActivity(`Dice Spin +${payload.rollicaneBonus}`);
    }
  }

  recordRollAchievements(payload = {}) {
    if (!Number.isInteger(this.localPlayerIndex)) return;
    const combo = payload.combo;
    if (combo?.key === 'straight') GlobalAchievements.addStraights(1);
    if (combo?.key === 'fullHouse' || combo?.key === 'powerHouse') {
      this._consecutiveFullHouse = (this._consecutiveFullHouse || 0) + 1;
      if (this._consecutiveFullHouse >= 5) GlobalAchievements.maybeUnlock('funHouse');
    } else {
      this._consecutiveFullHouse = 0;
    }
    if (combo?.key === 'fourOfAKind') GlobalAchievements.unlockComboAchievement('fourOfAKind');
    if (combo?.key === 'fiveOfAKind') GlobalAchievements.unlockComboAchievement('fiveOfAKind');
    if (combo?.key === 'sixOfAKind') GlobalAchievements.unlockComboAchievement('sixOfAKind');
    // Local play checks the roll's score before the Rollicane spin bonus; the
    // server folds that bonus into `scored`, so subtract it here.
    const rollScore = Number(payload.scored) - Number(payload.rollicaneBonus || 0);
    if (rollScore >= 10000) GlobalAchievements.maybeUnlock('boomDicealaka');

    const score = Number(payload.scores?.[this.localPlayerIndex]);
    if (score >= 1000) GlobalAchievements.maybeUnlock('score1000');
    if (score >= 10000) GlobalAchievements.maybeUnlock('score10000');
    if (score >= 100000) GlobalAchievements.maybeUnlock('score100000');
    if (score >= 1000000) GlobalAchievements.maybeUnlock('score1000000');
    if (score >= 10000000) GlobalAchievements.maybeUnlock('score10000000');
  }

  recordOnlineAchievements(payload = {}) {
    if (this._achievementsRecorded) return [];
    this._achievementsRecorded = true;
    if (!Number.isInteger(this.localPlayerIndex)) return [];

    const scores = (Array.isArray(payload.scores) ? payload.scores : this.scores).map(Number);
    const score = Number(scores[this.localPlayerIndex]) || 0;
    const comboStats = payload.comboStats?.[this.localPlayerIndex] ||
      this.comboStats?.[this.localPlayerIndex];
    const progression = payload.progression?.[this.localPlayerIndex] ||
      this.playerSlots[this.localPlayerIndex]?.progression;

    GlobalAchievements.addGame();
    GlobalAchievements.addMatchScore(score);
    const roundsPlayed = Number.isFinite(payload.roundsPlayed)
      ? payload.roundsPlayed
      : Math.max(0, (Number(payload.totalRounds) || this.gameConfig.rounds || 0) - 1);
    if (roundsPlayed > 0) GlobalAchievements.addRounds(roundsPlayed);
    if (scores.length && score === Math.max(...scores)) GlobalAchievements.addWin(1);

    if (comboStats) {
      if ((comboStats.fourOfAKind || 0) > 0) GlobalAchievements.unlockComboAchievement('fourOfAKind');
      if ((comboStats.fiveOfAKind || 0) > 0) GlobalAchievements.unlockComboAchievement('fiveOfAKind');
      if ((comboStats.sixOfAKind || 0) > 0) GlobalAchievements.unlockComboAchievement('sixOfAKind');
    }

    if (progression) {
      const requiredBigs = [
        'clairvoyance', 'stockExchange', 'comboX', 'masterPredict',
        'fixated', 'highStonks', 'comboMasher', 'rollicane'
      ];
      const bigs = Array.isArray(progression.bigUpgrades) ? progression.bigUpgrades : [];
      if (
        Number(progression.diceUnlocked) >= 6 &&
        Number(progression.economyLevel) >= Number(progression.economyCap) &&
        Number(progression.luckLevel) >= 25 &&
        requiredBigs.every((key) => bigs.includes(key))
      ) {
        GlobalAchievements.maybeUnlock('maximumPower');
      }
    }

    return GlobalAchievements.getNotifications();
  }

  upgradeLabel(kind, key) {
    if (kind === 'dice') return 'Dice';
    if (kind === 'economy') return 'Economy';
    if (kind === 'luck') return 'Luck';
    if (kind === 'combo') return `${COMBO_DISPLAY_NAMES[key] || key} combo`;
    if (kind === 'big') {
      return this.currentShop?.big?.find((item) => item.key === key)?.title || key;
    }
    return kind;
  }

  onPlayerRolling(payload = {}) {
    if (!payload || typeof payload.playerIndex !== 'number') return;
    this._rollInProgress = true;
    this.currentShop = null;
    this.updateShopUI();
    const rollingIndex = payload.playerIndex;

    // who is rolling
    const name = (this.playerSlots[rollingIndex] && this.playerSlots[rollingIndex].name) || `P${rollingIndex + 1}`;

    // If it's our own index, set the local Roll button to Rolling...
    if (rollingIndex === this.localPlayerIndex) {
      this.rollBtn.setText('Rolling...').setStyle({ color: '#c4c70bd2' }).disableInteractive();
      this.endTurnBtn.disableInteractive();
      this.endTurnBtn.setStyle({ color: '#888888' });
    } else {
      this.rollBtn.setText('Rolling...').setStyle({ color: '#c4c70bd2' }).disableInteractive();
      this.info.setText(`🎲 ${name} is rolling...`);
    }
  }

  // -----------------------
  // Player left handler
  // -----------------------
  onPlayerLeft(payload) {
    if (!payload) return;
    const id = payload.id;
    let idx = (typeof payload.index === 'number') ? payload.index : -1;

    if (idx === -1 && id) {
      idx = this.playerSlots.findIndex(p => String(p.id) === String(id));
    }
    if (idx === -1) {
      return;
    }

    // mark disconnected
    if (this.playerSlots[idx]) {
      this.playerSlots[idx].connected = false;
      this.updatePlayerBar();
      const name = this.playerSlots[idx].name || `P${idx + 1}`;
      this.info.setText(`${name} left the game`);
      this._logActivity(`${name} left the game`);
    }
  }

  // lobby deleted while in-game
  onLobbyDeleted(payload) {
    // server requested cleanup — return to the online menu
    this.info.setText('Lobby closed by host.');
    this.clearTurnTimer();
    this.time.delayedCall(1500, () => {
      this.exitLocked = false;
      this.scene.start('OnlineMenuScene');
    });
  }

  onStateDenied(payload) {
    this.info.setText('You are no longer a member of this match.');
    this.clearTurnTimer();
    this.time.delayedCall(1500, () => this.scene.start('OnlineMenuScene'));
  }

  onAuthRequired() {
    this.info.setText('Your session expired. Please sign in again.');
    this.clearTurnTimer();
    this.time.delayedCall(1500, () => this.scene.start('OnlineMenuScene'));
  }

  onGameFailed(payload) {
    const messages = {
      not_host: 'Only the host can start the match.',
      players_not_ready: 'Every player must be ready.',
      teams_unbalanced: 'Teams must be balanced with at least one player on each side.',
      already_started: 'That match is already running.'
    };
    this.info.setText(messages[payload?.reason] || 'The match could not start.');
  }

  // -----------------------
  // Game end / postgame
  // -----------------------
  endGame(payload = {}) {
    if (this._gameEnded) return;
    this._gameEnded = true;
    this.closeShop();
    const scores = Array.isArray(payload.scores) ? payload.scores : (this.scores || []);
    const combos = Array.isArray(payload.comboStats) ? payload.comboStats : (this.comboStats || []);
    this._logActivity('Game finished');
    // Queue every end-of-game unlock, then show the full sequence before
    // leaving the scene so postgame cannot cut a popup short.
    try { GlobalAchievements.registerScene(null); } catch (err) { /* ignore */ }
    const achievementKeys = this.recordOnlineAchievements(payload);

    let resultText = 'Game Over\n\n';
    resultText += scores.map((s, i) => {
      const name = (this.playerSlots[i] && this.playerSlots[i].name) || `P${i + 1}`;
      return `${name}: ${s}`;
    }).join('\n');
    if (this.gameConfig.teams) {
      const totals = payload.teamScores || this.computeTeamScores() || { blue: 0, red: 0 };
      resultText += `\n\nBlue: ${totals.blue}\nRed: ${totals.red}`;
    }

    this.info.setText(resultText);
    this.rollBtn.disableInteractive();
    this.endTurnBtn.disableInteractive();
    this.clearTurnTimer();

    this.time.delayedCall(4000, () => {
      const finish = () => {
        this._achievementSequenceFinished = true;
        this.registry.set('onlineAchievementsComplete', true);
        this.exitLocked = false;
        const players = this.playerSlots.length || scores.length;
        const names = (Array.isArray(payload.names) && payload.names.length === players)
          ? payload.names
          : this.playerSlots.map((p, i) => p?.name || `P${i + 1}`);
        this.registry.set('onlinePostGame', {
          players,
          names,
          scores,
          combos,
          teamsEnabled: this.gameConfig.teams === true,
          teams: this.playerSlots.map((p) => p?.team || null),
          teamScores: payload.teamScores || this.computeTeamScores(),
          winnerTeam: payload.winnerTeam ?? null
        });
        this.scene.start('OnlinePostGameScene');
      };

      const showAchievements = () => {
        // A live achievement popup may still be on screen. Wait for it to clear
        // before starting the end-of-game sequence.
        if (GlobalAchievements._achieveNotificationRunning) {
          this.time.delayedCall(100, showAchievements);
          return;
        }
        if (achievementKeys.length) {
          this._achievementSequenceStarted = true;
          GlobalAchievements._displayAchievementSequence(achievementKeys, finish, this);
        } else {
          finish();
        }
      };
      showAchievements();
    });
  }

  // -----------------------
  // Local progression shop
  // -----------------------
  canUseShop() {
    return this.progressionEnabled &&
      this.localPlayerIndex !== null &&
      this.currentPlayerIndex === this.localPlayerIndex &&
      !this._rollInProgress &&
      !this._hasRolledThisTurn;
  }

  updateShopUI() {
    if (!this.shopBtn) return;
    const visible = this.progressionEnabled &&
      this.localPlayerIndex !== null &&
      this.currentPlayerIndex === this.localPlayerIndex &&
      !!this.currentShop &&
      !this._rollInProgress &&
      !this._hasRolledThisTurn;
    this.shopBtn.setVisible(visible);
    if (!visible) {
      this.closeShop();
      return;
    }
    this.shopBtn.setAlpha(this.canUseShop() ? 1 : 0.5);
    if (this.shopOpen) this.renderShop();
  }

  toggleShop() {
    if (!this.currentShop || !this.canUseShop()) {
      this.info.setText('The shop is only available on your turn before rolling.');
      return;
    }
    this.shopOpen = !this.shopOpen;
    if (this.shopOpen) this.renderShop();
    else this.closeShop();
  }

  closeShop() {
    this.shopOpen = false;
    if (this.shopContainer) {
      this.shopContainer.removeAll(true);
      this.shopContainer.setVisible(false);
    }
  }

  buyUpgrade(kind, key = null) {
    if (!this.canUseShop()) return;
    getSocket().emit('buy-upgrade', { code: this.roomCode, kind, key });
  }

  renderShop() {
    if (!this.shopContainer || !this.currentShop) return;
    this.shopContainer.removeAll(true);
    this.shopContainer.setVisible(true);
    this.bigUpgradePrevBtn = null;
    this.bigUpgradeNextBtn = null;
    this.bigUpgradePageText = null;

    const shop = this.currentShop;
    const score = Number(this.scores[this.localPlayerIndex]) || 0;
    const add = (child) => { this.shopContainer.add(child); return child; };
    const addRow = (x, y, label, cost, enabled, onClick, purchased = false) => {
      const text = add(this.add.text(x, y, label, {
        fontSize: 14,
        fontFamily: 'Orbitron, Arial',
        color: purchased ? '#777777' : (enabled ? '#ffffff' : '#777777')
      }).setOrigin(0, 0.5));
      const button = add(this.add.text(x + 300, y, purchased ? 'OWNED' : `BUY ${cost ?? '--'}`, {
        fontSize: 13,
        fontFamily: 'Orbitron, Arial',
        color: purchased ? '#555555' : (enabled ? '#66ff66' : '#555555')
      }).setOrigin(0, 0.5));
      if (!purchased && enabled) {
        makeTextButton(button, 120, 28);
        button.on('pointerdown', onClick);
      }
      return { text, button };
    };

    add(this.add.rectangle(640, 480, 1160, 840, 0x080808, 0.98).setStrokeStyle(2, 0x66ccff));
    add(this.add.text(640, 75, 'LOCAL UPGRADES', {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial',
      color: '#66ccff'
    }).setOrigin(0.5));
    const close = add(this.add.text(1160, 75, 'CLOSE', {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial',
      color: '#ff8888'
    }).setOrigin(0.5));
    makeTextButton(close, 100, 40);
    close.on('pointerdown', () => this.closeShop());

    add(this.add.text(100, 120, `Score: ${score}`, {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial',
      color: '#ffff88'
    }));

    const coreY = 155;
    const core = [
      {
        x: 250,
        label: `DICE ${shop.dice.current}/${shop.dice.max}\nNext: ${shop.dice.next || 'MAX'}`,
        cost: shop.dice.cost,
        enabled: shop.dice.next && score >= shop.dice.cost,
        onClick: () => this.buyUpgrade('dice')
      },
      {
        x: 640,
        label: `ECONOMY Lv ${shop.economy.level}/${shop.economy.cap}\nIncome: ${shop.economy.income}`,
        cost: shop.economy.cost,
        enabled: shop.economy.level < shop.economy.cap && score >= shop.economy.cost,
        onClick: () => this.buyUpgrade('economy')
      },
      {
        x: 1030,
        label: `LUCK Lv ${shop.luck.level}/${shop.luck.maxLevel}\nEffective: ${Number(shop.luck.effective || 1).toFixed(1)}`,
        cost: shop.luck.cost,
        enabled: Number(shop.luck.effective) < 6 && score >= shop.luck.cost,
        onClick: () => this.buyUpgrade('luck')
      }
    ];
    core.forEach((item) => {
      add(this.add.text(item.x, coreY, item.label, {
        fontSize: 15,
        fontFamily: 'Orbitron, Arial',
        align: 'center',
        color: '#ffffff'
      }).setOrigin(0.5));
      const button = add(this.add.text(item.x, coreY + 42, `BUY ${item.cost ?? 'MAX'}`, {
        fontSize: 15,
        fontFamily: 'Orbitron, Arial',
        color: item.enabled ? '#66ff66' : '#555555'
      }).setOrigin(0.5));
      if (item.enabled) {
        makeTextButton(button, 140, 36);
        button.on('pointerdown', item.onClick);
      }
    });

    add(this.add.text(350, 235, 'COMBO UPGRADES', {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial',
      color: '#ffdd66'
    }).setOrigin(0.5));
    shop.combos.forEach((combo, index) => {
      const y = 265 + index * 29;
      const req = combo.requirement;
      const available = combo.available;
      const enabled = available && combo.level < 1000 && score >= combo.cost;
      addRow(100, y, `${COMBO_DISPLAY_NAMES[combo.key] || combo.key} Lv ${combo.level}${available ? '' : ` (needs ${req} dice)`}`, combo.cost, enabled, () => this.buyUpgrade('combo', combo.key));
    });

    const bigItems = Array.isArray(shop.big) ? shop.big : [];
    this.bigUpgradePageCount = Math.max(1, Math.ceil(bigItems.length / SHOP_BIG_UPGRADE_PAGE_SIZE));
    this.bigUpgradePage = Math.max(0, Math.min(this.bigUpgradePage || 0, this.bigUpgradePageCount - 1));
    if (bigItems.length > 0) {
      const pageStart = this.bigUpgradePage * SHOP_BIG_UPGRADE_PAGE_SIZE;
      const itemsToShow = bigItems.slice(pageStart, pageStart + SHOP_BIG_UPGRADE_PAGE_SIZE);
      add(this.add.text(820, 235, 'BIG UPGRADES', {
        fontSize: 18,
        fontFamily: 'Orbitron, Arial',
        color: '#ff99dd'
      }).setOrigin(0.5));
      itemsToShow.forEach((big, index) => {
        const y = 265 + index * 44;
        const label = `${big.title}${big.purchased ? ' (owned)' : ''}`;
        addRow(650, y, label, big.cost, !big.purchased && score >= big.cost, () => this.buyUpgrade('big', big.key), big.purchased);
        add(this.add.text(650, y + 12, this.bigUpgradeDescription(big), {
          fontSize: 9,
          fontFamily: 'Orbitron, Arial',
          color: big.purchased ? '#666666' : '#aaaaaa',
          wordWrap: { width: 250 }
        }).setOrigin(0, 0.5));
      });

      if (this.bigUpgradePageCount > 1) {
        const prev = add(this.add.text(600, 820, '◀', {
          fontSize: 24,
          fontFamily: 'Orbitron, Arial',
          color: this.bigUpgradePage > 0 ? '#ffffff' : '#555555'
        }).setOrigin(0.5));
        this.bigUpgradePrevBtn = prev;
        if (this.bigUpgradePage > 0) {
          makeTextButton(prev, 40, 36);
          prev.on('pointerdown', () => {
            this.bigUpgradePage -= 1;
            this.renderShop();
          });
        }

        this.bigUpgradePageText = add(this.add.text(700, 820, `Page ${this.bigUpgradePage + 1}/${this.bigUpgradePageCount}`, {
          fontSize: 14,
          fontFamily: 'Orbitron, Arial',
          color: '#cccccc'
        }).setOrigin(0.5));

        const next = add(this.add.text(800, 820, '▶', {
          fontSize: 24,
          fontFamily: 'Orbitron, Arial',
          color: this.bigUpgradePage < this.bigUpgradePageCount - 1 ? '#ffffff' : '#555555'
        }).setOrigin(0.5));
        this.bigUpgradeNextBtn = next;
        if (this.bigUpgradePage < this.bigUpgradePageCount - 1) {
          makeTextButton(next, 40, 36);
          next.on('pointerdown', () => {
            this.bigUpgradePage += 1;
            this.renderShop();
          });
        }
      }
    }
    add(this.add.text(640, 880, 'Purchases are only allowed before rolling on your turn.', {
      fontSize: 14,
      fontFamily: 'Orbitron, Arial',
      color: '#aaaaaa'
    }).setOrigin(0.5));
  }

  bigUpgradeDescription(item = {}) {
    const effect = item.effect;
    const value = Number(item.value);
    const values = item.values || {};
    const toNumber = (input, fallback = null) => {
      const n = Number(input);
      return Number.isFinite(n) ? n : fallback;
    };
    const toPercent = (input) => `${Math.round((toNumber(input, 0) || 0) * 100)}%`;

    switch (effect) {
      case 'predictChance':
        return `${toPercent(value)} chance to predict your next roll.`;
      case 'ecoMultiplier':
        return `Economy income x${toNumber(value, 1)}.`;
      case 'comboMultiplier':
        return `Combo multipliers x${toNumber(value, 1)}.`;
      case 'rollMultiplier':
        return `Dice-earned scores x${toNumber(value, 1)}.`;
      case 'ecoRoundMultiplier':
        return `Economy +${toPercent(value)} per completed round.`;
      case 'economyCap': {
        const delta = Math.trunc(toNumber(value, 0) || 0);
        return `Economy cap ${delta >= 0 ? '+' : ''}${delta}.`;
      }
      case 'comboCostMultiplier':
        return `Combo upgrade costs x${toNumber(value, 1)}.`;
      case 'comboStreak':
        return `+${toPercent(values.percentage ?? value)} combo per consecutive same-type combo${values.isMultiplicative ? ' (multiplicative)' : ''}.`;
      case 'spinEffect':
        return `${toPercent(values.chance ?? value)} per die to spin ${toNumber(values.minSec, 2)}-${toNumber(values.maxSec, 10)}s and gain points each second.`;
      case 'interestRate': {
        const cap = toNumber(item.investmentCap, null);
        const capDelta = cap == null ? 0 : Math.round((cap - 1) * 100);
        const capNote = capDelta === 0 ? '' : ` (${capDelta >= 0 ? '+' : ''}${capDelta}% max interest)`;
        return `Gain ${toPercent(value)} of current score each turn.${capNote}`;
      }
      case 'comboUpgrade':
        return `+${toPercent(values.percentage ?? value)} combo multiplier per combo level${values.isMultiplicative ? ' (multiplicative)' : ''}.`;
      case 'scoreDrain':
        return `Steal ${toPercent(values.percentage ?? value)} of score from ${Math.max(1, Math.trunc(toNumber(values.numPlayers, 1) || 1))} player(s) each turn end (${values.stealMethod || 'random'}).`;
      default:
        return 'Big upgrade effect.';
    }
  }

  onUpgradeResult(payload = {}) {
    if (Number.isInteger(payload.playerIndex) && typeof payload.score === 'number') {
      this.scores[payload.playerIndex] = payload.score;
    }
    if (Number.isInteger(payload.playerIndex) && payload.progression && this.playerSlots[payload.playerIndex]) {
      this.playerSlots[payload.playerIndex].progression = payload.progression;
    }
    this.currentShop = payload.shop || this.currentShop;
    this.updatePlayerBar();
    this.updateShopUI();

    const playerName = this.playerSlots[payload.playerIndex]?.name || `P${payload.playerIndex + 1}`;
    const label = this.upgradeLabel(payload.kind, payload.key);
    const cost = Number(payload.cost);
    this._logActivity(`${playerName} bought ${label}${Number.isFinite(cost) ? ` for ${cost}` : ''}`);
  }

  onUpgradeFailed(payload = {}) {
    const messages = {
      not_your_turn: 'You can only buy upgrades on your turn.',
      not_available: 'The shop is not available right now.',
      insufficient_score: 'Not enough score for that upgrade.',
      maxed: 'That upgrade is already maxed.',
      locked: 'Unlock more dice before buying that combo.',
      invalid_key: 'That upgrade does not exist.',
      invalid_kind: 'That upgrade does not exist.',
      big_upgrades_disabled: 'Big upgrades are disabled for this match.'
    };
    this.info.setText(messages[payload.reason] || 'That purchase could not be completed.');
  }

  onScoreDrain(payload = {}) {
    if (Array.isArray(payload.scores) && (!this.playerSlots.length || payload.scores.length === this.playerSlots.length)) {
      this.scores = payload.scores.slice();
    }
    this.updatePlayerBar();

    const ownerName = this.playerSlots[payload.ownerIndex]?.name || `P${Number(payload.ownerIndex) + 1}`;
    const details = (Array.isArray(payload.targets) ? payload.targets : [])
      .filter((target) => Number(target?.amount) > 0)
      .map((target) => `${this.playerSlots[target.index]?.name || `P${Number(target.index) + 1}`} -${formatCompact(target.amount)}`)
      .join(', ');
    const total = Number(payload.total) || 0;
    const skippedDetails = (Array.isArray(payload.skipped) ? payload.skipped : [])
      .map((entry) => {
        const victimName = this.playerSlots[entry.index]?.name || `P${Number(entry.index) + 1}`;
        const claimantName = this.playerSlots[entry.claimedBy]?.name || `P${Number(entry.claimedBy) + 1}`;
        return `${victimName} (claimed by ${claimantName})`;
      })
      .join(', ');
    if (total > 0) {
      const skipNotice = skippedDetails ? ` Skipped ${skippedDetails}.` : '';
      this._logActivity(`${ownerName} drained ${formatCompact(total)}${details ? ` (${details})` : ''}.${skipNotice}`);
      this.info.setText(`${ownerName} used Score Drain`);
    } else if (skippedDetails) {
      this._logActivity(`${ownerName}'s Score Drain found no available targets. Skipped ${skippedDetails}.`);
      this.info.setText(`${ownerName}'s Score Drain was blocked`);
    }
  }

  onPrediction(payload = {}) {
    if (!Array.isArray(payload.prediction) || !payload.prediction.length) return;
    if (this.localPlayerIndex === null || this.currentPlayerIndex !== this.localPlayerIndex) return;
    this.prediction = payload.prediction.slice();
    this.predictionText.setText(`Prediction: ${this.prediction.join(', ')}`);
  }

  // -----------------------
  // Helpers
  // -----------------------
  computeTeamScores() {
    if (!this.gameConfig.teams) return null;
    const totals = { blue: 0, red: 0 };
    this.playerSlots.forEach((player, index) => {
      const score = Number(this.scores[index]) || 0;
      if (player?.team === 'blue') totals.blue += score;
      if (player?.team === 'red') totals.red += score;
    });
    return totals;
  }

  updateTeamDisplay() {
    if (!this.teamScoreText) return;
    if (!this.gameConfig.teams) {
      this.teamScoreText.setText('').setVisible(false);
      return;
    }
    const totals = this.teamScores || this.computeTeamScores() || { blue: 0, red: 0 };
    this.teamScoreText.setText(`Blue: ${totals.blue}  •  Red: ${totals.red}`).setVisible(true);
  }

  makeDefaultComboStats(n) {
    const template = () => ({
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
    });
    return Array.from({ length: n }, () => template());
  }

  comboRulesEnabled() {
    return true;
  }

  _formatMultiplier(value, decimals = 1) {
    if (!Number.isFinite(value)) return '0';
    const abs = Math.abs(value);
    if (abs >= 1000) return formatCompact(value);
    return value.toFixed(decimals);
  }

  applyBonus(dice, baseScore) {
    if (!this.comboRulesEnabled()) return baseScore;
    const combo = checkCombo(dice);
    if (combo) return Math.floor(baseScore * (combo.multiplier || 1));
    return baseScore;
  }

  diceScoringDisplay(dice = [], scored, extra = {}) {
    if (!Array.isArray(dice) || dice.length === 0) {
      this.scoreBreakdown.setText('');
      this.scoreBreakdown.setAlpha(0);
      return;
    }

    const base = dice.reduce((a, b) => a + b, 0);
    const combo = extra.combo || checkCombo(dice);
    const diceMultiplier = Number(extra.diceMultiplier || 1);
    const comboBreakdown = extra.comboBreakdown || null;
    const progression = extra.progression || null;
    const workingBase = base * diceMultiplier;

    const lines = [];
    lines.push(`Rolled: ${dice.join(', ')}`);
    lines.push(`Base Score: ${base}`);

    if (diceMultiplier !== 1) {
      lines.push(`Roll Multiplier: x${this._formatMultiplier(diceMultiplier, 2)} = ${formatCompact(Math.floor(workingBase))}`);
    }

    if (this.comboRulesEnabled() && combo) {
      let comboName = COMBO_DISPLAY_NAMES?.[combo.key] || combo.type || combo.key || 'Combo';
      if (combo.key === 'straight') comboName = combo.type || comboName;

      const level = Number(comboBreakdown?.level ?? progression?.comboLevels?.[combo.key] ?? 0);
      const baseMultiplier = Number(comboBreakdown?.baseMultiplier ?? combo.multiplier ?? 1);
      const upgradeMultiplier = Number(comboBreakdown?.upgradeMultiplier ?? (1 + level * 0.1));
      const globalMultiplier = Number(comboBreakdown?.globalMultiplier ?? progression?.comboGlobalMultiplier ?? 1);
      const streak = Math.max(1, Number(comboBreakdown?.streak ?? 1));
      const streakMultiplier = Number(comboBreakdown?.streakMultiplier ?? 1);
      const totalComboMultiplier = Number(
        comboBreakdown?.totalMultiplier ??
        extra.comboMultiplier ??
        (baseMultiplier * upgradeMultiplier * globalMultiplier * streakMultiplier)
      );

      lines.push(`Combo: ${comboName} (Level ${level}: x${this._formatMultiplier(upgradeMultiplier * globalMultiplier, 2)})`);
      const comboUpgradePercent = Number(comboBreakdown?.comboUpgradePercent ?? progression?.comboUpgradePercent ?? 0);
      if (comboUpgradePercent > 0) {
        const mode = (comboBreakdown?.comboUpgradeIsMultiplicative ?? progression?.comboUpgradeIsMultiplicative) ? ' (multiplicative)' : '';
        lines.push(`Combo Upgrader: +${(comboUpgradePercent * 100).toFixed(0)}% per level${mode}`);
      }
      lines.push(`Base Multiplier: x${this._formatMultiplier(baseMultiplier, 2)}`);

      if (streakMultiplier !== 1) {
        const streakLabel = comboBreakdown?.streakLabel || progression?.comboStreakLabel || 'Combo Streak';
        const bonusPct = (streakMultiplier * 100 - 100).toFixed(0);
        lines.push(`- ${streakLabel}: ${streak} (${bonusPct}%)`);
        lines.push(`  -> Streak Multiplier: x${this._formatMultiplier(streakMultiplier, 2)}`);
      }

      lines.push(`Total Combo Multiplier: x${this._formatMultiplier(totalComboMultiplier, 2)}`);
      const spinBonus = Number(extra.rollicaneBonus) || 0;
      if (spinBonus > 0) lines.push(`Dice Spin: +${formatCompact(spinBonus)}`);
      const calculatedScore = Math.floor(workingBase * totalComboMultiplier) + spinBonus;
      lines.push(`Final Score: ${formatCompact(typeof scored === 'number' ? scored : calculatedScore)}`);
    } else {
      const spinBonus = Number(extra.rollicaneBonus) || 0;
      if (spinBonus > 0) lines.push(`Dice Spin: +${formatCompact(spinBonus)}`);
      const finalScore = typeof scored === 'number' ? scored : Math.floor(workingBase) + spinBonus;
      lines.push(`Final Score: ${formatCompact(finalScore)}`);
    }

    this.scoreBreakdown.setText(lines.join('\n'));
    try {
      this.scoreBreakdown.setAlpha(0);
      this.tweens.killTweensOf(this.scoreBreakdown);
      this.tweens.add({
        targets: this.scoreBreakdown,
        alpha: 1,
        duration: 220,
        ease: 'Cubic.easeOut'
      });
    } catch (e) {
      // ignore tween failures in headless / fallback cases
    }

    if (this._scoreDisplayTimer) this._scoreDisplayTimer.remove(false);
    this._scoreDisplayTimer = this.time.delayedCall(4200, () => {
      if (this.scoreBreakdown) {
        try {
          this.tweens.add({
            targets: this.scoreBreakdown,
            alpha: 0,
            duration: 300,
            onComplete: () => this.scoreBreakdown.setText('')
          });
        } catch (e) {
          this.scoreBreakdown.setText('');
        }
      }
      this._scoreDisplayTimer = null;
    });
  }

  updateRoundTitle() {
    this.roundTitle.setText(`Online Game — Round ${this.currentRound}/${this.gameConfig.rounds}`);
  }

  // -----------------------
  // Turn timer (client display only)
  // -----------------------
  startTurnTimer(seconds, expireAt = null) {
    this.clearTurnTimer();

    let remaining = seconds;

    // If server provided an expireAt timestamp (ms), compute remaining
    if (expireAt && typeof expireAt === 'number') {
      const remMs = Math.max(0, expireAt - Date.now());
      remaining = Math.ceil(remMs / 1000);
    }

    this.timerText.setText(`Time: ${remaining}s`);

    // Use Phaser timed event to tick every second so every client shows a countdown
    this.turnTimer = this.time.addEvent({
      delay: 1000,
      repeat: Math.max(0, remaining - 1),
      callback: () => {
        remaining--;
        this.timerText.setText(`Time: ${remaining}s`);
        if (remaining <= 0) {
          // The server timer is authoritative and will auto-roll.
          this.clearTurnTimer();
          this.timerText.setText("Time's up");
        }
      }
    });
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      this.turnTimer.remove();
      this.turnTimer = null;
    }
    this.timerText.setText('');
  }

  addBackButton() {
    const back = this.add.text(50, 50, '← Back', {
      fontSize: 24,
      fontFamily: 'Orbitron, Arial',
      color: '#ff6666'
    });
    makeTextButton(back, 130, 40);
    back.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      if (this.exitLocked) {
        this.showConfirmExit();
      } else {
        this.scene.start('OnlineMenuScene');
      }
    });
  }

  showConfirmExit() {
    const bg = this.add.rectangle(600, 300, 500, 250, 0x000000, 0.85);
    const msg = this.add.text(600, 260, 'Are you sure you want to leave the match?\nYou may forfeit.', { fontSize: 22, align: 'center' }).setOrigin(0.5);
    const yesBtn = this.add.text(540, 340, 'Yes', {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial',
      color: '#66ff66'
    }).setOrigin(0.5);
    const noBtn = this.add.text(660, 340, 'No', {
      fontSize: 26,
      fontFamily: 'Orbitron, Arial',
      color: '#ff6666'
    }).setOrigin(0.5);
    makeTextButton(yesBtn, 80, 44);
    makeTextButton(noBtn, 80, 44);

    yesBtn.on('pointerdown', () => {
      // Leaving mid-match is a forfeit; the server marks the player left.
      getSocket().emit('leave-lobby', this.roomCode);
      this.scene.start('OnlineMenuScene');
    });
    noBtn.on('pointerdown', () => {
      bg.destroy(); msg.destroy(); yesBtn.destroy(); noBtn.destroy();
    });
  }

  // -----------------------
  // Cleanup
  // -----------------------
  shutdown() {
    this._sceneReady = false;
    this.closeShop();
    this.closeHistoryLog();
    const s = getSocket();
    if (s && this._handlers) {
      // remove only the handlers we added
      s.off('game-state', this._handlers.gameState);
      s.off('turn-start', this._handlers.turnStart);
      s.off('turn-result', this._handlers.turnResult);
      s.off('player-timeout', this._handlers.playerTimeout);
      s.off('player-left', this._handlers.playerLeft);
      s.off('game-starting', this._handlers.gameStarting);
      s.off('game-finished', this._handlers.gameFinished);
      s.off('lobby-deleted', this._handlers.lobbyDeleted);
      s.off('game-over', this._handlers.gameFinished);
      s.off('player-rolling', this._handlers.playerRolling);
      s.off('end-turn-failed', this._handlers.endTurnFailed);
      s.off('upgrade-result', this._handlers.upgradeResult);
      s.off('upgrade-failed', this._handlers.upgradeFailed);
      s.off('score-drain', this._handlers.scoreDrain);
      s.off('player-prediction', this._handlers.prediction);
      s.off('game-state-denied', this._handlers.stateDenied);
      s.off('auth-required', this._handlers.authRequired);
      s.off('game-failed', this._handlers.gameFailed);
      this._handlers = null;
    } else if (s) {
      // fallback: remove named events completely
      s.off('game-state'); s.off('turn-start'); s.off('turn-result');
      s.off('player-timeout'); s.off('player-left'); s.off('game-starting');
      s.off('game-finished'); s.off('lobby-deleted'); s.off('game-over');
      s.off('player-rolling'); s.off('end-turn-failed'); s.off('upgrade-result');
      s.off('upgrade-failed'); s.off('score-drain'); s.off('player-prediction'); s.off('game-state-denied');
      s.off('auth-required'); s.off('game-failed');
    }
    this.clearTurnTimer();
  }
}