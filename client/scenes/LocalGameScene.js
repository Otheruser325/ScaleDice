import { animateDiceRoll, animateDiceSpin } from '../utils/AnimationManager.js';
import { COMBO_BASE_MULT, COMBO_DISPLAY_NAMES, checkCombo, showComboText, playComboFX } from '../utils/ComboManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalDebug from '../utils/DebugManager.js';
import DiceManager from '../utils/DiceManager.js';
import GlobalErrors from '../utils/ErrorManager.js';
import { formatCompact, formatCompactFull } from '../utils/FormatManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';
import UpgradeManager from '../utils/UpgradeManager.js';

export default class LocalGameScene extends Phaser.Scene {
  constructor() {
    super('LocalGameScene');
  }

  init(data) {
    this.playerCount = data.players ?? 2;
    this.maxRounds = data.rounds ?? 30;
    this.costMult = data.costMult ?? 1;
    this.teamsEnabled = data.teamsEnabled ?? false;
    this.teams = data.teams ?? Array.from({ length: this.playerCount }, (_, i) => 'blue');
    this.bigUpgradesEnabled = data.bigUpgradesEnabled ?? true;
    this.bigUpgradeSortAsc = !!data.bigUpgradeSortAsc;
    this.bigUpgradeSortDesc = !!data.bigUpgradeSortDesc;
    this.challengeKey = data.challengeKey || null;
    this.challengeDate = data.challengeDate || null;
    this.challengeReward = data.challengeReward || 0;

    this.players = Array.from({ length: this.playerCount }, (_, i) => ({
      name: (data.names && data.names[i]) || `P${i + 1}`,
      isAI: (data.ai && data.ai[i]) ?? (i !== 0),
      difficulty: (data.difficulty && data.difficulty[i]) || 'Medium',
      score: 0,
      diceUnlocked: 1,
      luck: this.getInitialLuck((data.ai && data.ai[i]) ?? (i !== 0), (data.difficulty && data.difficulty[i]) || 'Medium'),
      upgrades: new UpgradeManager(),
      team: this.teams[i] ?? 'blue',
      lastRoll: []
    }));

    if (this.challengeKey === 'highStakes') {
      this.players.forEach(p => {
        if (p?.upgrades?.setEconomyCap) p.upgrades.setEconomyCap(250);
      });
    }

    this.currentPlayerIndex = 0;
    this.currentRound = 1;
    this.isRolling = false;
    this.waitingForResult = false;
    this.diceCosts = [10, 100, 500, 3000, 20000];
    this.teamScoreText = null;
    this.prediction = null;
    this.exitModal = null;
    this.endTurnBtn = null;
    GlobalDebug.setNamespace('LocalGameScene');

    this.playerTints = [
      0x66aaff,
      0xffdd66,
      0x66ff99,
      0xff6666,
      0xffaa44,
      0xee88ff
    ];

    this._lastTurnGivenRoundFor = Array(this.playerCount).fill(0);
    this.behindTracker = Array(this.playerCount).fill(true);
    this._energyBoostGiven = Array(this.playerCount).fill(false);
    this._megaEnergyBoostGiven = false;
    this.comboStats = Array(this.playerCount).fill(null).map(() => ({
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
    }));

    this._consecutiveComboCounter = Array(this.playerCount).fill(0);
    this.dice = new DiceManager();

    this.comboRequirements = {
      pair: 2,
      twoPair: 4,
      triple: 3,
      fullHouse: 5,
      straight: 4,
      fourOfAKind: 4,
      fiveOfAKind: 5,
      threePair: 6,
      tripleTrend: 6,
      powerHouse: 6,
      sixOfAKind: 6
    };

    this.comboMeta = [
      { key: 'pair', req: 2 },
      { key: 'twoPair', req: 4 },
      { key: 'triple', req: 3 },
      { key: 'straight', req: 4 },
      { key: 'fullHouse', req: 5 },
      { key: 'fourOfAKind', req: 4 },
      { key: 'fiveOfAKind', req: 5 },
      { key: 'threePair', req: 6 },
      { key: 'tripleTrend', req: 6 },
      { key: 'powerHouse', req: 6 },
      { key: 'sixOfAKind', req: 6 }
    ];

    this._bigUpgradeDefs = [];
    
    // Use custom big upgrades if provided, otherwise use defaults
    if (data.customBigUpgrades && Array.isArray(data.customBigUpgrades)) {
      this._bigUpgradeDefs = data.customBigUpgrades;
    } else {
      this._bigUpgradeDefs = [
        { key: 'clairvoyance', title: 'Clairvoyance', baseCost: 500 },
        { key: 'stockExchange', title: 'Stock Exchange', baseCost: 1000 },
        { key: 'comboX', title: 'Combo-X', baseCost: 2500 },
        { key: 'masterPredict', title: 'Master Predict', baseCost: 7500 },
        { key: 'fixated', title: 'Fixated', baseCost: 30000 },
        { key: 'highStonks', title: 'High Stonks', baseCost: 60000 },
        { key: 'comboMasher', title: 'Combo Masher', baseCost: 150000 },
        { key: 'rollicane', title: 'Rollicane', baseCost: 400000 }
      ];

      if (this.challengeKey === 'highStakes') {
        this._bigUpgradeDefs.push(
          { key: 'ultraStonks', title: 'Ultra Stonks', baseCost: 750000 },
          { key: 'scoreInvestor', title: 'Score Investor', baseCost: 2000000 },
          { key: 'comboOverclock', title: 'Combo Overclock', baseCost: 6000000 }
        );
      }
    }

    // Normalize defs so default upgrades retain their baseline effects/values.
    try {
      const normalizer = new UpgradeManager();
      if (this.challengeKey === 'highStakes') {
        const challengeKeys = ['ultraStonks', 'scoreInvestor', 'comboOverclock'];
        challengeKeys.forEach((key) => {
          if (!this._bigUpgradeDefs.some(def => def && def.key === key)) {
            const fallbackDef = normalizer.getBigUpgradeDef(key);
            if (fallbackDef) this._bigUpgradeDefs.push(fallbackDef);
          }
        });
      }
      normalizer.setBigUpgradeDefs(this._bigUpgradeDefs);
      this._bigUpgradeDefs = this._bigUpgradeDefs
        .map(def => normalizer.getBigUpgradeDef(def?.key) || def)
        .filter(Boolean);
    } catch (e) {}

    if (this.bigUpgradeSortAsc || this.bigUpgradeSortDesc) {
      this._bigUpgradeDefs = this._bigUpgradeDefs
        .slice()
        .sort((a, b) => {
          const ca = Number.isFinite(a?.baseCost) ? a.baseCost : Infinity;
          const cb = Number.isFinite(b?.baseCost) ? b.baseCost : Infinity;
          if (ca !== cb) return this.bigUpgradeSortDesc ? cb - ca : ca - cb;
          const ta = (a?.title || a?.key || '').toString();
          const tb = (b?.title || b?.key || '').toString();
          return ta.localeCompare(tb);
        });
    }

    this.players.forEach(p => {
      if (p?.upgrades?.setBigUpgradeDefs) {
        p.upgrades.setBigUpgradeDefs(this._bigUpgradeDefs);
      }
    });

    this._t = (key, fallback) => GlobalLocalization.t(key, fallback);
    this._fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
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

    this.headerText = this.add.text(600, 15, this._t('GAME_TITLE', 'Scale Dice'), { fontSize: 22, fontFamily: 'Orbitron, Arial', color: '#cccccc' }).setOrigin(0.5);
    this.roundText = this.add.text(600, 40, this._fmt('GAME_ROUND_LABEL', 'Round {0} / {1}', this.currentRound, this.maxRounds), { fontSize: 28, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);
    this.turnText = this.add.text(600, 72, '', { fontSize: 24, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);
    this.lastRollText = this.add.text(600, 100, '', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffffaa' }).setOrigin(0.5).setDepth(10);
    this.predictionText = this.add.text(600, 115, '', { fontSize: 16, fontFamily: 'Orbitron, Arial', color: '#88ff88' }).setOrigin(0.5);

    this.diceSprites = [];
    for (let i = 0; i < 6; i++) {
      const die = this.add.image(350 + i * 90, 360, 'dice1').setVisible(false);
      die.originalX = die.x;
      die.originalY = die.y;
      this.diceSprites.push(die);
    }

    this.rollBtn = this.add.text(600, 470, this._t('GAME_ROLL_DICE', 'ROLL DICE'), { fontSize: 36, fontFamily: 'Orbitron, Arial', color: '#66ff66' })
      .setOrigin(0.5).setInteractive()
      .on('pointerdown', () => {
        if (!this.canHumanRoll()) return;
        this.handleRoll();
      });

    this.endTurnBtn = this.add.text(600, 502, this._t('GAME_END_TURN', 'END TURN'), { fontSize: 28, fontFamily: 'Orbitron, Arial', color: '#666666' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.attemptEndTurn());

    this.buyDiceBtn = this.add.text(600, 530, this._t('GAME_BUY_DICE', 'BUY DICE'), { fontSize: 26, fontFamily: 'Orbitron, Arial', color: '#ffaa44' })
      .setOrigin(0.5).setInteractive().on('pointerdown', () => this.buyDice());
    this.diceCostText = this.add.text(600, 560, '', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffaa44' }).setOrigin(0.5);

    this.buyEcoBtn = this.add.text(600, 590, this._t('GAME_UPGRADE_ECONOMY', 'UPGRADE ECONOMY'), { fontSize: 24, fontFamily: 'Orbitron, Arial', color: '#66ccff' })
      .setOrigin(0.5).setInteractive().on('pointerdown', () => this.buyEconomy());
    this.ecoCostText = this.add.text(600, 620, '', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#66ccff' }).setOrigin(0.5);

    this.buyLuckBtn = this.add.text(600, 650, this._t('GAME_UPGRADE_LUCK', 'UPGRADE LUCK'), { fontSize: 24, fontFamily: 'Orbitron, Arial', color: '#ff88ff' })
      .setOrigin(0.5).setInteractive().on('pointerdown', () => this.buyLuck());
    this.luckCostText = this.add.text(600, 680, '', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ff88ff' }).setOrigin(0.5);

    this.scoreBreakdown = this.add.text(600, 220, "", { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffffaa', align: 'center', lineSpacing: -2 }).setOrigin(0.5);

    this.exitLocked = true;
    this.events.once('shutdown', this.cleanupScene, this);
    this.events.once('destroy', this.cleanupScene, this);

    this.input.keyboard.on('keydown-SPACE', (e) => {
      if (this.canHumanRoll()) {
        this.handleRoll();
      }
    });

    this.input.keyboard.on('keydown-R', () => {
      if (this.canHumanRoll()) {
        this.handleRoll();
      }
    });

    this.input.keyboard.on('keydown-T', () => {
      this.attemptEndTurn();
    });

    this.input.keyboard.on('keydown-BACKSPACE', (e) => {
      GlobalAudio.playButton(this);
      if (!this.exitLocked) {
        this.scene.start('MenuScene');
      } else {
        this.toggleExitModal();
      }
    });

    this.input.keyboard.on('keydown-C', (e) => {
      if (this.isRolling || this.waitingForResult) return;
      this.toggleComboToolbar();
    });

    this.input.keyboard.on('keydown-B', () => {
      if (this.isRolling || this.waitingForResult || !this.bigUpgradesEnabled) return;
      this.toggleBigUpgrades();
    });

    this.input.keyboard.on('keydown-ESC', (e) => {
      GlobalAudio.playButton(this);
      if (!this.exitLocked) {
        this.scene.start('MenuScene');
      } else {
        this.toggleExitModal();
      }
    });

    this.comboPanelOpen = false;
	  this.bigUpgradesOpen = false;
	  this.comboToolbarContainer = null;
    this.bigUpgradesToolbarContainer = null;
    this.comboToolbar = [];
    this.createComboToolbar();
    this.createPlayerBar();
    this.addBackButton();
    this.createHistoryLog();
    this.updateTurnUI();
    this.createBigUpgradesPanelToolbar();

    try {
      if (this.players.some(p => !p.isAI)) {
        GlobalAchievements.maybeUnlock('firstPlay');
      }
    } catch (e) {}
  }

  getLocalPlayerIndex() {
    return this.currentPlayerIndex;
  }

  canHumanRoll() {
    const p = this.players[this.currentPlayerIndex];
    return Boolean(
      p &&
      this.currentPlayerIndex === this.getLocalPlayerIndex() &&
      !p.isAI &&
      !this.isRolling &&
      !this.waitingForResult
    );
  }

  canHumanEndTurn() {
    const p = this.players[this.currentPlayerIndex];
    return Boolean(
      p &&
      this.currentPlayerIndex === this.getLocalPlayerIndex() &&
      !p.isAI &&
      !this.isRolling &&
      this.waitingForResult
    );
  }

  attemptEndTurn() {
    if (!this.canHumanEndTurn()) return false;
    this.endTurn('manual');
    return true;
  }

  getAvailableComboKeysForPlayer(player) {
    return this.comboMeta
      .filter(c => player.diceUnlocked >= c.req)
      .sort((a, b) => a.req - b.req)
      .map(c => c.key);
  }

  createComboToolbar() {
    if (this.comboToolbarContainer) {
      try { this.comboToolbarContainer.destroy(true); } catch (e) {}
      this.comboToolbarContainer = null;
    }
    this.comboToolbar = [];

    const leftPad = Math.max(16, Math.floor(this.scale.width * 0.02));
    const panelWidth = 260;
    const hiddenX = leftPad - panelWidth - 20;
    const baseX = leftPad;
    const startY = 120;

    this.comboToolbarContainer = this.add.container(baseX, 0).setDepth(1002);
    this.comboToolbarContainer.x = hiddenX;

    const player = this.players[this.currentPlayerIndex];
    this.comboKeys = this.getAvailableComboKeysForPlayer(player);

    this.comboKeys.forEach((key, idx) => {
      const y = startY + idx * 56;
      const rowBg = this.add.rectangle(0, y, panelWidth, 48, 0x0b0b0b, 0.92).setOrigin(0, 0.5);
      rowBg.setStrokeStyle(1, 0x222222);
      const labelText = COMBO_DISPLAY_NAMES[key] ? COMBO_DISPLAY_NAMES[key] : key.toUpperCase();
      const label = this.add.text(12, y - 10, labelText, { fontSize: 16, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0, 0);
      const lvlText = this.add.text(12, y + 12, 'Lv 0', { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#ffff88' }).setOrigin(0, 0);
      const btn = this.add.text(panelWidth - 86, y - 8, 'UPGRADE', { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#66ff66' })
        .setOrigin(0, 0).setInteractive({ useHandCursor: true });

      this.comboToolbarContainer.add([rowBg, label, lvlText, btn]);
      this.comboToolbar.push({
        key,
        ui: { rowBg, label, lvlText, btn },
        layout: { x: 0, y }
      });

      btn.on('pointerdown', () => {
        if (this.currentPlayerIndex !== this.getLocalPlayerIndex()) return;
        const p = this.players[this.currentPlayerIndex];
        if (p.isAI) return;
        if (this.isRolling || this.waitingForResult) return;

        const req = this.comboRequirements[key] ?? 2;
        if (p.diceUnlocked < req) return;

        const rawCost = p.upgrades.getComboCost(key);
        const cost = Math.floor(rawCost * this.costMult);

        if (p.score >= cost) {
          p.score -= cost;
          p.upgrades.upgradeCombo(key);
          GlobalAudio.playButton(this);
          this._logActivity(`${p.name} upgraded ${COMBO_DISPLAY_NAMES[key] || key} -> Lv ${p.upgrades.getComboLevel(key)}`);
          this.updateTurnUI();
        }
      });
    });

    if (this.comboToggleBtn) try { this.comboToggleBtn.destroy(); } catch(e){}
    this.comboToggleBtn = this.add.text(leftPad - 18, startY - 24, '>', { fontSize: 20, fontFamily: 'Orbitron, Arial', color: '#ffffff' })
      .setOrigin(0.5).setDepth(1003).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.toggleComboToolbar());

    this.comboPanelOpen = false;
    this.comboToggleBtn.x = leftPad - 16;
    this.comboToolbarContainer.x = hiddenX;
  }

  toggleComboToolbar() {
    const leftPad = Math.max(16, Math.floor(this.scale.width * 0.02));
    const panelWidth = 260;
    const hiddenX = leftPad - panelWidth - 20;
    const openX = leftPad;
    this.comboPanelOpen = !this.comboPanelOpen;

    this.tweens.killTweensOf(this.comboToolbarContainer);
    this.tweens.add({
      targets: this.comboToolbarContainer,
      x: this.comboPanelOpen ? openX : hiddenX,
      duration: 320,
      ease: 'Cubic.easeOut'
    });

    try { this.comboToggleBtn.setText(this.comboPanelOpen ? '<' : '>'); } catch(e){}
  }

  refreshComboToolbarForPlayer(player) {
    (this.comboToolbar || []).forEach(entry => {
      const key = entry.key;
      const lvl = (player.upgrades.getComboLevel && player.upgrades.getComboLevel(key)) || 0;
      const upgradeMult = (player.upgrades.getComboMultiplier && player.upgrades.getComboMultiplier(key)) || 1;
      const baseMult = COMBO_BASE_MULT[key] || 1;
      const globalMult = player.upgrades.getComboGlobalMultiplier ? player.upgrades.getComboGlobalMultiplier() : 1;
      const totalMult = baseMult * upgradeMult * globalMult;

      entry.ui.lvlText.setText(`Lv ${lvl} (x${this._formatMultiplier(totalMult, 1)})`);

      const cost = Math.floor((player.upgrades.getComboCost && player.upgrades.getComboCost(key) || 0) * this.costMult);
      entry.ui.btn.setText(cost ? `UPGRADE (${formatCompact(cost)})` : 'UPGRADE');

      const req = this.comboRequirements[key] ?? 2;
      const afford = player.score >= cost;
      const isActivePlayerTurn = this.currentPlayerIndex === this.getLocalPlayerIndex();
      const allowed = isActivePlayerTurn && !player.isAI && player.diceUnlocked >= req && afford && !this.isRolling && !this.waitingForResult;

      if (allowed) {
        entry.ui.btn.setInteractive();
        entry.ui.btn.setStyle({ color: '#66ff66' });
      } else {
        entry.ui.btn.disableInteractive();
        entry.ui.btn.setStyle({ color: '#555555' });
      }
    });
  }

  closeComboToolbarInstant() {
    if (this.comboToolbarContainer) {
      const leftPad = Math.max(16, Math.floor(this.scale.width * 0.02));
      const panelWidth = 260;
      const hiddenX = leftPad - panelWidth - 20;
      try { this.comboToolbarContainer.x = hiddenX; } catch (e) {}
    }
    try { if (this.comboToggleBtn) { this.comboToggleBtn.setText('>'); } } catch(e){}
    this.comboPanelOpen = false;
  }

  createBigUpgradesPanelToolbar() {
    if (!this.bigUpgradesEnabled) return;

    if (this.bigUpgradesToolbarContainer) {
      try { this.bigUpgradesToolbarContainer.destroy(true); } catch (e) {}
      this.bigUpgradesToolbarContainer = null;
    }

    const leftPad = Math.max(16, Math.floor(this.scale.width * 0.02));
    const comboWidth = 260;
    const gap = 12;
    const baseStartX = leftPad + comboWidth + gap;
    const startY = 120;

    const t = this._t;
    const fmt = this._fmt;
    const descriptions = {
      clairvoyance: t('BIG_DESC_CLAIRVOYANCE', '25% chance to predict your next roll.'),
      stockExchange: t('BIG_DESC_STOCK_EXCHANGE', 'Economy +50% income.'),
      comboX: t('BIG_DESC_COMBOX', 'Combo multipliers +50%.'),
      masterPredict: t('BIG_DESC_MASTER_PREDICT', 'Make clairvoyance 50% (requires Clairvoyance).'),
      fixated: t('BIG_DESC_FIXATED', 'Dice-earned scores x2.'),
      highStonks: t('BIG_DESC_HIGH_STONKS', 'Economy +5% per completed round.'),
      comboMasher: t('BIG_DESC_COMBO_MASHER', '+20% combo per consecutive same-type combo.'),
      rollicane: t('BIG_DESC_ROLLICANE', '25% per die to spin 2-10s and gain points each second.'),
      ultraStonks: t('BIG_DESC_ULTRA_STONKS', 'Economy income is massively boosted.'),
      scoreInvestor: t('BIG_DESC_SCORE_INVESTOR', 'Gain bonus income each turn from current score.'),
      comboOverclock: t('BIG_DESC_COMBO_OVERCLOCK', 'Combo multipliers are overclocked.')
    };
    const toNumber = (value, fallback = null) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    const toPercent = (value) => `${Math.round((toNumber(value, 0) || 0) * 100)}%`;

    const describeUpgrade = (def) => {
      if (!def) return '';
      if (!def.effect) return descriptions[def.key] || t('BIG_DESC_GENERIC', 'Big upgrade effect.');

      const effect = def.effect;
      const value = def.value;
      const values = def.values || {};

      switch (effect) {
        case 'predictChance':
          return fmt('BIG_DESC_PREDICT', '{0} chance to predict your next roll.', toPercent(value));
        case 'ecoMultiplier':
          return fmt('BIG_DESC_ECO_MULT', 'Economy income x{0}.', toNumber(value, 1));
        case 'comboMultiplier':
          return fmt('BIG_DESC_COMBO_MULT', 'Combo multipliers x{0}.', toNumber(value, 1));
        case 'rollMultiplier':
          return fmt('BIG_DESC_ROLL_MULT', 'Dice-earned scores x{0}.', toNumber(value, 1));
        case 'ecoRoundMultiplier':
          return fmt('BIG_DESC_ECO_ROUND', 'Economy +{0} per completed round.', toPercent(value));
        case 'economyCap': {
          const delta = Math.trunc(toNumber(value, 0) || 0);
          const deltaText = delta >= 0 ? `+${delta}` : `${delta}`;
          return fmt('BIG_DESC_ECO_CAP', 'Economy cap {0}.', deltaText);
        }
        case 'comboCostMultiplier':
          return fmt('BIG_DESC_COMBO_COST', 'Combo upgrade costs x{0}.', toNumber(value, 1));
        case 'comboStreak': {
          const pct = toPercent(values.percentage ?? value);
          const multNote = values.isMultiplicative ? t('BIG_DESC_COMBO_STREAK_MULT', ' (multiplicative)') : '';
          return fmt('BIG_DESC_COMBO_STREAK', '+{0} combo per consecutive same-type combo{1}.', pct, multNote);
        }
        case 'spinEffect': {
          const chance = toPercent(values.chance ?? value);
          const minSec = toNumber(values.minSec, 2);
          const maxSec = toNumber(values.maxSec, 10);
          return fmt('BIG_DESC_SPIN', '{0} per die to spin {1}-{2}s and gain points each second.', chance, minSec, maxSec);
        }
        case 'interestRate':
          return fmt('BIG_DESC_INTEREST', 'Gain {0} of current score each turn.', toPercent(value));
        default:
          return descriptions[def.key] || t('BIG_DESC_GENERIC', 'Big upgrade effect.');
      }
    };

    const itemsRaw = this._bigUpgradeDefs.map(def => ({
      key: def.key,
      title: def.title || def.key,
      desc: describeUpgrade(def),
      baseCost: def.baseCost
    }));
    const items = (this.bigUpgradeSortAsc || this.bigUpgradeSortDesc)
      ? itemsRaw.slice().sort((a, b) => {
          const ca = Number.isFinite(a?.baseCost) ? a.baseCost : Infinity;
          const cb = Number.isFinite(b?.baseCost) ? b.baseCost : Infinity;
          if (ca !== cb) return this.bigUpgradeSortDesc ? cb - ca : ca - cb;
          const ta = (a?.title || a?.key || '').toString();
          const tb = (b?.title || b?.key || '').toString();
          return ta.localeCompare(tb);
        })
      : itemsRaw;

    this.bigUpgradesToolbar = [];

    const upgradesPerColumn = 12;
    const maxColumns = 5;
    const columnGap = 14;
    const rowHeight = 64;
    const pageSize = upgradesPerColumn * maxColumns;
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    this.bigUpgradePage = Math.max(0, Math.min(this.bigUpgradePage || 0, totalPages - 1));
    const itemsToShow = items.slice(this.bigUpgradePage * pageSize, this.bigUpgradePage * pageSize + pageSize);
    const columns = Math.max(1, Math.min(maxColumns, Math.ceil(itemsToShow.length / upgradesPerColumn)));
    const minPanelWidth = 180;
    const maxPanelWidth = 320;
    const totalGap = columnGap * Math.max(0, columns - 1);
    const availableWidth = Math.max(240, this.scale.width - baseStartX - 20);
    let panelWidth = Math.floor((availableWidth - totalGap) / columns);
    panelWidth = Math.max(minPanelWidth, Math.min(maxPanelWidth, panelWidth));
    const totalWidth = panelWidth * columns + totalGap;
    let startX = baseStartX;
    if (startX + totalWidth > this.scale.width - 10) {
      startX = Math.max(leftPad, this.scale.width - totalWidth - 10);
    }

    this.bigUpgradesToolbarOpenX = startX;
    this.bigUpgradesToolbarClosedX = startX - 40;
    this.bigUpgradesToolbarContainer = this.add.container(startX, 0).setDepth(1002);
    this.bigUpgradesToolbarContainer.x = this.bigUpgradesToolbarClosedX;
    this.bigUpgradesToolbarContainer.setVisible(false);

    itemsToShow.forEach((it, index) => {
      const col = Math.floor(index / upgradesPerColumn);
      const row = index % upgradesPerColumn;
      const x = col * (panelWidth + columnGap);
      const y = startY + row * rowHeight;
      const rowBg = this.add.rectangle(x, y, panelWidth, 56, 0x0b0b0b, 0.92).setOrigin(0, 0.5);
      rowBg.setStrokeStyle(1, 0x222222);
      const title = this.add.text(x + 8, y - 12, it.title, { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0, 0);
      const desc = this.add.text(x + 8, y + 6, it.desc, { fontSize: 11, fontFamily: 'Orbitron, Arial', color: '#cccccc', wordWrap: { width: panelWidth - 120 } }).setOrigin(0, 0);
      const buyBtn = this.add.text(x + panelWidth - 96, y - 8, `BUY ${formatCompact(it.baseCost)}`, { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#66ff66' })
        .setOrigin(0, 0).setInteractive({ useHandCursor: true });

      buyBtn.on('pointerdown', () => {
        this.attemptBuyBigUpgrade(it.key, it.title, it.baseCost);
      });

      this.bigUpgradesToolbarContainer.add([rowBg, title, desc, buyBtn]);
      this.bigUpgradesToolbar.push({ key: it.key, rowBg, title, desc, buyBtn, baseCost: it.baseCost });
    });

    if (this.bigToggleBtn) try { this.bigToggleBtn.destroy(); } catch (e) {}
    this.bigToggleBtn = this.add.text(startX - 18, startY - 24, '>', { fontSize: 20, fontFamily: 'Orbitron, Arial', color: '#ffffff' })
      .setOrigin(0.5).setDepth(1003).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.toggleBigUpgrades());

    if (this.bigPagePrevBtn) try { this.bigPagePrevBtn.destroy(); } catch (e) {}
    if (this.bigPageNextBtn) try { this.bigPageNextBtn.destroy(); } catch (e) {}
    if (this.bigPageText) try { this.bigPageText.destroy(); } catch (e) {}
    if (totalPages > 1) {
      this.bigPagePrevBtn = this.add.text(startX + 18, startY - 24, '◀', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffffff' })
        .setDepth(1003).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
          this.bigUpgradePage = Math.max(0, this.bigUpgradePage - 1);
          const wasOpen = this.bigUpgradesOpen;
          this.createBigUpgradesPanelToolbar();
          if (wasOpen && !this.bigUpgradesOpen) this.toggleBigUpgrades();
        });
      this.bigPageNextBtn = this.add.text(startX + 42, startY - 24, '▶', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffffff' })
        .setDepth(1003).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
          this.bigUpgradePage = Math.min(totalPages - 1, this.bigUpgradePage + 1);
          const wasOpen = this.bigUpgradesOpen;
          this.createBigUpgradesPanelToolbar();
          if (wasOpen && !this.bigUpgradesOpen) this.toggleBigUpgrades();
        });
      this.bigPageText = this.add.text(startX + 66, startY - 24, `Page ${this.bigUpgradePage + 1}/${totalPages}`, { fontSize: 12, fontFamily: 'Orbitron, Arial', color: '#cccccc' }).setDepth(1003);
    }
    this.bigUpgradesOpen = false;
  }

  toggleBigUpgrades() {
    if (!this.bigUpgradesEnabled) return;
    if (!this.bigUpgradesToolbarContainer) return;

    this.bigUpgradesOpen = !this.bigUpgradesOpen;

    try {
      if (this.bigUpgradesOpen) this.bigUpgradesToolbarContainer.setVisible(true);
      this.tweens.killTweensOf(this.bigUpgradesToolbarContainer);
      const openX = Number.isFinite(this.bigUpgradesToolbarOpenX)
        ? this.bigUpgradesToolbarOpenX
        : this.bigUpgradesToolbarContainer.x + 40;
      const closedX = Number.isFinite(this.bigUpgradesToolbarClosedX)
        ? this.bigUpgradesToolbarClosedX
        : this.bigUpgradesToolbarContainer.x - 40;
      const targetX = this.bigUpgradesOpen ? openX : closedX;
      this.tweens.add({
        targets: this.bigUpgradesToolbarContainer,
        x: targetX,
        duration: 260,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          if (!this.bigUpgradesOpen && this.bigUpgradesToolbarContainer) {
            this.bigUpgradesToolbarContainer.setVisible(false);
          }
        }
      });
      this.bigToggleBtn.setText(this.bigUpgradesOpen ? '<' : '>');
    } catch (e) {}
    if (this.bigUpgradesOpen) this.refreshBigUpgradesPanel();
  }

  closeBigUpgradesInstant() {
    try {
      if (Number.isFinite(this.bigUpgradesToolbarClosedX) && this.bigUpgradesToolbarContainer) {
        this.bigUpgradesToolbarContainer.x = this.bigUpgradesToolbarClosedX;
      }
      this.bigUpgradesToolbarContainer.setVisible(false);
      this.bigToggleBtn.setText('>');
    } catch (e) {}
    this.bigUpgradesOpen = false;
  }

  refreshBigUpgradesPanel() {
    if (!this.bigUpgradesToolbar) return;
    const player = this.players[this.currentPlayerIndex];
    const isActiveHuman = player && !player.isAI && this.currentPlayerIndex === this.getLocalPlayerIndex();

    this.bigUpgradesToolbar.forEach(entry => {
      const scaled = Math.max(1, Math.floor(entry.baseCost * (this.costMult || 1)));
      if (entry.buyBtn) entry.buyBtn.setText(`BUY ${formatCompact(scaled)}`);

      const purchased = player.upgrades.hasBigUpgrade ? player.upgrades.hasBigUpgrade(entry.key) : false;

      if (purchased) {
        if (entry.buyBtn) entry.buyBtn.disableInteractive?.();
        if (entry.buyBtn) entry.buyBtn.setStyle({ color: '#666666' });
        if (entry.title) entry.title.setStyle?.({ color: '#99ff99' });
      } else {
        const canBuy = isActiveHuman && !this.isRolling && !this.waitingForResult && player.score >= scaled;
        if (!canBuy) {
          if (entry.buyBtn) entry.buyBtn.disableInteractive?.();
          if (entry.buyBtn) entry.buyBtn.setStyle({ color: '#555555' });
        } else {
          if (entry.buyBtn) entry.buyBtn.setInteractive?.({ useHandCursor: true });
          if (entry.buyBtn) entry.buyBtn.setStyle({ color: '#66ff66' });
        }
        if (entry.title) entry.title.setStyle?.({ color: '#ffffff' });
      }
    });
  }

  attemptBuyBigUpgrade(key, title, baseCost) {
    if (!this.bigUpgradesEnabled) return;
    const player = this.players[this.currentPlayerIndex];
    if (!player) return;
    if (this.currentPlayerIndex !== this.getLocalPlayerIndex()) {
      this._logActivity(`${player.name} cannot buy upgrades when it's not their turn`);
      return;
    }
    if (player.isAI) return;
    if (this.isRolling || this.waitingForResult) {
      this._logActivity(`${player.name} cannot buy during a roll`);
      return;
    }

    const scaledCost = Math.max(1, Math.floor((baseCost || 0) * (this.costMult || 1)));

    if (player.upgrades.hasBigUpgrade && player.upgrades.hasBigUpgrade(key)) {
      this._logActivity(`${player.name} already owns ${title}`);
      return;
    }

    if (player.score < scaledCost) {
      this._logActivity(`${player.name} cannot afford ${title} (${formatCompact(scaledCost)})`);
      return;
    }

    player.score -= scaledCost;
    const ok = player.upgrades.buyBigUpgrade ? player.upgrades.buyBigUpgrade(key) : false;
    if (ok) {
      GlobalAudio.playButton(this);
      this._logActivity(`${player.name} bought ${title} for ${formatCompact(scaledCost)}`);
      this.updateTurnUI();
      this.refreshBigUpgradesPanel();
    } else {
      player.score += scaledCost;
    }
  }

  createPlayerBar() {
    if (this.playerBar?.length) {
      this.playerBar.forEach(p => Object.values(p).forEach(o => o?.destroy?.()));
    }

    this.playerBar = [];
    const spacing = 200;
    const startX = 600 - ((this.playerCount - 1) * spacing) / 2;
    const y = 850;

    for (let i = 0; i < this.playerCount; i++) {
      const p = this.players[i];
      const x = startX + i * spacing;

      const icon = this.add.image(x, y, p.isAI ? 'botIcon' : 'playerIcon').setScale(0.7);
      const name = this.add.text(x, y + 70, p.name, { fontSize: 22, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0.5);
      const score = this.add.text(x, y - 134, '0', { fontSize: 20, fontFamily: 'Orbitron, Arial', color: '#ffff88' }).setOrigin(0.5);
      const dice = this.add.text(x, y - 102, `🎲 ${p.diceUnlocked}`, { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffaa44' }).setOrigin(0.5);
      const luck = this.add.text(x, y - 80, `🍀 x${p.luck}`, { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#66ccff' }).setOrigin(0.5);
      const income = this.add.text(x, y - 58, `💰 +0`, { fontSize: 16, fontFamily: 'Orbitron, Arial', color: '#66ccff' }).setOrigin(0.5);
      const ring = this.add.rectangle(x, y, 90, 90, 0xffffff, 0.2).setStrokeStyle(3, 0xffffff).setVisible(false);

      this.playerBar.push({ icon, name, score, dice, luck, income, ring });
    }

    this.updatePlayerBar();
  }

  updatePlayerBar() {
    this.playerBar.forEach((ui, i) => {
      const p = this.players[i];
      ui.score?.setText(formatCompact(p.score));
      ui.dice?.setText(`🎲 ${p.diceUnlocked}`);
      const effective = Math.min(p.luck + p.upgrades.getLuckBonus(), 6);
      ui.luck?.setText(`🍀 x${this._formatMultiplier(effective, 1)}`);
      const incomeVal = Math.floor(
        p.upgrades.getEconomyIncome() *
        (p.upgrades.getEconomyMultiplier ? p.upgrades.getEconomyMultiplier() : 1) *
        (p.upgrades.getHighStonksMultiplier ? p.upgrades.getHighStonksMultiplier(this.currentRound - 1) : 1)
      );
      ui.income?.setText(incomeVal > 0 ? `💰 +${formatCompact(incomeVal)}` : '');
      ui.ring?.setVisible(i === this.currentPlayerIndex);
      const isActive = i === this.currentPlayerIndex;

      if (this.teamsEnabled) {
        const tint = p.team === 'red' ? 0xff7777 : 0x77bbff;
        ui.ring.setStrokeStyle(isActive ? 4 : 3, isActive ? 0xdddddd : tint);
      } else {
        const tint = this.playerTints[i % this.playerTints.length];
        ui.ring.setStrokeStyle(isActive ? 4 : 3, isActive ? 0xdddddd : tint);
      }

      ui.ring.setVisible(true);
    });
  }

  startTurn(player) {
    if (this._lastTurnGivenRoundFor[this.currentPlayerIndex] === this.currentRound) return;

    try {
      this._logActivity(`${player.name}'s turn started`);
      GlobalDebug.turnStart({ playerIndex: this.currentPlayerIndex, playerName: player.name, round: this.currentRound });
    } catch (e) {}

    this._lastTurnGivenRoundFor[this.currentPlayerIndex] = this.currentRound;

    const baseIncome = player.upgrades.getEconomyIncome();
    let ecoMult = player.upgrades.getEconomyMultiplier ? player.upgrades.getEconomyMultiplier() : 1;
    ecoMult *= (player.upgrades.getHighStonksMultiplier ? player.upgrades.getHighStonksMultiplier(this.currentRound - 1) : 1);

    const income = Math.floor(baseIncome * ecoMult);
    if (income > 0) {
      player.score += income;
      const ecoText = this.add.text(760, 32, `+${formatCompact(income)}`, { fontSize: 20, fontFamily: 'Orbitron, Arial', color: '#66ccff', fontStyle: 'bold' }).setOrigin(0.5);
      this.tweens.add({
        targets: ecoText,
        y: 10,
        alpha: 0,
        duration: 900,
        onComplete: () => ecoText.destroy()
      });
      this._logActivity(`${player.name} received ${formatCompact(income)} income`);
    }

    const investorRate = player.upgrades.getInterestRate ? player.upgrades.getInterestRate() : 0;
    if (investorRate > 0) {
      const investorIncome = Math.floor(player.score * investorRate);
      if (investorIncome > 0) {
        player.score += investorIncome;
        this._logActivity(`${player.name} received ${formatCompact(investorIncome)} interest income`);
      }
    }

    const playerIdx = this.players.indexOf(player);
    const topScore = Math.max(...this.players.map(p => p.score || 0));
    const ratioBase = Math.max(1, player.score || 0);
    if (playerIdx >= 0 && !this._energyBoostGiven[playerIdx] && topScore >= ratioBase * 5) {
      const boost = Math.floor(topScore * 0.2);
      if (boost > 0) {
        player.score += boost;
        this._energyBoostGiven[playerIdx] = true;
        const boostText = this.add.text(760, 56, `Energy +${formatCompact(boost)}`, { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffdd66' }).setOrigin(0.5);
        this.tweens.add({
          targets: boostText,
          y: 36,
          alpha: 0,
          duration: 1100,
          onComplete: () => boostText.destroy()
        });
        this._logActivity(`${player.name} received an Energy Boost (${formatCompact(boost)}). Go catch em'!`);
      }
    }

    if (!this._megaEnergyBoostGiven && this.currentRound >= this.maxRounds) {
      const playersByScoreAsc = this.players.slice().sort((a, b) => (a.score || 0) - (b.score || 0));
      const worst = playersByScoreAsc[0];
      const top = playersByScoreAsc[playersByScoreAsc.length - 1];
      if (worst && top && worst !== top) {
        const others = this.players.filter(p => p !== worst);
        const worstBase = Math.max(1, worst.score || 0);
        const behindAllBy50x = others.every(p => (p.score || 0) >= worstBase * 50);
        if (behindAllBy50x && player === worst) {
          const megaBoost = Math.floor((top.score || 0) * 0.4);
          if (megaBoost > 0) {
            player.score += megaBoost;
            this._megaEnergyBoostGiven = true;
            const megaText = this.add.text(760, 82, `MEGA ENERGY +${formatCompact(megaBoost)}`, { fontSize: 17, fontFamily: 'Orbitron, Arial', color: '#ff66ff' }).setOrigin(0.5);
            this.tweens.add({
              targets: megaText,
              y: 58,
              alpha: 0,
              duration: 1400,
              onComplete: () => megaText.destroy()
            });
            this._logActivity(`${player.name} triggered Mega Energy Boost (${formatCompact(megaBoost)}). Go catch em'!`);
          }
        }
      }
    }

    // Clairvoyance prediction at turn start
    const predictionChance = player.upgrades.getClairvoyanceChance ? player.upgrades.getClairvoyanceChance() : 0;
    if (!this.prediction && predictionChance > 0) {
      const chance = predictionChance;
      if (Math.random() < chance) {
        const luckBonus = player.upgrades.getLuckBonus();
        const baseLuck = player.luck || 1;
        const effectiveLuck = Phaser.Math.Clamp(baseLuck + luckBonus, 0.5, 6.0);
        let pred = Array.from({ length: player.diceUnlocked }, () => Phaser.Math.Between(1, 6));
        pred = pred.map(v => {
          const rerollChance = Phaser.Math.Clamp((effectiveLuck - 1) / 5, 0, 1);
          if (Math.random() < rerollChance) {
            const bias = Math.pow(Math.random(), 1 / Math.max(0.001, effectiveLuck));
            return Phaser.Math.Clamp(Math.ceil(bias * 6), 1, 6);
          }
          return v;
        });
        if (effectiveLuck >= 2) {
          const boostFraction = Phaser.Math.Clamp((effectiveLuck - 1) / 5, 0, 1);
          const toCoerce = Math.floor(boostFraction * (player.diceUnlocked - 1));
          if (toCoerce > 0) {
            const counts = {};
            pred.forEach(n => counts[n] = (counts[n] || 0) + 1);
            let targetFace = 6;
            let bestCount = -1;
            Object.keys(counts).forEach(k => {
              const c = counts[k];
              if (c > bestCount) { bestCount = c; targetFace = parseInt(k, 10); }
            });
            if (effectiveLuck >= 4 && Math.random() < 0.6) targetFace = 6;
            let coerced = 0;
            const indices = Array.from({ length: pred.length }, (_, i) => i).sort(() => Math.random() - 0.5);
            for (let idx of indices) {
              if (coerced >= toCoerce) break;
              if (pred[idx] !== targetFace && Math.random() < 0.9) {
                pred[idx] = targetFace;
                coerced++;
              }
            }
          }
        }
        this.prediction = pred;
        if (!player.isAI) {
          this.predictionText.setText(`Prediction: ${this.prediction.join(', ')}`);
        }
      }
    }
  }

  getInitialLuck(isAI, difficulty) {
    if (!isAI) return 1;
    const map = { Baby: 0.5, Easy: 0.75, Medium: 1, Hard: 1.5, Nightmare: 2 };
    return map[difficulty] ?? 1;
  }

  _formatMultiplier(value, decimals = 1) {
    if (!Number.isFinite(value)) return '0';
    const abs = Math.abs(value);
    if (abs >= 1000) return formatCompact(value);
    return value.toFixed(decimals);
  }

  getBotActionDelayMs(player) {
    const diff = player?.difficulty || 'Medium';
    const map = {
      Baby: 500,
      Easy: 333,
      Medium: 250,
      Hard: 200,
      Nightmare: 100
    };
    return map[diff] ?? 500;
  }

  _shouldBotSkipCombo(player, key) {
    const dice = player.diceUnlocked;
    const isNightmare = player.difficulty === 'Nightmare';
    const isHard = player.difficulty === 'Hard' || isNightmare;
    const lowTier = ['pair','twoPair','triple'];
    const midTier = ['straight','fullHouse'];

    if (isHard) {
      if (dice >= 6 && lowTier.includes(key)) return true;
      if (dice >= 5 && key === 'pair') return true;
      if (isNightmare) {
        if (dice >= 6 && (lowTier.includes(key) || midTier.includes(key))) return true;
        if (dice >= 5 && key === 'triple') return true;
      }
    }
    return false;
  }

  runBotTurn(player) {
    const playerIdx = this.players.indexOf(player);
    if (playerIdx === -1) {
      this.handleRoll();
      return;
    }

    // ensure it's still their turn and nothing is mid-roll
    if (this.currentPlayerIndex !== playerIdx || this.isRolling || this.waitingForResult) return;

    const turnsLeft = this.maxRounds - this.currentRound;
    const doNothingTurnsByDifficulty = {
      Baby: 1,
      Easy: 1,
      Medium: 2,
      Hard: 3,
      Nightmare: 5
    };
    const doNothingThreshold = doNothingTurnsByDifficulty[player.difficulty] ?? 1;
    if (turnsLeft <= doNothingThreshold) {
      this.handleRoll();
      return;
    }

    const diceCost = this.diceCosts[player.diceUnlocked - 1];
    const scaledDiceCost = Math.floor((diceCost || Infinity) * this.costMult);
    const expectedBase = player.diceUnlocked * 3.5;
    const isNightmare = player.difficulty === 'Nightmare';
    let comboTargets = null;

    const allComboKeys = this.getAvailableComboKeysForPlayer(player);
    let availableComboKeys = allComboKeys.slice();

    const totalComboLevels = (() => {
      try {
        return this.comboMeta.reduce((sum, c) => {
          const lvl = (player.upgrades.getComboLevel && player.upgrades.getComboLevel(c.key)) || 0;
          return sum + lvl;
        }, 0);
      } catch (e) { return 0; }
    })();

    const getComboScaledCost = (key) => {
      const rawCost = player.upgrades.getComboCost(key);
      return Math.floor(rawCost * this.costMult);
    };

    const shouldSkipComboForCap = (key, targets) => {
      if (!targets) return false;
      const target = targets[key];
      if (!Number.isFinite(target)) return false;
      const req = this.comboRequirements[key] ?? 2;
      if (isNightmare && req >= 6) return false;
      const lvl = player.upgrades.getComboLevel?.(key) || 0;
      return lvl >= target;
    };

    const canAffordCombo = (key, cost, targets = null) => {
      if (shouldSkipComboForCap(key, targets)) return false;
      if (player.score < cost) return false;
      if (isNightmare) {
        const req = this.comboRequirements[key] ?? 2;
        const lvl = player.upgrades.getComboLevel?.(key) || 0;
        if (req >= 6) {
          const multiplier = lvl > 60 ? 10 : 5;
          if (player.score < cost * multiplier) return false;
        }
      }
      return true;
    };

    const pickBestComboROI = (keys = availableComboKeys) => {
      let best = null;
      for (let key of keys) {
        const req = this.comboRequirements[key] ?? 2;
        if (player.diceUnlocked < req) continue;
        const cost = getComboScaledCost(key);
        if (!canAffordCombo(key, cost, comboTargets)) continue;
        const baseMult = COMBO_BASE_MULT[key] || 1;
        const upgradeMult = player.upgrades.getComboMultiplier(key) || 1;
        const totalMult = baseMult * upgradeMult;
        const expectedGain = expectedBase * Math.max(0, totalMult - 1);
        const roi = expectedGain / Math.max(1, cost);
        if (!best || roi > best.roi) best = { key, roi, cost };
      }
      return best;
    };

    const buildComboTargets = () => {
      const dice = player.diceUnlocked;
      if (dice < 4) return null;

      const diff = player.difficulty;
      const isHard = diff === 'Hard' || diff === 'Nightmare';
      const isMedium = diff === 'Medium';
      const isEasy = diff === 'Easy';
      const isBaby = diff === 'Baby';
      if (!isHard && !isMedium && !isEasy && !isBaby) return null;

      const roundsLeft = this.maxRounds - this.currentRound + 1;
      const lateGame = roundsLeft <= Math.max(6, Math.floor(this.maxRounds * 0.35));
      if (isMedium && !lateGame) return null;

      let targetByReq = null;
      if (diff === 'Nightmare') {
        targetByReq = { 4: 15, 5: 25, 6: 40 };
      } else if (diff === 'Hard') {
        targetByReq = { 4: 10, 5: 20, 6: 30 };
      } else if (diff === 'Medium') {
        targetByReq = { 4: 6, 5: 12, 6: 20 };
      } else if (diff === 'Easy') {
        targetByReq = { 4: 5, 5: 10, 6: 15 };
      } else if (diff === 'Baby') {
        targetByReq = { 4: 3, 5: 5, 6: 7 };
      }

      if (!targetByReq) return null;

      const targets = {};
      allComboKeys.forEach(key => {
        const req = this.comboRequirements[key] ?? 2;
        if (req < 4) return;
        const target = targetByReq[req];
        if (target) targets[key] = target;
      });

      return Object.keys(targets).length ? targets : null;
    };

    const tryBuyComboTargets = (targets) => {
      if (!targets) return false;
      const keys = Object.keys(targets)
        .filter(key => allComboKeys.includes(key))
        .sort((a, b) => {
          const ra = this.comboRequirements[a] ?? 2;
          const rb = this.comboRequirements[b] ?? 2;
          if (rb !== ra) return rb - ra;
          const la = (player.upgrades.getComboLevel?.(a)) || 0;
          const lb = (player.upgrades.getComboLevel?.(b)) || 0;
          return la - lb;
        });

      for (let key of keys) {
        const target = targets[key] ?? 0;
        const lvl = player.upgrades.getComboLevel?.(key) || 0;
        const req = this.comboRequirements[key] ?? 2;
        if (!(isNightmare && req >= 6) && lvl >= target) continue;
        if (tryBuyComboNow(key)) return true;
      }

      return false;
    };

    const tryBuyEconomyNow = () => {
      const cost = player.upgrades.getScaledEconomyCost?.(this.costMult) ?? Math.floor(player.upgrades.getEconomyCost() * this.costMult);
      if (!player.upgrades.canUpgradeEconomy(player.score, this.costMult)) return false;
      if (player.score < cost) return false;
      return this.buyEconomy(true);
    };

    const tryBuyDiceNow = () => {
      const nextIndex = player.diceUnlocked - 1;
      if (nextIndex >= this.diceCosts.length) return false;
      const baseCost = this.diceCosts[nextIndex];
      const cost = Math.floor(baseCost * this.costMult);
      if (player.score < cost) return false;
      return this.buyDice(true);
    };

    const tryBuyLuckNow = () => {
      const cost = player.upgrades.getScaledLuckCost?.(this.costMult) ?? Math.floor(player.upgrades.getLuckCost() * this.costMult);
      if (!player.upgrades.canUpgradeLuck(player.score, player.luck, this.costMult)) return false;
      if (player.score < cost) return false;
      return this.buyLuck(true);
    };

    const tryBuyComboNow = (key) => {
      const req = this.comboRequirements[key] ?? 2;
      if (player.diceUnlocked < req) return false;
      const cost = getComboScaledCost(key);
      if (!canAffordCombo(key, cost, comboTargets)) return false;
      return this.buyCombo(key, true);
    };

    const tryBuyBigNow = (def) => {
      if (!this.bigUpgradesEnabled) return false;
      if (!def || !def.key) return false;
      const key = def.key;

      if (player.upgrades.hasBigUpgrade?.(key)) return false;

      const baseCost = Number(def.baseCost);
      if (!Number.isFinite(baseCost)) return false;
      const cost = Math.max(1, Math.floor(baseCost * (this.costMult || 1)));
      if (player.score < cost) return false;

      player.score -= cost;
      const ok = player.upgrades.buyBigUpgrade?.(key);
      if (ok) {
        try { GlobalAudio.playButton(this); } catch (e) {}
        this._logActivity(
          `${player.name} bought ${def.title || def.key} for ${formatCompact(cost)}`
        );

        try { this.refreshBigUpgradesPanel(); } catch {}
        try { this.updateTurnUI(); } catch {}
        return true;
      }

      player.score += cost;
      return false;
    };

    const bigDefs = Array.isArray(this._bigUpgradeDefs) ? this._bigUpgradeDefs : [];
    const bigPriorityDefs = bigDefs
      .filter(d => d && d.key)
      .sort((a, b) => (Number(a?.baseCost) || Infinity) - (Number(b?.baseCost) || Infinity));
    const isHard = player.difficulty === 'Hard' || player.difficulty === 'Nightmare';
    const isMedium = player.difficulty === 'Medium';
    comboTargets = buildComboTargets();
    const weakComboKeys = availableComboKeys
      .slice()
      .sort((a, b) => {
        const ra = this.comboRequirements[a] ?? 2;
        const rb = this.comboRequirements[b] ?? 2;
        if (ra !== rb) return ra - rb;
        const la = player.upgrades.getComboLevel?.(a) || 0;
        const lb = player.upgrades.getComboLevel?.(b) || 0;
        return la - lb;
      });

    // DECISION TREE

    // Hard / Nightmare bots: prefer dice early, then economy, then luck, then combos (ROI)
    if (isHard) {
      const roiComboKeys = availableComboKeys.filter(
        key => !this._shouldBotSkipCombo(player, key)
      );

      if (diceCost && player.score >= scaledDiceCost) {
        if (tryBuyDiceNow()) return;
      }

      for (let def of bigPriorityDefs) {
        if (tryBuyBigNow(def)) return;
      }

      if (tryBuyEconomyNow()) return;
      if (tryBuyLuckNow()) return;
      if (tryBuyComboTargets(comboTargets)) return;

      const comboCap = comboTargets ? 999 : 60;
      if (totalComboLevels < comboCap) {
        const best = pickBestComboROI(roiComboKeys);
        if (best && tryBuyComboNow(best.key)) return;
      }

      if (diceCost && player.score >= scaledDiceCost) {
        if (tryBuyDiceNow()) return;
      }

      this.handleRoll();
      return;
    }

    // Medium bots
    if (isMedium) {
      if (diceCost && player.score >= scaledDiceCost) {
        if (tryBuyDiceNow()) return;
      }

      for (let def of bigPriorityDefs) {
        if (tryBuyBigNow(def)) return;
      }

      if (tryBuyComboTargets(comboTargets)) return;

      if (tryBuyEconomyNow()) return;

      if (Math.random() < 0.375) {
        if (tryBuyLuckNow()) return;
      }

      const mediumPriority = ['fourOfAKind','straight','fullHouse','triple','twoPair','pair'];
      for (let k of mediumPriority) {
        const req = this.comboRequirements[k] ?? 2;
        if (player.diceUnlocked < req) continue;
        if (totalComboLevels >= 60) continue;
        if (tryBuyComboNow(k)) return;
      }

      if (diceCost && player.score >= scaledDiceCost) {
        if (tryBuyDiceNow()) return;
      }

      this.handleRoll();
      return;
    }

    // Easy bots
    if (player.difficulty === 'Easy') {
      if (tryBuyEconomyNow()) return;

      if (diceCost && player.score >= scaledDiceCost) {
        if (tryBuyDiceNow()) return;
      }

      if (Math.random() < 0.2) {
        if (tryBuyLuckNow()) return;
      }

      const easyBigs = bigPriorityDefs.slice(0, 6);
      for (let def of easyBigs) {
        if (tryBuyBigNow(def)) return;
      }

      if (tryBuyComboTargets(comboTargets)) return;

      for (let k of weakComboKeys) {
        if (shouldSkipComboForCap(k, comboTargets)) continue;
        if (tryBuyComboNow(k)) return;
      }

      this.handleRoll();
      return;
    }

    // Baby bots
    if (player.difficulty === 'Baby') {
      if (diceCost && player.score >= scaledDiceCost) {
        if (tryBuyDiceNow()) return;
      }
      if (tryBuyEconomyNow()) return;

      if (Math.random() < 0.15) {
        if (tryBuyLuckNow()) return;
      }

      const babyBigs = bigPriorityDefs.slice(0, 4);
      for (let def of babyBigs) {
        if (tryBuyBigNow(def)) return;
      }

      if (tryBuyComboTargets(comboTargets)) return;

      for (let k of weakComboKeys) {
        if (shouldSkipComboForCap(k, comboTargets)) continue;
        if (tryBuyComboNow(k)) return;
      }

      this.handleRoll();
      return;
    }

    this.handleRoll();
  }

  async handleRoll() {
  if (this.isRolling) return;

  const activePlayer = this.players[this.currentPlayerIndex];
  if (activePlayer && !activePlayer.isAI && !this.canHumanRoll()) return;

  this.isRolling = true;
  this._setBuyUIEnabled(false);
  this.rollBtn.disableInteractive();
  this.rollBtn.setText(this._t('GAME_ROLLING', 'Rolling...'));
  this.rollBtn.setStyle({ color: '#c4c70bd2' });

  const player = this.players[this.currentPlayerIndex];
  GlobalDebug.rollStart({ playerIndex: this.currentPlayerIndex, playerName: player?.name });
  GlobalAudio.playDice(this);
  let raw = this.dice.rollMany(player.diceUnlocked);

  if (!Array.isArray(this._lastComboKey) || this._lastComboKey.length !== this.playerCount) {
    this._lastComboKey = Array(this.playerCount).fill(null);
  }
  if (!Array.isArray(this._consecComboStreak) || this._consecComboStreak.length !== this.playerCount) {
    this._consecComboStreak = Array(this.playerCount).fill(0);
  }
  if (!Array.isArray(this._consecutiveComboCounter) || this._consecutiveComboCounter.length !== this.playerCount) {
    this._consecutiveComboCounter = Array(this.playerCount).fill(0);
  }
  if (!Array.isArray(this.comboStats) || this.comboStats.length !== this.playerCount) {
    this.comboStats = Array.from({ length: this.playerCount }, () => ({
      pair: 0, twoPair: 0, triple: 0, fullHouse: 0, straight: 0,
      fourOfAKind: 0, fiveOfAKind: 0, threePair: 0, tripleTrend: 0,
      powerHouse: 0, sixOfAKind: 0
    }));
  }

  if (this.prediction) {
    raw = this.prediction.slice();
    // Clear prediction after use
    this.prediction = null;
    this.time.delayedCall(4000, () => {
      try { this.predictionText.setText(''); } catch (e) {}
    });
  } else {
    this.predictionText.setText('');
    const luckBonus = player.upgrades.getLuckBonus();
    const baseLuck = player.luck || 1;
    const effectiveLuck = Phaser.Math.Clamp(baseLuck + luckBonus, 0.5, 6.0);

    const finalLuck = raw.map(v => {
      const rerollChance = Phaser.Math.Clamp((effectiveLuck - 1) / 5, 0, 1);
      if (Math.random() < rerollChance) {
        const bias = Math.pow(Math.random(), 1 / Math.max(0.001, effectiveLuck));
        return Phaser.Math.Clamp(Math.ceil(bias * 6), 1, 6);
      }
      return v;
    });

    if (effectiveLuck >= 2) {
      const boostFraction = Phaser.Math.Clamp((effectiveLuck - 1) / 5, 0, 1);
      const toCoerce = Math.floor(boostFraction * (player.diceUnlocked - 1));
      if (toCoerce > 0) {
        const counts = {};
        finalLuck.forEach(n => counts[n] = (counts[n] || 0) + 1);
        let targetFace = 6;
        let bestCount = -1;
        Object.keys(counts).forEach(k => {
          const c = counts[k];
          if (c > bestCount) { bestCount = c; targetFace = parseInt(k, 10); }
        });
        if (effectiveLuck >= 4 && Math.random() < 0.6) targetFace = 6;

        let coerced = 0;
        const indices = Array.from({ length: finalLuck.length }, (_, i) => i).sort(() => Math.random() - 0.5);
        for (let idx of indices) {
          if (coerced >= toCoerce) break;
          if (finalLuck[idx] !== targetFace && Math.random() < 0.9) {
            finalLuck[idx] = targetFace;
            coerced++;
          }
        }
      }
    }
    raw = finalLuck;
  }

  const idx = this.currentPlayerIndex;
  player.lastRoll = raw.slice();

  const activeDice = this.diceSprites.slice(0, player.diceUnlocked);
  await animateDiceRoll(this, raw, activeDice);

  const combo = checkCombo(raw);
  let comboTotalMult = 1;

  const base = raw.reduce((a, b) => a + b, 0);

  const diceMultiplier = player.upgrades.getDiceScoreMultiplier ? player.upgrades.getDiceScoreMultiplier() : 1;
  let gained = Math.floor(base * diceMultiplier);

  if (combo) {
    if (combo.key && this.comboStats[idx] && typeof this.comboStats[idx][combo.key] === 'number') {
      this.comboStats[idx][combo.key]++;
    }

    const playerComboMultRaw = (player.upgrades.getComboMultiplier && player.upgrades.getComboMultiplier(combo.key)) || 1;
    const comboGlobal = player.upgrades.getComboGlobalMultiplier ? player.upgrades.getComboGlobalMultiplier() : 1;
    let mult = combo.multiplier * playerComboMultRaw * comboGlobal;
	
    try {
      const lastKey = this._lastComboKey[idx];
      if (lastKey === combo.key) {
        this._consecComboStreak[idx] = (this._consecComboStreak[idx] || 1) + 1;
      } else {
        this._consecComboStreak[idx] = 1;
      }
      this._lastComboKey[idx] = combo.key;

      const streak = Math.max(1, this._consecComboStreak[idx] || 1);
      const streakMult = player.upgrades.getComboStreakMultiplier ? player.upgrades.getComboStreakMultiplier(streak) : 1;
      if (streakMult !== 1) {
        mult = Math.round(mult * 100) / 100;
        mult *= streakMult;
      }
    } catch (e) {
      this._lastComboKey[idx] = combo.key;
      if (typeof this._consecComboStreak[idx] === 'undefined') this._consecComboStreak[idx] = 1;
    }

    comboTotalMult = mult;
    gained = Math.floor(gained * mult);

    showComboText(this, combo.type, combo.intensity);
    playComboFX(this, combo.key);
    if (GlobalAudio && combo.key && typeof GlobalAudio.comboSFX === 'function') {
      GlobalAudio.comboSFX(this, combo.key);
    }

    try {
      if (!player.isAI) {
        if (combo.key === 'straight') {
          try { GlobalAchievements.addStraights(1); } catch (e) {}
        }

        if (combo.key === 'fullHouse' || combo.key === 'powerHouse') {
          this._consecutiveComboCounter[idx] = (this._consecutiveComboCounter[idx] || 0) + 1;
          if (this._consecutiveComboCounter[idx] >= 5) {
            try { GlobalAchievements.maybeUnlock('funHouse'); } catch (e) {}
          }
        } else {
          this._consecutiveComboCounter[idx] = 0;
        }

        if (combo.key === 'fourOfAKind') GlobalAchievements.unlockComboAchievement('fourOfAKind');
        if (combo.key === 'fiveOfAKind') GlobalAchievements.unlockComboAchievement('fiveOfAKind');
        if (combo.key === 'sixOfAKind') GlobalAchievements.unlockComboAchievement('sixOfAKind');
        GlobalAchievements._maybeDisplayNotifications();
      }
    } catch (e) {
      console.warn('[AchievementsHook] failed during in-play unlock', e);
    }
  } else {
    this._lastComboKey[idx] = null;
    this._consecComboStreak[idx] = 0;
    comboTotalMult = 1;
  }

  try {
    if (!player.isAI && gained >= 10000) {
      GlobalAchievements.maybeUnlock('boomDicealaka');
    }
  } catch (e) {}

  const comboLabel = combo && combo.key ? ` (${COMBO_DISPLAY_NAMES[combo.key] || combo.key})` : '';
  this._logActivity(`${player.name} rolled [${raw.join(', ')}] -> +${formatCompact(gained)}${comboLabel}`);

  this.updateDiceScoreDisplay(raw, gained, combo, player);

  player.score += gained;

  // Rollicane phase adds a time tradeoff and grants points every second while spinning.
  const rollMultiplierForRollicane = diceMultiplier * (combo ? comboTotalMult : 1);
  const rollicaneBonus = await this.runRollicanePhase(player, raw, activeDice, rollMultiplierForRollicane);
  if (rollicaneBonus > 0) {
    this._logActivity(`${player.name} gained ${formatCompact(rollicaneBonus)} from Dice Spin`);
  }
  GlobalDebug.rollResult({
    playerIndex: this.currentPlayerIndex,
    playerName: player?.name,
    dice: raw,
    scored: gained + rollicaneBonus
  });

  this.isRolling = false;

  // Check for in-game score achievements (only for human players)
  if (!player.isAI) {
    if (player.score >= 1000) GlobalAchievements.maybeUnlock('score1000');
    if (player.score >= 10000) GlobalAchievements.maybeUnlock('score10000');
    if (player.score >= 100000) GlobalAchievements.maybeUnlock('score100000');
    if (player.score >= 1000000) GlobalAchievements.maybeUnlock('score1000000');
    if (player.score >= 10000000) GlobalAchievements.maybeUnlock('score10000000');
  }

  this.waitingForResult = true;
  this.rollBtn.setText(this._t('GAME_RESULTS', 'RESULTS'));
  this.rollBtn.setStyle({ color: '#888888' });
  this.rollBtn.disableInteractive();

  this.updateTurnUI();
  if (player.isAI) {
    this.time.delayedCall(1200, () => this.endTurn('ai'));
  }
}

  async runRollicanePhase(player, rolledFaces, activeDice, rollMultiplier = 1) {
    const spinConfig = player?.upgrades?.getSpinEffectConfig?.();
    if (!spinConfig) return 0;
    if (!Array.isArray(rolledFaces) || !rolledFaces.length) return 0;

    const chance = Math.max(0, Math.min(1, Number(spinConfig.chance ?? 0)));
    if (!Number.isFinite(chance) || chance <= 0) return 0;

    const minSecRaw = Number(spinConfig.minSec ?? 2);
    const maxSecRaw = Number(spinConfig.maxSec ?? 10);
    const minSec = Math.max(0.1, Number.isFinite(minSecRaw) ? minSecRaw : 2);
    const maxSec = Math.max(minSec, Number.isFinite(maxSecRaw) ? maxSecRaw : minSec);
    const spinLabel = spinConfig.label || 'Rollicane';

    const spinning = [];
    for (let i = 0; i < rolledFaces.length; i++) {
      if (Math.random() < chance) {
        const seconds = (Number.isInteger(minSec) && Number.isInteger(maxSec))
          ? Phaser.Math.Between(minSec, maxSec)
          : Phaser.Math.FloatBetween(minSec, maxSec);
        spinning.push({
          index: i,
          face: rolledFaces[i],
          seconds
        });
      }
    }

    if (!spinning.length) return 0;

    let totalBonus = 0;

    this._logActivity(`${player.name} triggered ${spinLabel} (${spinning.length} dice spinning)`);

    await animateDiceSpin(this, activeDice, spinning, {
      onTick: (_second, activeForSecond) => {
        const baseTick = activeForSecond.reduce((sum, entry) => sum + entry.face, 0);
        if (baseTick <= 0) return;

        const tickGain = Math.floor(baseTick * Math.max(1, rollMultiplier));
        totalBonus += tickGain;
        player.score += tickGain;

        const tickLabel = this._fmt('GAME_ROLLICANE_TICK', 'Rollicane +{0}', formatCompact(tickGain));
        const tickText = this.add.text(600, 260, tickLabel, {
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

        this.updateTurnUI();
      }
    });

    return totalBonus;
  }

  buyDice(automated = false) {
    if (this.currentPlayerIndex < 0 || this.currentPlayerIndex >= this.playerCount) return false;
    const player = this.players[this.currentPlayerIndex];

    const nextIndex = player.diceUnlocked - 1;
    if (nextIndex >= this.diceCosts.length) return false;
    const baseCost = this.diceCosts[nextIndex];
    const cost = Math.floor(baseCost * this.costMult);

    if (!automated) {
      if (this.isRolling || this.waitingForResult) return false;
      if (this.currentPlayerIndex !== this.getLocalPlayerIndex()) return false;
      if (player.isAI) return false;
    }

    if (player.score >= cost) {
      player.score -= cost;
      player.diceUnlocked = Math.min(6, player.diceUnlocked + 1); // cap at 6 dice
      GlobalAudio.playButton(this);
      this._logActivity(`${player.name} bought Dice -> ${player.diceUnlocked} dice`);
      // Regenerate Clairvoyance prediction if active
      const predictionChance = player.upgrades.getClairvoyanceChance ? player.upgrades.getClairvoyanceChance() : 0;
      if (this.prediction && predictionChance > 0) {
        const luckBonus = player.upgrades.getLuckBonus();
        const baseLuck = player.luck || 1;
        const effectiveLuck = Phaser.Math.Clamp(baseLuck + luckBonus, 0.5, 6.0);
        let pred = Array.from({ length: player.diceUnlocked }, () => Phaser.Math.Between(1, 6));
        pred = pred.map(v => {
          const rerollChance = Phaser.Math.Clamp((effectiveLuck - 1) / 5, 0, 1);
          if (Math.random() < rerollChance) {
            const bias = Math.pow(Math.random(), 1 / Math.max(0.001, effectiveLuck));
            return Phaser.Math.Clamp(Math.ceil(bias * 6), 1, 6);
          }
          return v;
        });
        if (effectiveLuck >= 2) {
          const boostFraction = Phaser.Math.Clamp((effectiveLuck - 1) / 5, 0, 1);
          const toCoerce = Math.floor(boostFraction * (player.diceUnlocked - 1));
          if (toCoerce > 0) {
            const counts = {};
            pred.forEach(n => counts[n] = (counts[n] || 0) + 1);
            let targetFace = 6;
            let bestCount = -1;
            Object.keys(counts).forEach(k => {
              const c = counts[k];
              if (c > bestCount) { bestCount = c; targetFace = parseInt(k, 10); }
            });
            if (effectiveLuck >= 4 && Math.random() < 0.6) targetFace = 6;
            let coerced = 0;
            const indices = Array.from({ length: pred.length }, (_, i) => i).sort(() => Math.random() - 0.5);
            for (let idx of indices) {
              if (coerced >= toCoerce) break;
              if (pred[idx] !== targetFace && Math.random() < 0.9) {
                pred[idx] = targetFace;
                coerced++;
              }
            }
          }
        }
        this.prediction = pred;
        if (!player.isAI) {
          this.predictionText.setText(`Prediction: ${this.prediction.join(', ')}`);
        }
      }
      this.updateTurnUI();
      return true;
    }

    return false;
  }

  buyEconomy(automated = false) {
    if (this.currentPlayerIndex < 0 || this.currentPlayerIndex >= this.playerCount) return false;
    const player = this.players[this.currentPlayerIndex];

    if (!automated) {
      if (this.isRolling || this.waitingForResult) return false;
      if (this.currentPlayerIndex !== this.getLocalPlayerIndex()) return false;
      if (player.isAI) return false;
    }

    const cost = player.upgrades.getScaledEconomyCost?.(this.costMult) ?? Math.floor(player.upgrades.getEconomyCost() * this.costMult);

    const ecoCap = player.upgrades.getEconomyCap ? player.upgrades.getEconomyCap() : 50;
    if (player.upgrades.getEconomyLevel() < ecoCap && player.score >= cost) {
      player.score -= cost;
      player.upgrades.upgradeEconomy();
      GlobalAudio.playButton(this);
      this._logActivity(`${player.name} upgraded Economy -> Lv ${player.upgrades.getEconomyLevel()}`);
      this.updateTurnUI();
      return true;
    }

    return false;
  }

  shouldBuyEconomy(player) {
    const ecoLvl = player.upgrades.getEconomyLevel();
    const ecoCap = player.upgrades.getEconomyCap ? player.upgrades.getEconomyCap() : 50;
    if (ecoLvl >= ecoCap) return false;
    const cost = Math.floor(player.upgrades.getEconomyCost() * this.costMult);
    return player.score > cost * 1.5;
  }

  buyLuck(automated = false) {
    if (this.currentPlayerIndex < 0 || this.currentPlayerIndex >= this.playerCount) return false;
    const player = this.players[this.currentPlayerIndex];

    if (!automated) {
      if (this.isRolling || this.waitingForResult) return false;
      if (this.currentPlayerIndex !== this.getLocalPlayerIndex()) return false;
      if (player.isAI) return false;
    }

    const cost = player.upgrades.getScaledLuckCost?.(this.costMult) ?? Math.floor(player.upgrades.getLuckCost() * this.costMult);
    const currentEffective = Math.min(player.luck + player.upgrades.getLuckBonus(), 6);

    if (currentEffective >= 6) return false;

    if (player.upgrades.getLuckLevel() < 25 && player.score >= cost && (player.luck + player.upgrades.getLuckBonus()) < 6) {
      player.score -= cost;
      player.upgrades.upgradeLuck();
      GlobalAudio.playButton(this);
    const luckMult = Math.min(player.luck + player.upgrades.getLuckBonus(), 6);
    this._logActivity(`${player.name} upgraded Luck -> Lv ${player.upgrades.getLuckLevel()} (x${this._formatMultiplier(luckMult, 1)})`);
      this.updateTurnUI();
      return true;
    }

    return false;
  }

  shouldBuyLuck(player) {
    const luckLvl = player.upgrades.getLuckLevel();
    if (luckLvl >= 25) return false;
    const cost = Math.floor(player.upgrades.getLuckCost() * this.costMult);
    return player.score > cost * 1.5;
  }

  buyCombo(key, automated = false) {
    if (this.currentPlayerIndex < 0 || this.currentPlayerIndex >= this.playerCount) return false;
    const player = this.players[this.currentPlayerIndex];

    if (!automated) {
      if (this.isRolling || this.waitingForResult) return false;
      if (this.currentPlayerIndex !== this.getLocalPlayerIndex()) return false;
      if (player.isAI) return false;
    }

    const req = this.comboRequirements[key] ?? 2;
    if (player.diceUnlocked < req) return false;

    const rawCost = player.upgrades.getComboCost(key);
    const cost = Math.floor(rawCost * this.costMult);

    if (player.score >= cost) {
      player.score -= cost;
      player.upgrades.upgradeCombo(key);
      GlobalAudio.playButton(this);
      this._logActivity(`${player.name} upgraded ${COMBO_DISPLAY_NAMES[key] || key} -> Lv ${player.upgrades.getComboLevel(key)}`);
      this.updateTurnUI();
      return true;
    }

    return false;
  }

  endTurn(reason = 'auto') {
    const endingIndex = this.currentPlayerIndex;
    const endingPlayer = this.players[endingIndex];
    if (endingPlayer) {
      GlobalDebug.turnEnd({ playerIndex: endingIndex, playerName: endingPlayer.name, reason });
    }

    this.isRolling = false;
    this.waitingForResult = false;
    this._setBuyUIEnabled(true);

    this.rollBtn.setText(this._t('GAME_ROLL_DICE', 'ROLL DICE'));
    this.rollBtn.setStyle({ color: '#66ff66' });
    this.rollBtn.setInteractive();

    this.currentPlayerIndex++;

    if (this.currentPlayerIndex >= this.playerCount) {
      this.currentPlayerIndex = 0;
      this.currentRound++;

      // award one completed round to global achievements
      try {
        GlobalAchievements.addRounds(1);
      } catch (e) {}

      if (this.currentRound > this.maxRounds) {
        return this.endGame();
      }
    }

    const maxScore = Math.max(...this.players.map(p => p.score));
    this.players.forEach((p, idx) => {
      if (p.score >= maxScore * 0.9) this.behindTracker[idx] = false;
    });

    try { this.lastRollText.setText(''); } catch (e) {}

    this.updateTurnUI();
    this.closeComboToolbarInstant();
  }

  updateTurnUI() {
    this.headerText.setText(this._t('GAME_TITLE', 'Scale Dice'));
    this.roundText.setText(this._fmt('GAME_ROUND_LABEL', 'Round {0} / {1}', this.currentRound, this.maxRounds));

    const p = this.players[this.currentPlayerIndex];
    this.startTurn(p);

    if (this.teamsEnabled) {
      let blue = 0, red = 0;
      this.players.forEach(pl => {
        if (pl.team === 'red') red += pl.score;
        else blue += pl.score;
      });
      this.headerText.setText(this._fmt('GAME_TEAM_SCORE', 'Scale Dice - Blue: {0}  Red: {1}', formatCompactFull(blue), formatCompactFull(red)));
    } else {
      this.headerText.setText(this._t('GAME_TITLE', 'Scale Dice'));
    }

    // Show the current player's last roll from the previous round
    if (!this.waitingForResult && p.lastRoll && p.lastRoll.length) {
      this.lastRollText.setText(this._fmt('GAME_LAST_ROLL', 'Last Roll: {0}', p.lastRoll.join(', ')));
    } else {
      this.lastRollText.setText('');
    }

    const isActiveHumanTurn = (this.currentPlayerIndex === this.getLocalPlayerIndex()) && !p.isAI && !this.isRolling;
    const canRollNow = isActiveHumanTurn && !this.waitingForResult;
    const canEndTurnNow = isActiveHumanTurn && this.waitingForResult;

    if (this.isRolling || this.waitingForResult) {
      this._setBuyUIEnabled(false);
    }

    if (this.waitingForResult) {
      this.rollBtn.setText(this._t('GAME_RESULTS', 'RESULTS'));
      this.rollBtn.disableInteractive();
      this.rollBtn.setStyle({ color: '#888888' });
    } else {
      if (p.isAI) {
        this.rollBtn.setText(this._t('GAME_WAITING', 'Waiting...'));
        this.rollBtn.disableInteractive();
        this.rollBtn.setStyle({ color: '#888888' });
        if (!this.isRolling && !this.waitingForResult) {
          const delayMs = this.getBotActionDelayMs(p);
          if (this._botActionTimer) {
            try { this._botActionTimer.remove(false); } catch (e) {}
            this._botActionTimer = null;
          }
          this._botActionTimer = this.time.delayedCall(Math.max(0, delayMs), () => {
            this._botActionTimer = null;
            this.runBotTurn(p);
          });
        }
      } else if (!this.isRolling) {
        this.rollBtn.setText(this._t('GAME_ROLL_DICE', 'ROLL DICE'));
        this.rollBtn.setStyle({ color: '#66ff66' });
        this.rollBtn.setInteractive();
      } else {
        this.rollBtn.setText(this._t('GAME_ROLLING', 'Rolling...'));
        this.rollBtn.disableInteractive();
        this.rollBtn.setStyle({ color: '#c4c70bd2' });
      }
    }

    if (this.endTurnBtn) {
      if (canEndTurnNow) {
        this.endTurnBtn.setInteractive({ useHandCursor: true });
        this.endTurnBtn.setStyle({ color: '#ff4444' });
      } else {
        this.endTurnBtn.disableInteractive();
        this.endTurnBtn.setStyle({ color: '#666666' });
      }
    }

    const nextDiceBase = this.diceCosts[p.diceUnlocked - 1];
    const nextDiceCost = nextDiceBase ? Math.floor(nextDiceBase * this.costMult) : null;

    if (canRollNow && nextDiceCost && p.score >= nextDiceCost && p.diceUnlocked <= 5) {
      this.buyDiceBtn.setInteractive();
      this.buyDiceBtn.setStyle({ color: '#ffaa44' });
    } else {
      this.buyDiceBtn.disableInteractive();
      this.buyDiceBtn.setStyle({ color: '#555555' });
    }

    const ecoCost = p.upgrades.getScaledEconomyCost?.(this.costMult) ?? Math.floor(p.upgrades.getEconomyCost() * this.costMult);
    if (canRollNow && p.upgrades.canUpgradeEconomy(p.score, this.costMult) && p.score >= ecoCost) {
      this.buyEcoBtn.setInteractive();
      this.buyEcoBtn.setStyle({ color: '#66ccff' });
    } else {
      this.buyEcoBtn.disableInteractive();
      this.buyEcoBtn.setStyle({ color: '#555555' });
    }

    const luckCost = p.upgrades.getScaledLuckCost?.(this.costMult) ?? Math.floor(p.upgrades.getLuckCost() * this.costMult);
    if (canRollNow && p.upgrades.canUpgradeLuck(p.score, p.luck, this.costMult) && p.score >= luckCost) {
      this.buyLuckBtn.setInteractive();
      this.buyLuckBtn.setStyle({ color: '#ff88ff' });
    } else {
      this.buyLuckBtn.disableInteractive();
      this.buyLuckBtn.setStyle({ color: '#555555' });
    }

    this.turnText.setText(this._fmt('GAME_TURN_LINE', "{0}'s Turn  |  Score: {1}  |  Dice: {2}", p.name, formatCompactFull(p.score), p.diceUnlocked));

    const hasLastRoll = Array.isArray(p.lastRoll) && p.lastRoll.length > 0;
    this.diceSprites.forEach((d, i) => {
      if (i < p.diceUnlocked) {
        d.setVisible(true);
        const face = hasLastRoll ? (p.lastRoll[i] ?? Math.min(i + 1, 6)) : Math.min(i + 1, 6);
        d.setTexture(`dice${face}`);
      } else {
        d.setVisible(false);
      }
    });

    const diceLevel = Math.max(0, Math.min(5, p.diceUnlocked - 1));
    const diceLevelText = diceLevel >= 5 ? 'MAX' : `Lv ${diceLevel}/5`;
    this.diceCostText.setText(
      nextDiceCost
        ? this._fmt('GAME_NEXT_DICE', 'Next Dice: {0} ({1})', formatCompact(nextDiceCost), diceLevelText)
        : this._t('GAME_MAX_DICE', 'Max Dice')
    );

    const ecoCap = p.upgrades.getEconomyCap ? p.upgrades.getEconomyCap() : 50;
    this.ecoCostText.setText(
      p.upgrades.getEconomyLevel() < ecoCap
        ? this._fmt('GAME_ECO_UPGRADE', 'Eco Upgrade: {0} (Lv {1}/{2})', formatCompact(ecoCost), p.upgrades.getEconomyLevel(), ecoCap)
        : this._t('GAME_ECO_MAX', 'Eco MAX')
    );
    this.luckCostText.setText(
      p.upgrades.getLuckLevel() < 25
        ? this._fmt('GAME_LUCK_UPGRADE', 'Luck Upgrade: {0} (Lv {1}/25)', formatCompact(luckCost), p.upgrades.getLuckLevel())
        : this._t('GAME_LUCK_MAX', 'Luck MAX')
    );

    const available = this.getAvailableComboKeysForPlayer(p);
    if (JSON.stringify(available) !== JSON.stringify(this.comboKeys)) {
      if (Array.isArray(this.comboToolbar) && this.comboToolbar.length) {
        this.comboToolbar.forEach(c => Object.values(c.ui).forEach(o => o?.destroy?.()));
        this.comboToolbar = [];
      }
      this.createComboToolbar();
    }

    this.refreshComboToolbarForPlayer(p);
    this.updatePlayerBar();
    this.refreshBigUpgradesPanel();

    // Clairvoyance prediction clearing
    const predictionChance = p?.upgrades?.getClairvoyanceChance ? p.upgrades.getClairvoyanceChance() : 0;
    if (predictionChance <= 0 || this.currentPlayerIndex !== this.getLocalPlayerIndex()) {
      this.prediction = null;
      if (!p.isAI) {
        this.predictionText.setText('');
      }
    }
  }

  updateDiceScoreDisplay(dice, scored, combo = null, player = null) {
  const base = dice.reduce((a, b) => a + b, 0);
  const diceMultiplier = player?.upgrades?.getDiceScoreMultiplier?.() || 1;

  let lines = [];
  lines.push(`Rolled: ${dice.join(', ')}`);
  lines.push(`Base Score: ${base}`);

  let workingBase = base * diceMultiplier;

  if (diceMultiplier !== 1) {
    lines.push(`Roll Multiplier: x${this._formatMultiplier(diceMultiplier, 2)} = ${formatCompact(Math.floor(workingBase))}`);
  }

  if (combo && player) {
    let comboName =
      COMBO_DISPLAY_NAMES?.[combo.key] ||
      combo.type ||
      combo.key ||
      'Combo';

    if (combo.key === 'straight') {
      comboName = combo.type;
    }

    const comboBaseMult = combo.multiplier || 1;
    const comboLevel = player.upgrades.getComboLevel?.(combo.key) || 0;
    const comboUpgradeMult = player.upgrades.getComboMultiplier?.(combo.key) || 1;
    const comboGlobal = player.upgrades.getComboGlobalMultiplier ? player.upgrades.getComboGlobalMultiplier() : 1;

    // ---- Combo Streak ----
    const streak = Math.max(1, this._consecComboStreak?.[this.currentPlayerIndex] || 1);
    const streakMult = player.upgrades.getComboStreakMultiplier ? player.upgrades.getComboStreakMultiplier(streak) : 1;
    const totalComboMult = comboBaseMult * comboUpgradeMult * comboGlobal * streakMult;

    lines.push(`Combo: ${comboName} (Level ${comboLevel}: x${this._formatMultiplier(comboUpgradeMult * comboGlobal, 2)})`);
    lines.push(`Base Multiplier: x${this._formatMultiplier(comboBaseMult, 2)}`);

    if (streakMult !== 1) {
      const streakLabel = player.upgrades.getComboStreakLabel?.() || 'Combo Streak';
      const bonusPct = (streakMult * 100 - 100).toFixed(0);
      lines.push(`- ${streakLabel}: ${streak} (${bonusPct}%)`);
      lines.push(`  -> Streak Multiplier: x${this._formatMultiplier(streakMult, 2)}`);
    }

    lines.push(`Total Combo Multiplier: x${this._formatMultiplier(totalComboMult, 2)}`);
    const finalScore = Math.floor(workingBase * totalComboMult);
    lines.push(`Final Score: ${formatCompact(finalScore)}`);
  } else {
    lines.push(`Final Score: ${formatCompact(scored)}`);
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
  } catch (e) {}

  if (this._scoreDisplayTimer) this._scoreDisplayTimer.remove(false);
  this._scoreDisplayTimer = this.time.delayedCall(4200, () => {
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
    this._scoreDisplayTimer = null;
  });
}

  _isPlayerBehind(player) {
    const humanOnly = false;
    const others = this.players.filter(p => p !== player && (!humanOnly || !p.isAI));
    if (!others.length) return false;
    const maxScore = Math.max(...this.players.map(p => p.score));
    if (player.score >= maxScore * 0.8) return false;
    const maxDice = Math.max(...this.players.map(p => p.diceUnlocked));
    const maxEco = Math.max(...this.players.map(p => p.upgrades.getEconomyLevel()));
    const scoreLag = (player.score < maxScore * 0.6);
    const diceLag = (player.diceUnlocked < Math.max(1, Math.floor(maxDice - 1)));
    const ecoLag = (player.upgrades.getEconomyLevel() < Math.max(1, Math.floor(maxEco - 1)));
    const behindCount = [scoreLag, diceLag, ecoLag].filter(x => !!x).length;
    return behindCount >= 2;
  }

  _setBuyUIEnabled(enabled) {
    try {
      if (enabled) {
        this.buyDiceBtn.setStyle?.({ color: '#ffaa44' });
        this.buyEcoBtn.setStyle?.({ color: '#66ccff' });
        this.buyLuckBtn.setStyle?.({ color: '#ff88ff' });
      } else {
        this.buyDiceBtn.disableInteractive?.();
        this.buyDiceBtn.setStyle?.({ color: '#555555' });
        this.buyEcoBtn.disableInteractive?.();
        this.buyEcoBtn.setStyle?.({ color: '#555555' });
        this.buyLuckBtn.disableInteractive?.();
        this.buyLuckBtn.setStyle?.({ color: '#555555' });
      }
    } catch(e){}

    try {
      if (Array.isArray(this.comboToolbar)) {
        this.comboToolbar.forEach(entry => {
          try {
            if (enabled) {
              entry.ui.btn.setStyle?.({ color: '#66ff66' });
            } else {
              entry.ui.btn.disableInteractive?.();
              entry.ui.btn.setStyle?.({ color: '#555555' });
            }
          } catch(e){}
        });
      }
    } catch(e){}
  }

  createHistoryLog() {
    const pad = 12;
    const panelWidth = 420;
    const panelHeight = 380;
    const panelX = this.scale.width;
    const panelY = 10;
    const linesVisibleApprox = 12;

    this.history = {
      container: this.add.container(panelX, panelY).setDepth(950),
      bg: this.add.rectangle(0, 0, panelWidth, panelHeight, 0x000000, 0.75).setOrigin(1, 0),
      title: this.add.text(-10, 8, this._t('GAME_HISTORY_LOG', 'Activity Log'), { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#66ff66' }).setOrigin(1, 0)
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

    this.history.hint = this.add.text(-12, panelHeight - 18, this._t('GAME_SCROLL_MORE', 'Scroll to view more'), { fontSize: 10, fontFamily: 'Orbitron, Arial', color: '#888888' }).setOrigin(1, 0);
    this.history.container.add([this.history.bg, this.history.title, this.history.text, this.history.hint]);

    const maskGraphics = this.make.graphics({}, false);
    maskGraphics.fillStyle(0xffffff);
    const absLeft = panelX - panelWidth + pad;
    const absTop = panelY + textY;
    maskGraphics.fillRect(absLeft, absTop, panelWidth - pad * 2, panelHeight - textY - pad);
    this.history.mask = maskGraphics.createGeometryMask();
    this.history.text.setMask(this.history.mask);
    this.history.entries = [];
    this.history.scrollY = 0;
    this.history.maxScroll = 0;
    this.history.panelWidth = panelWidth;
    this.history.panelHeight = panelHeight;
    this.history.textX = textX;
    this.history.textY = textY;

    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      const px = pointer.x;
      const py = pointer.y;
      const left = panelX - panelWidth;
      const top = panelY;
      const right = panelX;
      const bottom = panelY + panelHeight;
      if (px >= left && px <= right && py >= top && py <= bottom) {
        const step = Math.sign(deltaY) * 24;
        this.history.scrollY = Phaser.Math.Clamp(this.history.scrollY + step, 0, Math.max(0, this.history.maxScroll));
        this._refreshHistoryDisplay();
      }
    });

    this.history.bg.setInteractive();
    this.history.bg.on('pointerdown', () => {
      this.history.scrollY = 0;
      this._refreshHistoryDisplay();
    });
  }

  _refreshHistoryDisplay() {
    if (!this.history) return;
    const joined = this.history.entries.join('\n\n');
    this.history.text.setText(joined);

    const metrics = this.history.text.getBounds();
    const contentHeight = metrics.height || 0;
    const visibleHeight = this.history.panelHeight - this.history.textY - 12;

    this.history.maxScroll = Math.max(0, contentHeight - visibleHeight);
    this.history.text.y = this.history.textY - this.history.scrollY;

    try {
      this.tweens.killTweensOf(this.history.text);
    } catch (e) {}
  }

  _logActivity(msg) {
    if (!this.history) return;
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = `[${ts}] ${msg}`;
    this.history.entries.unshift(entry);
    // keep newest at top, cap size
    this.history.entries = this.history.entries.slice(0, 300);
    // reset scroll to top so user sees newest automatically
    this.history.scrollY = 0;
    this._refreshHistoryDisplay();
  }

  endGame() {
    this.exitLocked = false;

    try {
      // Only register totals/rounds/games/match-score if there is at least one human player in the match
      const humanPlayersExist = this.players.some(p => !p.isAI);
      if (humanPlayersExist) {
        GlobalAchievements.addGame();
        // don't call addRounds here - we increment per completed round during play
        // top human score (ignore bots)
        const humanScores = this.players.filter(p => !p.isAI).map(p => p.score || 0);
        const topHuman = humanScores.length ? Math.max(...humanScores) : 0;
        GlobalAchievements.addMatchScore(topHuman);
      }

      // unlock combo achievements only if they were achieved by human players
      this.comboStats.forEach((c, idx) => {
        if (!c) return;
        const player = this.players[idx];
        if (player && !player.isAI) {
          if ((c.fourOfAKind || 0) > 0) GlobalAchievements.unlockComboAchievement('fourOfAKind');
          if ((c.fiveOfAKind || 0) > 0) GlobalAchievements.unlockComboAchievement('fiveOfAKind');
          if ((c.sixOfAKind || 0) > 0) GlobalAchievements.unlockComboAchievement('sixOfAKind');
        }
      });

      // Maximum Power: check if any human player reached fully upgraded state
      try {
        this.players.forEach((p, idx) => {
          if (!p || p.isAI) return;
          const hasMaxDice = (p.diceUnlocked >= 6);
          const ecoCap = (typeof p.upgrades.getEconomyCap === 'function') ? p.upgrades.getEconomyCap() : 50;
          const hasMaxEco = (typeof p.upgrades.getEconomyLevel === 'function') ? (p.upgrades.getEconomyLevel() >= ecoCap) : false;
          const hasMaxLuck = (typeof p.upgrades.getLuckLevel === 'function') ? (p.upgrades.getLuckLevel() >= 25) : false;
          const requiredBigs = ['clairvoyance','stockExchange','comboX','masterPredict','fixated','highStonks','comboMasher','rollicane'];
          const hasAllBigs = requiredBigs.every(k => (p.upgrades.hasBigUpgrade ? p.upgrades.hasBigUpgrade(k) : false));
          if (hasMaxDice && hasMaxEco && hasMaxLuck && hasAllBigs) {
            GlobalAchievements.maybeUnlock('maximumPower');
          }
        });
      } catch (e) {}

      // Track wins: if overall top is human, count a win and possibly unlock winners achievements
      try {
        const topScore = Math.max(...this.players.map(p => p.score || 0));
        const winners = this.players.map((p, idx) => ({ p, idx })).filter(x => (x.p.score || 0) === topScore);
        if (winners && winners.length > 0) {
          // If at least one top-scorer is a human, we register a win for that human (counts toward wins)
          const humanWinner = winners.find(w => !w.p.isAI);
          if (humanWinner) {
            GlobalAchievements.addWin(1);
          }
        }
      } catch (e) {
        console.warn('[AchievementsHook] failed to register win', e);
      }

    } catch (e) {
      console.warn('[AchievementsHook] failed to record achievements', e);
    }

    const notifs = GlobalAchievements.getNotifications();
    if (Array.isArray(notifs) && notifs.length > 0) {
      GlobalAchievements._displayAchievementSequence(notifs, () => {
        this._gotoPostGame();
      }, this);
    } else {
      this._gotoPostGame();
    }
  }

  _gotoPostGame() {
    this.registry.set("localPostGame", {
      players: this.playerCount,
      scores: this.players.map(p => p.score),
      combos: this.comboStats,
      rounds: this.maxRounds,
      names: this.players.map(p => p.name),
      teamsEnabled: this.teamsEnabled ? true : false,
      teams: this.players.map(p => p.team),
      challengeKey: this.challengeKey,
      challengeDate: this.challengeDate,
      challengeReward: this.challengeReward
    });

    this.scene.start('LocalPostGameScene');
  }

  addBackButton() {
    const back = this.add.text(50, 50, this._t('UI_BACK', '<- BACK'), { fontSize: 24, fontFamily: 'Orbitron, Arial', color: '#ff6666' }).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      if (!this.exitLocked) {
        this.scene.start('MenuScene');
      } else {
        this.toggleExitModal();
      }
    });
  }

  toggleExitModal() {
    if (this.exitModal) {
      this.closeExitModal();
      return;
    }
    this.showConfirmExit();
  }

  showConfirmExit() {
    if (this.exitModal) return;

    const bg = this.add.rectangle(600, 300, 500, 250, 0x000000, 0.8).setDepth(2000);
    const msg = this.add.text(600, 260, this._t('GAME_EXIT_CONFIRM', 'ARE YOU SURE YOU WANT\nTO RETURN TO THE MAIN MENU?'), { fontSize: 26, fontFamily: 'Orbitron, Arial', align: 'center' }).setOrigin(0.5).setDepth(2001);
    const yesBtn = this.add.text(550, 340, this._t('UI_YES', 'YES'), { fontSize: 28, fontFamily: 'Orbitron, Arial', color: '#66ff66' }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(2001);
    const noBtn = this.add.text(650, 340, this._t('UI_NO', 'NO'), { fontSize: 28, fontFamily: 'Orbitron, Arial', color: '#ff6666' }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(2001);

    yesBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.closeExitModal();
      this.scene.start('MenuScene');
    });

    noBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.closeExitModal();
    });

    this.exitModal = { bg, msg, yesBtn, noBtn };
  }

  closeExitModal() {
    if (!this.exitModal) return;
    const { bg, msg, yesBtn, noBtn } = this.exitModal;
    try { bg.destroy(); } catch (e) {}
    try { msg.destroy(); } catch (e) {}
    try { yesBtn.destroy(); } catch (e) {}
    try { noBtn.destroy(); } catch (e) {}
    this.exitModal = null;
  }

  cleanupScene() {
    try { this.closeExitModal(); } catch (e) {}
    try { if (this._scoreDisplayTimer) { this._scoreDisplayTimer.remove(false); this._scoreDisplayTimer = null; } } catch(e){}
    try { if (this._botActionTimer) { this._botActionTimer.remove(false); this._botActionTimer = null; } } catch(e){}
    try {
      if (Array.isArray(this.playerBar)) {
        this.playerBar.forEach(p => Object.values(p).forEach(o => { try { o?.destroy?.(); } catch(e){} }));
        this.playerBar = [];
      }
    } catch(e){}
    try {
      if (Array.isArray(this.comboToolbar)) {
        this.comboToolbar.forEach(c => { if (c && c.ui) Object.values(c.ui).forEach(o => { try { o?.destroy?.(); } catch(e){} }); });
        this.comboToolbar = [];
      }
      if (this.comboToggleBtn) { try { this.comboToggleBtn.destroy(); } catch(e){}; this.comboToggleBtn = null; }
    } catch(e){}
    try { if (this.predictionText) { this.predictionText.destroy(); this.predictionText = null; } } catch(e){}
    try { if (this.bigUpgradesPanel) {
      try { this.bigUpgradesPanel.panelBg.destroy(); } catch(e){}
      try { this.bigUpgradesPanel.title.destroy(); } catch(e){}
      try { this.bigUpgradesPanel.container.destroy(true); } catch(e){}
      this.bigUpgradesPanel = null;
    }} catch(e){}
    try {
      if (this.bigUpgradesToolbarContainer) {
        this.bigUpgradesToolbarContainer.destroy(true);
        this.bigUpgradesToolbarContainer = null;
      }
      if (Array.isArray(this.bigUpgradesToolbar)) {
        this.bigUpgradesToolbar.forEach(entry => {
          try { if (entry.buyBtn) entry.buyBtn.destroy(); } catch(e){}
          try { if (entry.title) entry.title.destroy(); } catch(e){}
          try { if (entry.desc) entry.desc.destroy(); } catch(e){}
          try { if (entry.rowBg) entry.rowBg.destroy(); } catch(e){}
        });
        this.bigUpgradesToolbar = null;
      }
    } catch(e){}
    const uiFields = ['rollBtn','endTurnBtn','buyDiceBtn','diceCostText','buyEcoBtn','ecoCostText','buyLuckBtn','luckCostText',
      'headerText','roundText','lastRollText','turnText','scoreBreakdown'];
    uiFields.forEach(name => { try { if (this[name] && this[name].destroy) { this[name].destroy(); this[name] = null; } } catch(e){} });
    try { if (Array.isArray(this.diceSprites)) { this.diceSprites.forEach(d => { try { d?.destroy?.(); } catch(e){} }); this.diceSprites = []; } } catch(e){}
    try { this.tweens.killAll(); } catch(e){}
    try { this.time.removeAllEvents(); } catch(e){}
    this.exitLocked = false;
  }
}
