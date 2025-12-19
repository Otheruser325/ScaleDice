const STORAGE_KEY = 'scaleDice_achievements';

const DEFAULTS = {
  totals: {
    gamesPlayed: 0,
    roundsPlayed: 0,
    bestSingleMatchScore: 0,
    playTimeSeconds: 0,
    straightsRolled: 0,
	wins: 0
  },
  unlocked: {
    firstPlay: false,
    rounds100: false,
    rounds500: false,
	rounds2500: false,
    score1000: false,
    score10000: false,
    score100000: false,
    score1000000: false,
    score10000000: false,
    fourOfAKind: false,
    fiveOfAKind: false,
    sixOfAKind: false,
    addiction: false,
    diceaholic: false,
    funHouse: false,
    roundhouseStraight: false,
    maximumPower: false,
	winnerWinner: false,
    realDicetician: false,
    boomDicealaka: false
  }
};

class AchievementsManager {
  constructor() {
    this._data = this._load() || JSON.parse(JSON.stringify(DEFAULTS));
    this._notifications = [];
    this._achieveNotificationRunning = false;
    this._scene = null;
  }

  // allow a scene to be registered for UI display. Pass `null` to unregister.
  registerScene(scene) {
    this._scene = scene || null;

    if (scene && scene.events && typeof scene.events.once === 'function') {
      scene.events.once('shutdown', () => { if (this._scene === scene) this._scene = null; });
      scene.events.once('destroy', () => { if (this._scene === scene) this._scene = null; });
    }

    // Start global playtime heartbeat if not already
    if (!this._playHeartbeatStarted) {
      this._startPlayHeartbeat();
    }

    // Try flush queued notifications
    this._maybeDisplayNotifications();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[Achievements] failed to load', e);
      return null;
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
    } catch (e) {
      console.warn('[Achievements] failed to save', e);
    }
  }

  getAll() {
    return this._data;
  }

  // Read & clear notifications (returns array of achievement keys)
  getNotifications() {
    const copy = this._notifications.slice();
    this._notifications.length = 0;
    return copy;
  }

  // ---- Totals / recorders ----
  addGame() {
    this._data.totals.gamesPlayed = (this._data.totals.gamesPlayed || 0) + 1;
    this.maybeUnlock('firstPlay');
    this._save();
  }

  addRounds(n) {
    n = Math.max(0, Math.floor(n || 0));
    this._data.totals.roundsPlayed = (this._data.totals.roundsPlayed || 0) + n;
    this._checkRoundMilestones();
    this._save();
  }

  addMatchScore(score) {
    score = Math.max(0, Math.floor(score || 0));
    this._data.totals.bestSingleMatchScore = Math.max(this._data.totals.bestSingleMatchScore || 0, score);
    this._checkScoreMilestones();
    this._save();
  }
  
  addWin(n = 1) {
    n = Math.max(0, Math.floor(n || 1));
    this._data.totals.wins = (this._data.totals.wins || 0) + n;
    if (this._data.totals.wins >= 1) this.maybeUnlock('winnerWinner');
    if (this._data.totals.wins >= 10) this.maybeUnlock('realDicetician');
    this._save();
  }

  // add total play seconds (called when session ends or on regular heartbeat if you want)
  addPlaySeconds(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    this._data.totals.playTimeSeconds = (this._data.totals.playTimeSeconds || 0) + seconds;
    this._checkTimeMilestones();
    this._save();
  }

  // increment global straights counter (for Roundhouse Straight)
  addStraights(n = 1) {
    n = Math.max(0, Math.floor(n || 1));
    this._data.totals.straightsRolled = (this._data.totals.straightsRolled || 0) + n;
    this._checkStraightMilestone();
    this._save();
  }

  // Mark an existing combo-based achievement - convenience wrapper
  unlockComboAchievement(key) {
    this.maybeUnlock(key);
  }

  // Checkers
  _checkRoundMilestones() {
    const r = this._data.totals.roundsPlayed || 0;
    if (r >= 100) this.maybeUnlock('rounds100');
    if (r >= 500) this.maybeUnlock('rounds500');
	if (r >= 2500) this.maybeUnlock('rounds2500');
  }

  _checkScoreMilestones() {
    const s = this._data.totals.bestSingleMatchScore || 0;
    if (s >= 1000) this.maybeUnlock('score1000');
    if (s >= 10000) this.maybeUnlock('score10000');
    if (s >= 100000) this.maybeUnlock('score100000');
    if (s >= 1000000) this.maybeUnlock('score1000000');
    if (s >= 10000000) this.maybeUnlock('score10000000');
  }

  _checkTimeMilestones() {
    const t = this._data.totals.playTimeSeconds || 0;
    if (t >= 3600) this.maybeUnlock('addiction');
    if (t >= 12 * 3600) this.maybeUnlock('diceaholic');
  }

  _checkStraightMilestone() {
    const s = this._data.totals.straightsRolled || 0;
    if (s >= 10) this.maybeUnlock('roundhouseStraight');
  }

  // mark unlocked and enqueue notification
  maybeUnlock(key) {
    if (!key) return false;
    if (this._data.unlocked[key]) return false;
    if (typeof this._data.unlocked[key] === 'undefined') {
      this._data.unlocked[key] = true;
    } else {
      this._data.unlocked[key] = true;
    }

    this._notifications.unshift(key);
    if (this._notifications.length > 200) this._notifications.length = 200;
    this._save();
    this._maybeDisplayNotifications();

    return true;
  }

  // attempt to display queued notifications using the registered scene (if any)
  _maybeDisplayNotifications() {
    if (!this._notifications || this._notifications.length === 0) return;
    if (!this._scene) return;
    if (this._achieveNotificationRunning) {
      try {
        this._scene.time.delayedCall(200, () => this._maybeDisplayNotifications());
      } catch (e) {}
      return;
    }
    const notifs = this._notifications.slice();
    this._notifications.length = 0;
    this._displayAchievementSequence(notifs);
  }

  /**
   * Display a sequence of achievement popups.
   * - notifs: array of achievement keys (required)
   * - onComplete: optional callback when finished
   * - sceneOverride: optional Phaser.Scene to use for UI (useful for mid-game popups)
   */
  _displayAchievementSequence(notifs, onComplete, sceneOverride) {
    if (!Array.isArray(notifs) || notifs.length === 0) {
      if (onComplete) onComplete();
      return;
    }

    const displayScene = sceneOverride || this._scene;
    if (!displayScene) {
      this._notifications = notifs.concat(this._notifications);
      if (onComplete) onComplete();
      return;
    }

    const meta = {
      firstPlay: { title: "I'm New to This", desc: 'Played Scale Dice for the first time.' },
      rounds100: { title: 'Late Warrior', desc: 'Progressed 100 rounds total.' },
      rounds500: { title: 'Late Nights', desc: 'Progressed 500 rounds total.' },
	  rounds2500: { title: 'Forever Going', desc: 'Progressed 2,500 rounds total.' },
      score1000: { title: "Pilin' Up!", desc: 'Scored 1,000 points in a local/online game.' },
      score10000: { title: "Rackin' Up!", desc: 'Scored 10,000 points in a local/online game.' },
      score100000: { title: 'Hard Labour', desc: 'Scored 100,000 points in a local/online game.' },
      score1000000: { title: 'Millionaire', desc: 'Scored 1,000,000 points in a local/online game.' },
      score10000000: { title: 'Strike It Dice', desc: 'Scored 10,000,000 points in a local/online game.' },
      strikeItDice: { title: 'Strike It Dice', desc: 'Scored 10,000,000 points in a local/online game.' },
      fourOfAKind: { title: 'Big Shot', desc: 'Rolled a Four-of-a-kind combo.' },
      fiveOfAKind: { title: 'Perfection', desc: 'Rolled a Five-of-a-kind combo.' },
      sixOfAKind: { title: 'Diceomania', desc: 'Rolled a Six-of-a-kind combo.' },
      addiction: { title: 'Addicted', desc: 'Played Scale Dice for 1 hour total.' },
      diceaholic: { title: 'Diceaholic', desc: 'Played Scale Dice for 12 hours total.' },
      funHouse: { title: 'Fun House', desc: 'Rolled 5 consecutive full houses or power houses in a game.' },
      roundhouseStraight: { title: 'Roundhouse Straight', desc: 'Rolled 10 straights in total.' },
      maximumPower: { title: 'Maximum Power', desc: 'Fully upgraded everything (dice, economy, luck, major) in a game.' },
	  winnerWinner: { title: 'Winner Winner', desc: 'Win your first match.' },
      realDicetician: { title: 'Real Dicetician', desc: 'Win 10 matches.' },
      boomDicealaka: { title: 'Boom Dicealaka', desc: 'Score over 10,000 points with one roll.' }
    };

    this._achieveNotificationRunning = true;

    const displayOne = (idx) => {
      if (!displayScene || !displayScene.add) {
        const remainder = notifs.slice(idx);
        this._notifications = remainder.concat(this._notifications);
        this._achieveNotificationRunning = false;
        if (onComplete) onComplete();
        return;
      }

      if (idx >= notifs.length) {
        this._achieveNotificationRunning = false;
        if (onComplete) onComplete();
        return;
      }

      const key = notifs[idx];
      const item = meta[key] || { title: key, desc: '' };

      // popup coordinates
      const boxY = displayScene.cameras.main.height - 120;
      const boxW = Math.min(800, displayScene.cameras.main.width - 120);
      const boxH = 72;
      const x = displayScene.cameras.main.centerX;

      let rect, title, desc;
      try {
        rect = displayScene.add.rectangle(x, boxY + 40, boxW, boxH, 0x111111, 0.95).setDepth(1000).setAlpha(0);
        rect.setStrokeStyle(2, 0x66ff66, 1);

        title = displayScene.add.text(x - boxW / 2 + 18, boxY + 12, item.title, { fontSize: 20, fontFamily: 'Orbitron, Arial', color: '#66ff66' }).setDepth(1001);
        desc = displayScene.add.text(x - boxW / 2 + 18, boxY + 36, item.desc, { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setDepth(1001);

        displayScene.tweens.add({
          targets: [rect, title, desc],
          y: `-=${40}`,
          alpha: 1,
          duration: 260,
          ease: 'Cubic.easeOut',
        });
      } catch (e) {
        const remainder = notifs.slice(idx);
        this._notifications = remainder.concat(this._notifications);
        this._achieveNotificationRunning = false;
        if (onComplete) onComplete();
        return;
      }

      const hold = 1500;
      try {
        displayScene.time.delayedCall(hold, () => {
          if (!displayScene || !displayScene.tweens) {
            const remainder = notifs.slice(idx + 1);
            this._notifications = remainder.concat(this._notifications);
            this._achieveNotificationRunning = false;
            if (onComplete) onComplete();
            return;
          }

          displayScene.tweens.add({
            targets: [rect, title, desc],
            y: `+=40`,
            alpha: 0,
            duration: 260,
            ease: 'Cubic.easeIn',
            onComplete: () => {
              try { rect.destroy(); } catch (e) {}
              try { title.destroy(); } catch (e) {}
              try { desc.destroy(); } catch (e) {}
              try {
                displayScene.time.delayedCall(130, () => displayOne(idx + 1));
              } catch (e) {
                const remainder = notifs.slice(idx + 1);
                this._notifications = remainder.concat(this._notifications);
                this._achieveNotificationRunning = false;
                if (onComplete) onComplete();
              }
            }
          });
        });
      } catch (e) {
        const remainder = notifs.slice(idx);
        this._notifications = remainder.concat(this._notifications);
        this._achieveNotificationRunning = false;
        if (onComplete) onComplete();
        return;
      }
    };

    displayOne(0);
  }
  
  // ---------- playtime heartbeat (global) ----------
  _startPlayHeartbeat() {
    if (this._playHeartbeatStarted) return;
    this._playHeartbeatStarted = true;
    this._heartbeatId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.addPlaySeconds(1);
      }
    }, 1000);
	
    window.addEventListener('beforeunload', () => { this._save(); });
  }

  _bindVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this._maybeDisplayNotifications();
      }
    });
  }
}

const GlobalAchievements = new AchievementsManager();
export default GlobalAchievements;