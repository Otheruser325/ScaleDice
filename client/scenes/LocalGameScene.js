import Dice from '../utils/DiceManager.js';
import { COMBO_BASE_MULT, COMBO_DISPLAY_NAMES, checkCombo, showComboText, playComboFX } from '../utils/ComboManager.js';
import { animateDiceRoll } from '../utils/AnimationManager.js';
import { formatCompact } from '../utils/FormatManager.js';
import UpgradeManager from '../utils/UpgradeManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';

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

    this.currentPlayerIndex = 0;
    this.currentRound = 1;
    this.isRolling = false;
    this.waitingForResult = false;
    this.diceCosts = [10, 100, 500, 3000, 20000];
    this.teamScoreText = null;
	
	this.playerTints = [
      0x66aaff,
      0xffdd66,
      0x66ff99,
      0xff6666
    ];

    this._lastTurnGivenRoundFor = Array(this.playerCount).fill(0);
    this.behindTracker = Array(this.playerCount).fill(true);
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
    this.dice = new Dice();

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
	
	this._bigUpgradeDefs = [
      { key: 'clairvoyance', title: 'Clairvoyance', baseCost: 500 },
      { key: 'stockExchange', title: 'Stock Exchange', baseCost: 1000 },
      { key: 'comboX', title: 'Combo-X', baseCost: 2500 },
      { key: 'masterPredict', title: 'Master Predict', baseCost: 7500 },
      { key: 'fixated', title: 'Fixated', baseCost: 30000 }
    ];
  }

  create() {
    this.headerText = this.add.text(600, 15, 'Scale Dice', { fontSize: 22, fontFamily: 'Orbitron, Arial', color: '#cccccc' }).setOrigin(0.5);
    this.roundText = this.add.text(600, 40, `Round ${this.currentRound} / ${this.maxRounds}`, { fontSize: 28, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);
    this.lastRollText = this.add.text(600, 72, '', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffffaa' }).setOrigin(0.5);
	this.predictionText = this.add.text(600, 85, '', { fontSize: 16, fontFamily: 'Orbitron, Arial', color: '#88ff88' }).setOrigin(0.5);

    this.turnText = this.add.text(600, 100, '', { fontSize: 24, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

    this.diceSprites = [];
    for (let i = 0; i < 6; i++) {
      const die = this.add.image(350 + i * 90, 360, 'dice1').setVisible(false);
      die.originalX = die.x;
      die.originalY = die.y;
      this.diceSprites.push(die);
    }

    this.rollBtn = this.add.text(600, 470, 'ROLL DICE', { fontSize: 36, fontFamily: 'Orbitron, Arial', color: '#66ff66' })
      .setOrigin(0.5).setInteractive()
      .on('pointerdown', () => {
        if (this.isRolling || this.waitingForResult) return;
        const p = this.players[this.currentPlayerIndex];
        if (p.isAI) return;
        this.handleRoll();
      });

    this.buyDiceBtn = this.add.text(600, 530, 'BUY DICE', { fontSize: 26, fontFamily: 'Orbitron, Arial', color: '#ffaa44' })
      .setOrigin(0.5).setInteractive().on('pointerdown', () => this.buyDice());
    this.diceCostText = this.add.text(600, 560, '', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffaa44' }).setOrigin(0.5);

    this.buyEcoBtn = this.add.text(600, 590, 'UPGRADE ECONOMY', { fontSize: 24, fontFamily: 'Orbitron, Arial', color: '#66ccff' })
      .setOrigin(0.5).setInteractive().on('pointerdown', () => this.buyEconomy());
    this.ecoCostText = this.add.text(600, 620, '', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#66ccff' }).setOrigin(0.5);

    this.buyLuckBtn = this.add.text(600, 650, 'UPGRADE LUCK', { fontSize: 24, fontFamily: 'Orbitron, Arial', color: '#ff88ff' })
      .setOrigin(0.5).setInteractive().on('pointerdown', () => this.buyLuck());
    this.luckCostText = this.add.text(600, 680, '', { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ff88ff' }).setOrigin(0.5);

    this.scoreBreakdown = this.add.text(600, 240, "", { fontSize: 20, fontFamily: 'Orbitron, Arial', color: '#ffffaa', align: 'center' }).setOrigin(0.5);

    this.exitLocked = true;
    this.events.once('shutdown', this.cleanupScene, this);
    this.events.once('destroy', this.cleanupScene, this);

    this.input.keyboard.on('keydown-SPACE', (e) => {
      const p = this.players[this.currentPlayerIndex];
      if (this.currentPlayerIndex === this.getLocalPlayerIndex() && !p.isAI && !this.isRolling && !this.waitingForResult) {
        this.handleRoll();
      }
    });

    this.input.keyboard.on('keydown-BACKSPACE', (e) => {
      GlobalAudio.playButton(this);
      if (!this.exitLocked) {
        this.scene.start('MenuScene');
      } else {
        this.showConfirmExit();
      }
    });

    this.input.keyboard.on('keydown-C', (e) => {
      const p = this.players[this.currentPlayerIndex];
      if (!p || p.isAI) return;
      if (this.isRolling || this.waitingForResult) return;
      if (this.currentPlayerIndex !== this.getLocalPlayerIndex()) return;
      this.toggleComboToolbar();
    });
	
    this.input.keyboard.on('keydown-B', () => {
      const p = this.players[this.currentPlayerIndex];
      if (!p || p.isAI) return;
      if (this.isRolling || this.waitingForResult) return;
      if (this.currentPlayerIndex !== this.getLocalPlayerIndex()) return;
      this.toggleBigUpgrades();
    });

    this.input.keyboard.on('keydown-ESC', (e) => {
      GlobalAudio.playButton(this);
      if (!this.exitLocked) {
        this.scene.start('MenuScene');
      } else {
        this.showConfirmExit();
      }
    });

    this.comboPanelOpen = false;
    this.comboToolbar = [];
    this.createComboToolbar();
    this.createPlayerBar();
    this.addBackButton();
    this.updateTurnUI();
	this.createHistoryLog();
	this.createBigUpgradesPanel();
	this.bigUpgradesOpen = false;
    this.bigUpgradesPanel.container.setVisible(false);
    this.bigUpgradesPanel.panelBg.setVisible(false);
    this.bigUpgradesPanel.title.setVisible(false);
	try {
      GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
    } catch (e) {}
    try {
      GlobalAchievements.registerScene(this);
      GlobalAchievements._maybeDisplayNotifications();
    } catch (e) {}

    this._sessionStartTs = Date.now();
  }
  
  getLocalPlayerIndex() {
    return this.currentPlayerIndex;
  }

  getAvailableComboKeysForPlayer(player) {
    return this.comboMeta
      .filter(c => player.diceUnlocked >= c.req)
      .sort((a, b) => a.req - b.req)
      .map(c => c.key);
  }

  createComboToolbar() {
	if (this.comboToggleBtn) {
      try { this.comboToggleBtn.destroy(); } catch (e) {}
      this.comboToggleBtn = null;
    }
	
    const player = this.players[this.currentPlayerIndex];
    this.comboKeys = this.getAvailableComboKeysForPlayer(player);

    const startY = 140;
    const baseX = 40;
    const hiddenX = -220;

    if (Array.isArray(this.comboToolbar) && this.comboToolbar.length) {
      this.comboToolbar.forEach(c => Object.values(c.ui).forEach(o => o?.destroy?.()));
      this.comboToolbar = [];
    }

    this.comboToggleBtn = this.add.text(hiddenX + 20, 120, '▶', { fontSize: 20, fontFamily: 'Orbitron, Arial', color: '#ffffff' })
      .setOrigin(0, 0.5)
      .setInteractive()
      .on('pointerdown', () => this.toggleComboToolbar());

    this.comboKeys.forEach((key, idx) => {
      const y = startY + idx * 56;
      const labelText = COMBO_DISPLAY_NAMES[key] ? COMBO_DISPLAY_NAMES[key] : key.toUpperCase();
      const label = this.add.text(hiddenX + 40, y, labelText, { fontSize: 16, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0, 0.5);
      const lvlText = this.add.text(hiddenX + 150, y, 'Lv 0', { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#ffff88' }).setOrigin(0, 0.5);
      const btn = this.add.text(hiddenX + 280, y, 'UPGRADE', { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#66ff66' }).setOrigin(0, 0.5).setInteractive();

      this.comboToolbar.push({
        key,
        ui: { label, lvlText, btn },
        baseX,
        hiddenX,
        y
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
		  this._logActivity(`${p.name} upgraded ${COMBO_DISPLAY_NAMES[key] || key} → Lv ${p.upgrades.getComboLevel(key)}`);
          this.updateTurnUI();
        }
      });
    });

    this.comboPanelOpen = false;
    this.comboToolbar.forEach(entry => {
      entry.ui.label.x = entry.hiddenX + 40;
      entry.ui.lvlText.x = entry.hiddenX + 120;
      entry.ui.btn.x = entry.hiddenX + 240;
    });
    this.comboToggleBtn.x = hiddenX + 20;
  }

  toggleComboToolbar() {
    const openX = 40;
    const hiddenX = -220;
    this.comboPanelOpen = !this.comboPanelOpen;

    this.comboToggleBtn.setText(this.comboPanelOpen ? '◀' : '▶');

    this.comboToolbar.forEach(entry => {
      const toXBase = this.comboPanelOpen ? (entry.baseX) : entry.hiddenX;
      const labelTargetX = toXBase + 40;
      const lvlTargetX = toXBase + 130;
      const btnTargetX = toXBase + 240;

      this.tweens.add({ targets: entry.ui.label, x: labelTargetX, duration: 300, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: entry.ui.lvlText, x: lvlTargetX, duration: 320, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: entry.ui.btn, x: btnTargetX, duration: 340, ease: 'Cubic.easeOut' });
    });

    const toggleTo = this.comboPanelOpen ? (40 - 20) : (hiddenX + 20);
    this.tweens.add({ targets: this.comboToggleBtn, x: toggleTo, duration: 300, ease: 'Cubic.easeOut' });
  }

  refreshComboToolbarForPlayer(player) {
    this.comboToolbar.forEach(entry => {
      const key = entry.key;
      const lvl = player.upgrades.getComboLevel(key);
      const comboXMult = (player.upgrades.hasBigUpgrade && player.upgrades.hasBigUpgrade('comboX')) ? 1.5 : 1;
      const upgradeMult = (player.upgrades.getComboMultiplier(key) || 1) * comboXMult;
      const baseMult = COMBO_BASE_MULT[key] || 1;
      const totalMult = baseMult * upgradeMult;

      entry.ui.lvlText.setText(`Lv ${lvl} (x${totalMult.toFixed(1)})`);

      const cost = Math.floor(player.upgrades.getComboCost(key) * this.costMult);
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
    if (!Array.isArray(this.comboToolbar)) return;
    this.comboToolbar.forEach(entry => {
      try {
        entry.ui.label.x = entry.hiddenX + 40;
        entry.ui.lvlText.x = entry.hiddenX + 120;
        entry.ui.btn.x = entry.hiddenX + 240;
      } catch(e){}
    });
    if (this.comboToggleBtn) {
      try { this.comboToggleBtn.setText('▶'); this.comboToggleBtn.x = -220 + 20; } catch(e){}
    }
    this.comboPanelOpen = false;
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
      ui.luck?.setText(`🍀 x${effective.toFixed(1)}`);
      const incomeVal = Math.floor(p.upgrades.getEconomyIncome() * ((p.upgrades.hasBigUpgrade && p.upgrades.hasBigUpgrade('stockExchange')) ? 1.5 : 1));
      ui.income?.setText(incomeVal > 0 ? `💰 +${formatCompact(incomeVal)}/turn` : '');
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
    } catch (e) {}
	
    this._lastTurnGivenRoundFor[this.currentPlayerIndex] = this.currentRound;

    const baseIncome = player.upgrades.getEconomyIncome();
    let ecoMult = player.upgrades.getEconomyMultiplier ? player.upgrades.getEconomyMultiplier() : 1;
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

    if (this.currentRound >= this.maxRounds - 4 && this._isPlayerBehind(player)) {
      const boost = Math.floor((this.maxRounds - this.currentRound + 1) * 50);
      player.score += boost;
      const boostText = this.add.text(760, 56, `Energy +${formatCompact(boost)}`, { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffdd66' }).setOrigin(0.5);
      this.tweens.add({
        targets: boostText,
        y: 36,
        alpha: 0,
        duration: 1100,
        onComplete: () => boostText.destroy()
      });
	  this._logActivity(`${player.name} received a big boost (${formatCompact(boost)}). Go catch 'em!`);
    }
  }

  getInitialLuck(isAI, difficulty) {
    if (!isAI) return 1;
    const map = { Baby: 0.5, Easy: 0.75, Medium: 1, Hard: 1.5, Nightmare: 2 };
    return map[difficulty] ?? 1;
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

    const diceCost = this.diceCosts[player.diceUnlocked - 1];
    const scaledDiceCost = Math.floor((diceCost || Infinity) * this.costMult);
    const expectedBase = player.diceUnlocked * 3.5;

    let availableComboKeys = this.getAvailableComboKeysForPlayer(player);

    const pickBestComboROI = () => {
      let best = null;
      for (let key of availableComboKeys) {
        const req = this.comboRequirements[key] ?? 2;
        if (player.diceUnlocked < req) continue;
        const rawCost = player.upgrades.getComboCost(key);
        const cost = Math.floor(rawCost * this.costMult);
        if (player.score < cost) continue;
        const baseMult = COMBO_BASE_MULT[key] || 1;
        const upgradeMult = player.upgrades.getComboMultiplier(key) || 1;
        const totalMult = baseMult * upgradeMult;
        const expectedGain = expectedBase * Math.max(0, totalMult - 1);
        const roi = expectedGain / Math.max(1, cost);
        if (!best || roi > best.roi) best = { key, roi, cost };
      }
      return best;
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
      const rawCost = player.upgrades.getComboCost(key);
      const cost = Math.floor(rawCost * this.costMult);
      if (player.score < cost) return false;
      return this.buyCombo(key, true);
    };
	
	const tryBuyBigNow = (key) => {
      const def = this._bigUpgradeDefs.find(d => d.key === key);
      if (!def) return false;

      if (player.upgrades.hasBigUpgrade?.(key)) return false;

      const cost = Math.max(1, Math.floor(def.baseCost * (this.costMult || 1)));
      if (player.score < cost) return false;

      player.score -= cost;

      const ok = player.upgrades.buyBigUpgrade?.(key);
      if (ok) {
        this._logActivity(
          `${player.name} bought ${def.title} for ${formatCompact(cost)}`
        );

        try { this.refreshBigUpgradesPanel(); } catch {}
        try { this.updateTurnUI(); } catch {}
        return true;
      }

      player.score += cost;
      return false;
    };
	
	const bigPriority = ['clairvoyance','stockExchange','comboX','masterPredict','fixated'];

    // DECISION TREE (same priorities but immediate actions & confirmation)

    // Hard / Nightmare bots: prefer dice early, then economy, then luck, then combos (ROI)
    if (player.difficulty === 'Hard' || player.difficulty === 'Nightmare') {
      availableComboKeys = availableComboKeys.filter(
        key => !this._shouldBotSkipCombo(player, key)
      );
	  
      if (diceCost && player.score >= scaledDiceCost) {
        if (tryBuyDiceNow()) return;
      }
	  
	  for (let k of bigPriority) {
        if (tryBuyBigNow(k)) return;
      }

      if (tryBuyEconomyNow()) return;

      if (tryBuyLuckNow()) return;

      const best = pickBestComboROI();
      if (best && tryBuyComboNow(best.key)) return;

      if (diceCost && player.score >= scaledDiceCost) {
        if (tryBuyDiceNow()) return;
      }

      this.handleRoll();
      return;
    }

    // Medium bots
    if (player.difficulty === 'Medium') {
      if (diceCost && player.score >= scaledDiceCost) {
        if (tryBuyDiceNow()) return;
      }
	  
	  for (let k of bigPriority) {
        if (tryBuyBigNow(k)) return;
      }
	  
	  if (tryBuyEconomyNow()) return;

      if (Math.random() < 0.25) {
        if (tryBuyLuckNow()) return;
      }

      const mediumPriority = ['fourOfAKind','straight','fullHouse','triple','twoPair','pair'];
      for (let k of mediumPriority) {
        const req = this.comboRequirements[k] ?? 2;
        if (player.diceUnlocked < req) continue;
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
	  
      const easyBigs = ['clairvoyance','stockExchange','comboX'];
      for (let k of easyBigs) {
        if (tryBuyBigNow(k)) return;
      }

      for (let k of ['triple','twoPair','pair']) {
        const req = this.comboRequirements[k] ?? 2;
        if (player.diceUnlocked < req) continue;
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
	  
	  const babyBigs = ['clairvoyance','stockExchange','comboX'];
      for (let k of babyBigs) {
        if (tryBuyBigNow(k)) return;
      }

      this.handleRoll();
      return;
    }

    this.handleRoll();
  }

  async handleRoll() {
    if (this.isRolling) return;

    this.isRolling = true;
	this._setBuyUIEnabled(false);
    this.rollBtn.disableInteractive();
    this.rollBtn.setText('Rolling...');
    this.rollBtn.setStyle({ color: '#c4c70bd2' });

    const player = this.players[this.currentPlayerIndex];
    GlobalAudio.playDice(this);
    const raw = this.dice.rollMany(player.diceUnlocked);
	
    if (!player.isAI && player.upgrades.getClairvoyanceChance && player.upgrades.getClairvoyanceChance() > 0) {
      const chance = player.upgrades.getClairvoyanceChance();
      if (Math.random() < chance) {
        const pred = Array.from({ length: player.diceUnlocked }, () => {
          return Phaser.Math.Between(4, 6);
        });

        if (this.currentPlayerIndex === this.getLocalPlayerIndex()) {
          this.predictionText.setText(`Prediction: ${pred.join(', ')}`);
          this.time.delayedCall(4000, () => {
            try { this.predictionText.setText(''); } catch (e) {}
          });
        }

        const nudgeCount = Math.max(1, Math.floor(player.diceUnlocked * 0.25));
        const idxs = Phaser.Utils.Array.NumberArray(0, player.diceUnlocked - 1);
        Phaser.Utils.Array.Shuffle(idxs);
        for (let k = 0; k < nudgeCount; k++) {
          const idx = idxs[k];
          if (Math.random() < 0.7) {
            raw[idx] = pred[idx];
          }
        }
      } else {
        this.predictionText.setText('');
      }
    }

    const luckBonus = player.upgrades.getLuckBonus();
    const baseLuck = player.luck || 1;
    const effectiveLuck = Phaser.Math.Clamp(baseLuck + luckBonus, 0.5, 6.0);

    const final = raw.map(v => {
      const rerollChance = Phaser.Math.Clamp((effectiveLuck - 1) / 5, 0, 1);

      if (Math.random() < rerollChance) {
        const bias = Math.pow(Math.random(), 1 / Math.max(0.001, effectiveLuck));
        return Phaser.Math.Clamp(Math.ceil(bias * 6), 1, 6);
      }

      return v;
    });

    // Additional light "combo boost" behavior for higher luck:
    if (effectiveLuck >= 2) {
      const boostFraction = Phaser.Math.Clamp((effectiveLuck - 1) / 5, 0, 1);
      const toCoerce = Math.floor(boostFraction * (player.diceUnlocked - 1));
      if (toCoerce > 0) {
        const counts = {};
        final.forEach(n => counts[n] = (counts[n] || 0) + 1);
        let targetFace = 6;
        let bestCount = -1;
        Object.keys(counts).forEach(k => {
          const c = counts[k];
          if (c > bestCount) { bestCount = c; targetFace = parseInt(k, 10); }
        });
        if (effectiveLuck >= 4 && Math.random() < 0.6) targetFace = 6;

        let coerced = 0;
        const indices = Array.from({ length: final.length }, (_, i) => i).sort(() => Math.random() - 0.5);
        for (let idx of indices) {
          if (coerced >= toCoerce) break;
          if (final[idx] !== targetFace && Math.random() < 0.9) {
            final[idx] = targetFace;
            coerced++;
          }
        }
      }
    }

    player.lastRoll = final.slice();
    this.lastRollText.setText(`Last: ${final.join(', ')}`);

    const activeDice = this.diceSprites.slice(0, player.diceUnlocked);
    await animateDiceRoll(this, final, activeDice);

    const combo = checkCombo(final);
    let gained = final.reduce((a, b) => a + b, 0);
	
	const diceMultiplier = player.upgrades.getDiceScoreMultiplier ? player.upgrades.getDiceScoreMultiplier() : 1;
    gained = Math.floor(gained * diceMultiplier);

    if (combo) {
      if (combo.key && this.comboStats[this.currentPlayerIndex] && typeof this.comboStats[this.currentPlayerIndex][combo.key] === 'number') {
        this.comboStats[this.currentPlayerIndex][combo.key]++;
      }

      const playerComboMult = player.upgrades.getComboMultiplier(combo.key);
      const comboGlobal = player.upgrades.getComboGlobalMultiplier ? player.upgrades.getComboGlobalMultiplier() : 1;
      const mult = combo.multiplier * playerComboMult * comboGlobal;
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
            this._consecutiveComboCounter[this.currentPlayerIndex] =
              (this._consecutiveComboCounter[this.currentPlayerIndex] || 0) + 1;

            if (this._consecutiveComboCounter[this.currentPlayerIndex] >= 5) {
              try { GlobalAchievements.maybeUnlock('funHouse'); } catch (e) {}
            }
          } else {
            this._consecutiveComboCounter[this.currentPlayerIndex] = 0;
          }
		  
          if (combo.key === 'fourOfAKind') GlobalAchievements.unlockComboAchievement('fourOfAKind');
          if (combo.key === 'fiveOfAKind') GlobalAchievements.unlockComboAchievement('fiveOfAKind');
          if (combo.key === 'sixOfAKind') GlobalAchievements.unlockComboAchievement('sixOfAKind');
          GlobalAchievements._maybeDisplayNotifications();
        }
      } catch (e) {
        console.warn('[AchievementsHook] failed during in-play unlock', e);
      }
    }
	
	const comboLabel = combo && combo.key ? ` (${COMBO_DISPLAY_NAMES[combo.key] || combo.key})` : '';
    this._logActivity(`${player.name} rolled [${final.join(', ')}] -> +${formatCompact(gained)}${comboLabel}`);

    this.updateDiceScoreDisplay(final, gained, combo, player);

    player.score += gained;

    this.waitingForResult = true;
    this.rollBtn.setText('RESULTS');
    this.rollBtn.setStyle({ color: '#888888' });
    this.rollBtn.disableInteractive();

    this.updateTurnUI();
    this.time.delayedCall(2000, () => {
      this.endTurn();
    });
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
	  this._logActivity(`${player.name} bought Dice → ${player.diceUnlocked} dice`);
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

    if (player.upgrades.getEconomyLevel() < 50 && player.score >= cost) {
      player.score -= cost;
      player.upgrades.upgradeEconomy();
      GlobalAudio.playButton(this);
	  this._logActivity(`${player.name} upgraded Economy → Lv ${player.upgrades.getEconomyLevel()}`);
      this.updateTurnUI();
      return true;
    }

    return false;
  }

  shouldBuyEconomy(player) {
    const ecoLvl = player.upgrades.getEconomyLevel();
    if (ecoLvl >= 50) return false;
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
	  this._logActivity(`${player.name} upgraded Luck → Lv ${player.upgrades.getLuckLevel()} (x${(Math.min(player.luck + player.upgrades.getLuckBonus(),6)).toFixed(1)})`);
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
	  this._logActivity(`${player.name} upgraded ${COMBO_DISPLAY_NAMES[key] || key} → Lv ${player.upgrades.getComboLevel(key)}`);
      this.updateTurnUI();
      return true;
    }

    return false;
  }
  
  createBigUpgradesPanel() {
    if (this.bigUpgradesPanel) return;

    const x = 12;
    const y = this.scale.height - 16;
    const w = 260;
    const h = 320;

    const panelBg = this.add.rectangle(x + w/2, y - h/2, w, h, 0x0b0b0b, 0.95).setOrigin(0.5).setDepth(900);
    panelBg.setStrokeStyle(2, 0x333333);

    const title = this.add.text(x + 12, y - h + 12, 'Big Upgrades (B)', { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#ffff66' }).setOrigin(0,0).setDepth(901);

    const items = [
      { key: 'clairvoyance', title: 'Clairvoyance', desc: '25% chance to predict your next roll.', baseCost: 500 },
      { key: 'stockExchange', title: 'Stock Exchange', desc: 'Economy +50% income.', baseCost: 1000 },
      { key: 'comboX', title: 'Combo-X', desc: 'Combo multipliers +50%.', baseCost: 2500 },
      { key: 'masterPredict', title: 'Master Predict', desc: 'Make clairvoyance 50% (requires Clairvoyance).', baseCost: 7500 },
      { key: 'fixated', title: 'Fixated', desc: 'Dice-earned scores ×2.', baseCost: 30000 }
    ];

    const container = this.add.container(0, 0).setDepth(901);
    const startX = x + 8;
    let startY = y - 36 - (items.length - 1) * 60;

    const buyBtns = [];

    items.forEach(item => {
      const box = this.add.rectangle(startX, startY, w - 16, 48, 0x121212, 0.9).setOrigin(0,0);
      box.setStrokeStyle(1, 0x222222);
      const itTitle = this.add.text(startX + 8, startY + 4, item.title, { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0,0);
      const itDesc = this.add.text(startX + 8, startY + 20, item.desc, { fontSize: 11, fontFamily: 'Orbitron, Arial', color: '#cccccc', wordWrap: { width: w - 120 } }).setOrigin(0,0);
      const buyBtn = this.add.text(startX + w - 96, startY + 12, 'BUY', { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#66ff66' })
        .setInteractive({ useHandCursor: true })
        .setOrigin(0,0);

      buyBtn.on('pointerdown', () => {
        this.attemptBuyBigUpgrade(item.key, item.title, item.baseCost);
      });

      container.add([box, itTitle, itDesc, buyBtn]);
      buyBtns.push({ key: item.key, baseCost: item.baseCost, buyBtn, itTitle, itDesc, box });
      startY += 52;
    });

    this.bigUpgradesPanel = { panelBg, title, container, items, buyBtns };
  }
  
  refreshBigUpgradesPanel() {
    if (!this.bigUpgradesPanel) return;
    const player = this.players[this.currentPlayerIndex];
    const isActiveHuman = player && !player.isAI && this.currentPlayerIndex === this.getLocalPlayerIndex();

    this.bigUpgradesPanel.buyBtns.forEach(entry => {
      const scaled = Math.max(1, Math.floor(entry.baseCost * (this.costMult || 1)));
      entry.buyBtn.setText(entry.buyBtn.text ? `BUY ${formatCompact(scaled)}` : `BUY ${formatCompact(scaled)}`);

      const purchased = player.upgrades.hasBigUpgrade ? player.upgrades.hasBigUpgrade(entry.key) : false;

      if (purchased) {
        entry.buyBtn.disableInteractive?.();
        entry.buyBtn.setStyle({ color: '#666666' });
        entry.itTitle.setStyle?.({ color: '#99ff99' });
      } else if (!isActiveHuman || this.isRolling || this.waitingForResult || player.score < scaled) {
        entry.buyBtn.disableInteractive?.();
        entry.buyBtn.setStyle({ color: '#555555' });
        entry.itTitle.setStyle?.({ color: '#ffffff' });
      } else {
        entry.buyBtn.setInteractive?.({ useHandCursor: true });
        entry.buyBtn.setStyle({ color: '#66ff66' });
        entry.itTitle.setStyle?.({ color: '#ffffff' });
      }
    });
  }

  attemptBuyBigUpgrade(key, title, baseCost) {
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
  
  toggleBigUpgrades() {
    if (!this.bigUpgradesPanel) return;
    this.bigUpgradesOpen = !this.bigUpgradesOpen;

    this.bigUpgradesPanel.container.setVisible(this.bigUpgradesOpen);
    this.bigUpgradesPanel.panelBg.setVisible(this.bigUpgradesOpen);
    this.bigUpgradesPanel.title.setVisible(this.bigUpgradesOpen);

    if (this.bigUpgradesOpen) {
      this.refreshBigUpgradesPanel();
    }
  }

  closeBigUpgradesInstant() {
    if (!this.bigUpgradesPanel) return;
    this.bigUpgradesOpen = false;
    this.bigUpgradesPanel.container.setVisible(false);
    this.bigUpgradesPanel.panelBg.setVisible(false);
    this.bigUpgradesPanel.title.setVisible(false);
  }

  endTurn() {
    this.isRolling = false;
    this.waitingForResult = false;
	this._setBuyUIEnabled(true);

    this.rollBtn.setText('ROLL DICE');
    this.rollBtn.setStyle({ color: '#66ff66' });
    this.rollBtn.setInteractive();
	
	try {
      const prevIdx = this.currentPlayerIndex;
      if (this.players[prevIdx]) this.players[prevIdx].lastRoll = [];
    } catch(e){}

    this.currentPlayerIndex++;

    if (this.currentPlayerIndex >= this.playerCount) {
      this.currentPlayerIndex = 0;
      this.currentRound++;

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
  }

  updateTurnUI() {
    this.headerText.setText('Scale Dice');
    this.roundText.setText(`Round ${this.currentRound} / ${this.maxRounds}`);

    const p = this.players[this.currentPlayerIndex];
    this.closeComboToolbarInstant();
    this.startTurn(p);

    if (this.teamsEnabled) {
      let blue = 0, red = 0;
      this.players.forEach(pl => {
        if (pl.team === 'red') red += pl.score;
        else blue += pl.score;
      });
      this.headerText.setText(`Scale Dice — Blue: ${formatCompact(blue)}  Red: ${formatCompact(red)}`);
    } else {
      this.headerText.setText('Scale Dice');
    }

    if (p.lastRoll && p.lastRoll.length) {
      this.lastRollText.setText(`Last: ${p.lastRoll.join(', ')}`);
    } else {
      this.lastRollText.setText('');
    }

    const isActiveHuman = (this.currentPlayerIndex === this.getLocalPlayerIndex()) && !p.isAI && !this.isRolling && !this.waitingForResult;

    if (this.isRolling || this.waitingForResult) {
      this._setBuyUIEnabled(false);
    }

    if (this.waitingForResult) {
      this.rollBtn.setText('RESULTS');
      this.rollBtn.disableInteractive();
      this.rollBtn.setStyle({ color: '#888888' });
    } else {
      if (p.isAI) {
        this.rollBtn.setText('Waiting...');
        this.rollBtn.disableInteractive();
        this.rollBtn.setStyle({ color: '#888888' });
        if (!this.isRolling && !this.waitingForResult) {
          this.time.delayedCall(700, () => this.runBotTurn(p));
        }
      } else {
        if (!this.isRolling && !this.waitingForResult) {
          this.rollBtn.setText('ROLL DICE');
          this.rollBtn.setStyle({ color: '#66ff66' });
          this.rollBtn.setInteractive();
        } else if (this.isRolling) {
          this.rollBtn.setText('Rolling...');
          this.rollBtn.disableInteractive();
          this.rollBtn.setStyle({ color: '#c4c70bd2' });
        } else if (this.waitingForResult) {
          this.rollBtn.setText('RESULTS');
          this.rollBtn.disableInteractive();
          this.rollBtn.setStyle({ color: '#888888' });
        }
      }
    }

    const nextDiceBase = this.diceCosts[p.diceUnlocked - 1];
    const nextDiceCost = nextDiceBase ? Math.floor(nextDiceBase * this.costMult) : null;

    if (isActiveHuman && !this.isRolling && !this.waitingForResult && nextDiceCost && p.score >= nextDiceCost && p.diceUnlocked <= 5) {
      this.buyDiceBtn.setInteractive();
      this.buyDiceBtn.setStyle({ color: '#ffaa44' });
    } else {
      this.buyDiceBtn.disableInteractive();
      this.buyDiceBtn.setStyle({ color: '#555555' });
    }

    const ecoCost = p.upgrades.getScaledEconomyCost?.(this.costMult) ?? Math.floor(p.upgrades.getEconomyCost() * this.costMult);
    if (isActiveHuman && !this.isRolling && !this.waitingForResult && p.upgrades.canUpgradeEconomy(p.score, this.costMult) && p.score >= ecoCost) {
      this.buyEcoBtn.setInteractive();
      this.buyEcoBtn.setStyle({ color: '#66ccff' });
    } else {
      this.buyEcoBtn.disableInteractive();
      this.buyEcoBtn.setStyle({ color: '#555555' });
    }

    const luckCost = p.upgrades.getScaledLuckCost?.(this.costMult) ?? Math.floor(p.upgrades.getLuckCost() * this.costMult);
    if (isActiveHuman && !this.isRolling && !this.waitingForResult && p.upgrades.canUpgradeLuck(p.score, p.luck, this.costMult) && p.score >= luckCost) {
      this.buyLuckBtn.setInteractive();
      this.buyLuckBtn.setStyle({ color: '#ff88ff' });
    } else {
      this.buyLuckBtn.disableInteractive();
      this.buyLuckBtn.setStyle({ color: '#555555' });
    }

    this.turnText.setText(`${p.name}'s Turn  |  Score: ${formatCompact(p.score)}  |  Dice: ${p.diceUnlocked}`);

    this.diceSprites.forEach((d, i) => {
      if (i < p.diceUnlocked) {
        d.setVisible(true);
        if (p.lastRoll && this.waitingForResult) {
          d.setTexture(`dice${p.lastRoll[i] ?? Math.min(i + 1, 6)}`);
        } else {
          d.setTexture(`dice${Math.min(i + 1, 6)}`);
        }
      } else {
        d.setVisible(false);
      }
    });

    const diceLevel = Math.max(0, Math.min(5, p.diceUnlocked - 1));
    const diceLevelText = diceLevel >= 5 ? 'MAX' : `Lv ${diceLevel}/5`;
    this.diceCostText.setText(nextDiceCost ? `Next Dice: ${formatCompact(nextDiceCost)} (${diceLevelText})` : 'Max Dice');

    this.ecoCostText.setText(
      p.upgrades.getEconomyLevel() < 50
        ? `Eco Upgrade: ${formatCompact(ecoCost)} (Lv ${p.upgrades.getEconomyLevel()}/50)`
        : 'Eco MAX'
    );
    this.luckCostText.setText(
      p.upgrades.getLuckLevel() < 25
        ? `Luck Upgrade: ${formatCompact(luckCost)} (Lv ${p.upgrades.getLuckLevel()}/25)`
        : 'Luck MAX'
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
  }

  updateDiceScoreDisplay(dice, scored, combo = null, player = null) {
    const base = dice.reduce((a, b) => a + b, 0);
    let breakdown = `Rolled: ${dice.join(", ")}\nBase Score: ${base}`;
	const isFixated = player && player.upgrades.hasBigUpgrade && player.upgrades.hasBigUpgrade('fixated');
    if (isFixated) breakdown += `\nFixated: x2 -> ${base * 2}`;

    if (combo) {
      const baseMult = combo.multiplier || 1;
	  const comboXMult = (player && player.upgrades.hasBigUpgrade && player.upgrades.hasBigUpgrade('comboX')) ? 1.5 : 1;
      const upgradeMult = (player && combo.key) ? (player.upgrades.getComboMultiplier(combo.key) || 1) * comboXMult : comboXMult;
      const totalMult = baseMult * upgradeMult;

      const comboLevel = (player && combo.key) ? (player.upgrades.getComboLevel(combo.key) || 0) : 0;

      // use human-friendly combo display name
      const comboName = (combo.key && COMBO_DISPLAY_NAMES[combo.key]) ? COMBO_DISPLAY_NAMES[combo.key] : (combo.type || combo.key || 'Combo');

      breakdown += `\nCombo: x${totalMult.toFixed(1)} (${combo.type})`;
      breakdown += `\n${comboName} Level: ${comboLevel}`;
      breakdown += `\nFinal Score: ${formatCompact(scored)}`;
    } else {
      breakdown += `\nFinal Score: ${formatCompact(scored)}`;
    }

    this.scoreBreakdown.setText(breakdown);
    try {
      this.scoreBreakdown.setAlpha(0);
      this.tweens.killTweensOf(this.scoreBreakdown);
      this.tweens.add({ targets: this.scoreBreakdown, alpha: 1, duration: 220, ease: 'Cubic.easeOut' });
    } catch (e) {}

    if (this._scoreDisplayTimer) this._scoreDisplayTimer.remove(false);
    this._scoreDisplayTimer = this.time.delayedCall(4000, () => {
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
    title: this.add.text(-10, 8, 'Activity Log', { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#66ff66' }).setOrigin(1, 0)
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

  this.history.hint = this.add.text(-12, panelHeight - 18, 'Scroll to view more', { fontSize: 10, fontFamily: 'Orbitron, Arial', color: '#888888' }).setOrigin(1, 0);
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
        const roundsPlayed = Math.max(0, (this.currentRound - 1));
        GlobalAchievements.addRounds(roundsPlayed);

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
	  
	  // check playtime session
	  try {
        if (this._sessionStartTs) {
          const elapsedMs = Date.now() - this._sessionStartTs;
          const seconds = Math.floor(elapsedMs / 1000);
          GlobalAchievements.addPlaySeconds(seconds);
          this._sessionStartTs = 0;
        }
      } catch (e) {}

      // Maximum Power: check if any human player reached fully upgraded state
      try {
        this.players.forEach((p, idx) => {
          if (!p || p.isAI) return;
          const hasMaxDice = (p.diceUnlocked >= 6);
          const hasMaxEco = (typeof p.upgrades.getEconomyLevel === 'function') ? (p.upgrades.getEconomyLevel() >= 50) : false;
          const hasMaxLuck = (typeof p.upgrades.getLuckLevel === 'function') ? (p.upgrades.getLuckLevel() >= 25) : false;
          const requiredBigs = ['clairvoyance','stockExchange','comboX','masterPredict','fixated'];
          const hasAllBigs = requiredBigs.every(k => (p.upgrades.hasBigUpgrade ? p.upgrades.hasBigUpgrade(k) : false));
          if (hasMaxDice && hasMaxEco && hasMaxLuck && hasAllBigs) {
            GlobalAchievements.maybeUnlock('maximumPower');
          }
        });
      } catch (e) {}
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
      teams: this.players.map(p => p.team)
    });

    this.scene.start('LocalPostGameScene');
  }

  addBackButton() {
    const back = this.add.text(50, 50, '← Back', { fontSize: 24, fontFamily: 'Orbitron, Arial', color: '#ff6666' }).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      if (!this.exitLocked) {
        this.scene.start('MenuScene');
      } else {
        this.showConfirmExit();
      }
    });
  }

  showConfirmExit() {
    const bg = this.add.rectangle(600, 300, 500, 250, 0x000000, 0.8);
    const msg = this.add.text(600, 260, "Are you sure you want\n to return to the main menu?", { fontSize: 26, fontFamily: 'Orbitron, Arial', align: 'center' }).setOrigin(0.5);
    const yesBtn = this.add.text(550, 340, "Yes", { fontSize: 28, fontFamily: 'Orbitron, Arial', color: '#66ff66' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const noBtn = this.add.text(650, 340, "No", { fontSize: 28, fontFamily: 'Orbitron, Arial', color: '#ff6666' }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    yesBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('MenuScene');
    });

    noBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      bg.destroy();
      msg.destroy();
      yesBtn.destroy();
      noBtn.destroy();
    });
  }

  cleanupScene() {
	try {
      if (this._sessionStartTs) {
        const elapsedMs = Date.now() - this._sessionStartTs;
        const seconds = Math.floor(elapsedMs / 1000);
        GlobalAchievements.addPlaySeconds(seconds);
        this._sessionStartTs = 0;
      }
    } catch (e) {}
    try { if (this._scoreDisplayTimer) { this._scoreDisplayTimer.remove(false); this._scoreDisplayTimer = null; } } catch(e){}
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
    const uiFields = ['rollBtn','buyDiceBtn','diceCostText','buyEcoBtn','ecoCostText','buyLuckBtn','luckCostText',
      'headerText','roundText','lastRollText','turnText','scoreBreakdown'];
    uiFields.forEach(name => { try { if (this[name] && this[name].destroy) { this[name].destroy(); this[name] = null; } } catch(e){} });
    try { if (Array.isArray(this.diceSprites)) { this.diceSprites.forEach(d => { try { d?.destroy?.(); } catch(e){} }); this.diceSprites = []; } } catch(e){}
    try { this.tweens.killAll(); } catch(e){}
    try { this.time.removeAllEvents(); } catch(e){}
    this.exitLocked = false;
  }
}