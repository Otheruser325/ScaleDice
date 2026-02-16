import GlobalLocalization from './LocalizationManager.js';

const STORAGE_KEY = 'scaleDice_achievements';

export const ACHIEVEMENT_DEFS = [
  { key: 'firstPlay', titleKey: 'ACH_FIRSTPLAY_TITLE', descKey: 'ACH_FIRSTPLAY_DESC', title: "I'm New to This", desc: 'Play Scale Dice for the first time.' },
  { key: 'wins1', titleKey: 'ACH_WINS_1_TITLE', descKey: 'ACH_WINS_1_DESC', title: 'Winner Winner', desc: 'Win your first match.' },
  { key: 'wins10', titleKey: 'ACH_WINS_10_TITLE', descKey: 'ACH_WINS_10_DESC', title: 'Real Dicetician', desc: 'Win 10 matches.' },
  { key: 'wins50', titleKey: 'ACH_WINS_50_TITLE', descKey: 'ACH_WINS_50_DESC', title: 'Veteran Player', desc: 'Win 50 matches.' },
  { key: 'rounds100', titleKey: 'ACH_ROUNDS_100_TITLE', descKey: 'ACH_ROUNDS_100_DESC', title: 'Late Warrior', desc: 'Progress 100 rounds in total.' },
  { key: 'rounds500', titleKey: 'ACH_ROUNDS_500_TITLE', descKey: 'ACH_ROUNDS_500_DESC', title: 'Late Nights', desc: 'Progress 500 rounds in total.' },
  { key: 'rounds2500', titleKey: 'ACH_ROUNDS_2500_TITLE', descKey: 'ACH_ROUNDS_2500_DESC', title: 'Forever Going', desc: 'Progress 2,500 rounds in total.' },
  { key: 'time1h', titleKey: 'ACH_TIME_1H_TITLE', descKey: 'ACH_TIME_1H_DESC', title: 'Addiction', desc: 'Play Scale Dice for 1 hour total.' },
  { key: 'time12h', titleKey: 'ACH_TIME_12H_TITLE', descKey: 'ACH_TIME_12H_DESC', title: 'Diceaholic', desc: 'Play Scale Dice for 12 hours total.' },
  { key: 'time24h', titleKey: 'ACH_TIME_24H_TITLE', descKey: 'ACH_TIME_24H_DESC', title: 'Neverending Experience', desc: 'Play Scale Dice for 24 hours total.' },
  { key: 'daily1', titleKey: 'ACH_DAILY_1_TITLE', descKey: 'ACH_DAILY_1_DESC', title: 'Challenger', desc: 'Win a daily challenge.' },
  { key: 'daily10', titleKey: 'ACH_DAILY_10_TITLE', descKey: 'ACH_DAILY_10_DESC', title: 'Problem Solver', desc: 'Win 10 daily challenges.' },
  { key: 'score1000', titleKey: 'ACH_SCORE_1000_TITLE', descKey: 'ACH_SCORE_1000_DESC', title: "Pilin' Up!", desc: 'Score 1,000 points in a local/online game.' },
  { key: 'score10000', titleKey: 'ACH_SCORE_10000_TITLE', descKey: 'ACH_SCORE_10000_DESC', title: "Rackin' Up!", desc: 'Score 10,000 points in a local/online game.' },
  { key: 'score100000', titleKey: 'ACH_SCORE_100000_TITLE', descKey: 'ACH_SCORE_100000_DESC', title: 'Hard Labour', desc: 'Score 100,000 points in a local/online game.' },
  { key: 'score1000000', titleKey: 'ACH_SCORE_1000000_TITLE', descKey: 'ACH_SCORE_1000000_DESC', title: 'Millionaire', desc: 'Score 1,000,000 points in a local/online game.' },
  { key: 'score10000000', titleKey: 'ACH_SCORE_10000000_TITLE', descKey: 'ACH_SCORE_10000000_DESC', title: 'Strike It Dice', desc: 'Score 10,000,000 points in a local/online game.' },
  { key: 'fourOfAKind', titleKey: 'ACH_FOUR_OF_A_KIND_TITLE', descKey: 'ACH_FOUR_OF_A_KIND_DESC', title: 'Big Shot', desc: 'Roll a Four-of-a-kind combo.' },
  { key: 'fiveOfAKind', titleKey: 'ACH_FIVE_OF_A_KIND_TITLE', descKey: 'ACH_FIVE_OF_A_KIND_DESC', title: 'Perfection', desc: 'Roll a Five-of-a-kind combo.' },
  { key: 'sixOfAKind', titleKey: 'ACH_SIX_OF_A_KIND_TITLE', descKey: 'ACH_SIX_OF_A_KIND_DESC', title: 'Diceomania', desc: 'Roll a Six-of-a-kind combo.' },
  { key: 'funHouse', titleKey: 'ACH_FUN_HOUSE_TITLE', descKey: 'ACH_FUN_HOUSE_DESC', title: 'Fun House', desc: 'Roll 5 consecutive full/power house combos in a game.' },
  { key: 'roundhouseStraight', titleKey: 'ACH_ROUNDHOUSE_STRAIGHT_TITLE', descKey: 'ACH_ROUNDHOUSE_STRAIGHT_DESC', title: 'Roundhouse Straight', desc: 'Roll 10 straights in total.' },
  { key: 'boomDicealaka', titleKey: 'ACH_BOOM_DICEALAKA_TITLE', descKey: 'ACH_BOOM_DICEALAKA_DESC', title: 'Boom Dicealaka', desc: 'Score over 10,000 points with one roll.' },
  { key: 'maximumPower', titleKey: 'ACH_MAX_POWER_TITLE', descKey: 'ACH_MAX_POWER_DESC', title: 'Maximum Power', desc: 'Fully upgrade everything (dice, economy, luck, major) in a game.' }
];

