const STORAGE_KEY = 'scaleDice_achievements';

const DEFAULTS = {
  totals: {
    gamesPlayed: 0,
    roundsPlayed: 0,
    bestSingleMatchScore: 0,
  },
  unlocked: {
    firstPlay: false,
    rounds100: false,
    rounds500: false,
    score1000: false,
    score10000: false,
    score100000: false,
    score1000000: false,
    fourOfAKind: false,
    fiveOfAKind: false,
    sixOfAKind: false
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
      scene.events.once('shutdown', () => {
        if (this._scene === scene) this._scene = null;
      });
      scene.events.once('destroy', () => {
        if (this._scene === scene) this._scene = null;
      });
    }

    if (this._scene && this._scene.time) {
      this._maybeDisplayNotifications();
    }
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

  // Totals
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

  unlockComboAchievement(key) {
    this.maybeUnlock(key);
  }

  _checkRoundMilestones() {
    const r = this._data.totals.roundsPlayed || 0;
    if (r >= 100) this.maybeUnlock('rounds100');
    if (r >= 500) this.maybeUnlock('rounds500');
  }

  _checkScoreMilestones() {
    const s = this._data.totals.bestSingleMatchScore || 0;
    if (s >= 1000) this.maybeUnlock('score1000');
    if (s >= 10000) this.maybeUnlock('score10000');
    if (s >= 100000) this.maybeUnlock('score100000');
    if (s >= 1000000) this.maybeUnlock('score1000000');
  }

  // mark unlocked and enqueue notification
  maybeUnlock(key) {
    if (!key) return false;
    if (this._data.unlocked[key]) return false;

    // create key if missing and set
    if (typeof this._data.unlocked[key] === 'undefined') {
      this._data.unlocked[key] = true;
    } else {
      this._data.unlocked[key] = true;
    }

    // enqueue notification (newest at front)
    this._notifications.unshift(key);
    if (this._notifications.length > 200) this._notifications.length = 200;

    this._save();

    // try to display immediately if a scene is registered
    this._maybeDisplayNotifications();

    return true;
  }

  // attempt to display queued notifications using the registered scene (if any)
  _maybeDisplayNotifications() {
    if (!this._notifications || this._notifications.length === 0) return;
    if (!this._scene) return;

    const notifs = this._notifications.slice();
    this._notifications.length = 0;

    if (this._achieveNotificationRunning) {
      try {
        if (this._scene && this._scene.time && typeof this._scene.time.delayedCall === 'function') {
          this._scene.time.delayedCall(200, () => this._displayAchievementSequence(notifs));
        } else {
          this._notifications = notifs.concat(this._notifications);
        }
      } catch (e) {
        this._notifications = notifs.concat(this._notifications);
        console.warn('[Achievements] delayedCall failed, re-queueing notifs', e);
      }
    } else {
      this._displayAchievementSequence(notifs);
    }
  }

  /**
   * Display a sequence of achievement popups.
   * - notifs: array of achievement keys (required)
   * - onComplete: optional callback when finished
   * - sceneOverride: optional Phaser.Scene to use for UI (if provided it'll be used even if no scene was registered)
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
      score1000: { title: "Pilin' Up!", desc: 'Scored 1,000 points in a match.' },
      score10000: { title: "Rackin' Up!", desc: 'Scored 10,000 points in a match.' },
      score100000: { title: 'Hard Labour', desc: 'Scored 100,000 points in a match.' },
      score1000000: { title: 'Millionaire', desc: 'Scored 1,000,000 points in a match.' },
      fourOfAKind: { title: 'Big Shot', desc: 'Rolled a Four-of-a-kind.' },
      fiveOfAKind: { title: 'Perfection', desc: 'Rolled a Five-of-a-kind.' },
      sixOfAKind: { title: 'Diceomania', desc: 'Rolled a Six-of-a-kind.' }
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
      const boxY = 820;
      const boxW = 700;
      const boxH = 70;
      const x = 600;

      let rect, title, desc;
      try {
        rect = displayScene.add.rectangle(x, boxY + 40, boxW, boxH, 0x111111, 0.9).setDepth(1000).setAlpha(0);
        rect.setStrokeStyle(2, 0x66ff66, 1);

        title = displayScene.add.text(x - boxW / 2 + 18, boxY + 19, item.title, { fontSize: 20, fontFamily: 'Orbitron, Arial', color: '#66ff66' }).setDepth(1001);
        desc = displayScene.add.text(x - boxW / 2 + 18, boxY + 40, item.desc, { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setDepth(1001);

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

      const hold = 1400;
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
                displayScene.time.delayedCall(150, () => displayOne(idx + 1));
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
}

const GlobalAchievements = new AchievementsManager();
export default GlobalAchievements;