const DEFAULTS = {
  totals: {
    gamesPlayed: 0,
    roundsPlayed: 0,
    bestSingleMatchScore: 0,
    playTimeSeconds: 0,
    straightsRolled: 0,
	  wins: 0,
    dailyChallengeWins: 0
  },
  unlocked: {
    firstPlay: false,
    wins1: false,
    wins10: false,
    wins50: false,
    rounds100: false,
    rounds500: false,
    rounds2500: false,
    time1h: false,
    time12h: false,
    time24h: false,
    daily1: false,
    daily10: false,
    score1000: false,
    score10000: false,
    score100000: false,
    score1000000: false,
    score10000000: false,
    fourOfAKind: false,
    fiveOfAKind: false,
    sixOfAKind: false,
    funHouse: false,
    roundhouseStraight: false,
    boomDicealaka: false,
    maximumPower: false
  },
  completedChallenges: {
    daily: false,
    deucifer: false
  }
};

class AchievementsManager {
  static _data = null;
  static _notifications = [];
  static _achieveNotificationRunning = false;
  static _scene = null;
  static _playHeartbeatStarted = false;
  static _heartbeatId = null;

  // Initialize static data
  static {
    AchievementsManager._data = AchievementsManager._load() || JSON.parse(JSON.stringify(DEFAULTS));
    if (!AchievementsManager._data.completedChallenges) {
      AchievementsManager._data.completedChallenges = JSON.parse(JSON.stringify(DEFAULTS.completedChallenges));
    }
    AchievementsManager._migrateLegacyAchievementKeys();
  }

  // allow a scene to be registered for UI display. Pass `null` to unregister.
  static registerScene(scene) {
    this._scene = scene || null;

    if (scene && scene.events && typeof scene.events.once === 'function') {
      scene.events.once('shutdown', () => { if (this._scene === scene) this._scene = null; });
      scene.events.once('destroy', () => { if (this._scene === scene) this._scene = null; });
    }

    // Start global playtime heartbeat if not already
    if (!this._playHeartbeatStarted) {
      this._startPlayHeartbeat();
    }
  }

  static _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[Achievements] failed to load', e);
      return null;
    }
  }

  static _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
    } catch (e) {
      console.warn('[Achievements] failed to save', e);
    }
  }

  static getAll() {
    return this._data;
  }

  // Read & clear notifications (returns array of achievement keys)
  static getNotifications() {
    const copy = this._notifications.slice();
    this._notifications.length = 0;
    return copy;
  }

  // ---- Totals / recorders ----
  static addGame() {
    this._data.totals.gamesPlayed = (this._data.totals.gamesPlayed || 0) + 1;
    this.maybeUnlock('firstPlay');
    this._save();
  }

  static addRounds(n) {
    n = Math.max(0, Math.floor(n || 0));
    this._data.totals.roundsPlayed = (this._data.totals.roundsPlayed || 0) + n;
    this._checkRoundMilestones();
    this._save();
  }

  static addMatchScore(score) {
    score = Math.max(0, Math.floor(score || 0));
    this._data.totals.bestSingleMatchScore = Math.max(this._data.totals.bestSingleMatchScore || 0, score);
    this._checkScoreMilestones();
    this._save();
  }
  
  static addWin(n = 1) {
    n = Math.max(0, Math.floor(n || 1));
    this._data.totals.wins = (this._data.totals.wins || 0) + n;
    if (this._data.totals.wins >= 1) this.maybeUnlock('wins1');
    if (this._data.totals.wins >= 10) this.maybeUnlock('wins10');
    if (this._data.totals.wins >= 50) this.maybeUnlock('wins50');
    this._save();
  }

  // add total play seconds (called when session ends or on regular heartbeat if you want)
  static addPlaySeconds(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    this._data.totals.playTimeSeconds = (this._data.totals.playTimeSeconds || 0) + seconds;
    this._checkTimeMilestones();
    this._save();
  }

  // increment global straights counter (for Roundhouse Straight)
  static addStraights(n = 1) {
    n = Math.max(0, Math.floor(n || 1));
    this._data.totals.straightsRolled = (this._data.totals.straightsRolled || 0) + n;
    this._checkStraightMilestone();
    this._save();
  }

  // Mark an existing combo-based achievement - convenience wrapper
  static unlockComboAchievement(key) {
    this.maybeUnlock(key);
  }

  // Complete a challenge
  static completeChallenge(key) {
    if (!key) return;
    if (!this._data.completedChallenges) {
      this._data.completedChallenges = {};
    }
    if (!this._data.completedChallenges[key]) {
      this._data.completedChallenges[key] = true;
    }

    if (key === 'daily') {
      this._data.totals.dailyChallengeWins = (this._data.totals.dailyChallengeWins || 0) + 1;
      if (this._data.totals.dailyChallengeWins >= 1) this.maybeUnlock('daily1');
      if (this._data.totals.dailyChallengeWins >= 10) this.maybeUnlock('daily10');
    }

    this._save();
  }

  // Check if challenge completed
  static isChallengeCompleted(key) {
    return (this._data.completedChallenges && this._data.completedChallenges[key]) || false;
  }

  // Checkers
  static _checkRoundMilestones() {
    const r = this._data.totals.roundsPlayed || 0;
    if (r >= 100) this.maybeUnlock('rounds100');
    if (r >= 500) this.maybeUnlock('rounds500');
	if (r >= 2500) this.maybeUnlock('rounds2500');
  }

  static _checkScoreMilestones() {
    const s = this._data.totals.bestSingleMatchScore || 0;
    if (s >= 1000) this.maybeUnlock('score1000');
    if (s >= 10000) this.maybeUnlock('score10000');
    if (s >= 100000) this.maybeUnlock('score100000');
    if (s >= 1000000) this.maybeUnlock('score1000000');
    if (s >= 10000000) this.maybeUnlock('score10000000');
  }

  static _checkTimeMilestones() {
    const t = this._data.totals.playTimeSeconds || 0;
    if (t >= 3600) this.maybeUnlock('time1h');
    if (t >= 12 * 3600) this.maybeUnlock('time12h');
    if (t >= 24 * 3600) this.maybeUnlock('time24h');
  }

  static _migrateLegacyAchievementKeys() {
    const unlocked = this._data.unlocked || {};
    const totals = this._data.totals || {};

    if (unlocked.addiction || unlocked.time_3600) unlocked.time1h = true;
    if (unlocked.diceaholic || unlocked.time_43200) unlocked.time12h = true;
    if (unlocked.time_86400) unlocked.time24h = true;

    if (unlocked.winnerWinner || unlocked.wins_1 || unlocked.wins1) unlocked.win1 = true;
    if (unlocked.realDicetician || unlocked.wins_10 || unlocked.wins10) unlocked.win10 = true;
    if (unlocked.wins_50 || unlocked.wins50) unlocked.win50 = true;

    if ((totals.wins || 0) >= 1) unlocked.win1 = true;
    if ((totals.wins || 0) >= 10) unlocked.win10 = true;
    if ((totals.wins || 0) >= 50) unlocked.win50 = true;

    delete unlocked.addiction;
    delete unlocked.diceaholic;
    delete unlocked.winnerWinner;
    delete unlocked.realDicetician;
    delete unlocked.time_3600;
    delete unlocked.time_43200;
    delete unlocked.time_86400;
    delete unlocked.wins_1;
    delete unlocked.wins_10;
    delete unlocked.wins_50;
    delete unlocked.wins1;
    delete unlocked.wins10;
    delete unlocked.wins50;

    this._data.unlocked = { ...DEFAULTS.unlocked, ...unlocked };
    this._data.totals = { ...DEFAULTS.totals, ...totals };
    this._save();
  }

  static _checkStraightMilestone() {
    const s = this._data.totals.straightsRolled || 0;
    if (s >= 10) this.maybeUnlock('roundhouseStraight');
  }

  // mark unlocked and enqueue notification
  static maybeUnlock(key) {
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
  static _maybeDisplayNotifications() {
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
  static _displayAchievementSequence(notifs, onComplete, sceneOverride) {
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

    const t = (key, fallback) => GlobalLocalization.t(key, fallback);
    const meta = {};
    ACHIEVEMENT_DEFS.forEach((def) => {
      meta[def.key] = {
        title: t(def.titleKey, def.title),
        desc: t(def.descKey, def.desc)
      };
    });

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
  static _startPlayHeartbeat() {
    if (this._playHeartbeatStarted) return;
    this._playHeartbeatStarted = true;
    this._heartbeatId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.addPlaySeconds(1);
      }
    }, 1000);
	
    window.addEventListener('beforeunload', () => { this._save(); });
  }

  static _bindVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this._maybeDisplayNotifications();
      }
    });
  }
}

const GlobalAchievements = AchievementsManager;
export default GlobalAchievements;


