import { formatCompact } from './FormatManager.js';

export default class UpgradeManager {
  constructor() {
    this.comboLevels = {};
    this.luckBonus = 0;
    this.luckLevel = 0;
    this.economyLevel = 0;
	this.bigUpgrades = new Set();
    this.clairvoyanceChance = 0;
    this.economyMultiplier = 1;
    this.comboGlobalMultiplier = 1;
    this.diceScoreMultiplier = 1;
  }

  // -------- Combo --------
  getComboLevel(key) {
    return this.comboLevels[key] ?? 0;
  }

  getComboCost(key) {
    const base = {
      pair: 10,
      twoPair: 20,
      triple: 30,
      fullHouse: 40,
      straight: 50,
      fourOfAKind: 60,
      fiveOfAKind: 100,
      threePair: 150,
      tripleTrend: 200,
      powerHouse: 200,
      sixOfAKind: 250,
    }[key] ?? 30;

    const lvl = this.getComboLevel(key);
    return Math.floor(base * Math.pow(1.5, lvl));
  }

  getScaledComboCost(key, costMult = 1) {
    return Math.floor(this.getComboCost(key) * (costMult || 1));
  }

  upgradeCombo(key) {
    this.comboLevels[key] = (this.comboLevels[key] ?? 0) + 1;
  }

  getComboMultiplier(key) {
    const lvl = this.getComboLevel(key);
    return 1 + lvl * 0.1;
  }

  // -------- Luck --------
  getLuckLevel() {
    return this.luckLevel;
  }

  getLuckBonus() {
    return this.luckBonus;
  }

  getLuckCost() {
    return Math.floor(50 * Math.pow(1.5, this.luckLevel));
  }

  getScaledLuckCost(costMult = 1) {
    return Math.floor(this.getLuckCost() * (costMult || 1));
  }

  canUpgradeLuck(score, baseLuck = 1, costMult = 1) {
    if (this.luckLevel >= 25) return false;
    if ((baseLuck + this.luckBonus) >= 6) return false;
    const cost = this.getScaledLuckCost(costMult);
    return score >= cost;
  }

  upgradeLuck() {
    if (this.luckLevel < 25) {
      this.luckBonus += 0.2;
      this.luckLevel++;
    }
  }

  getLuckMultiplier() {
    return 1 + this.luckBonus;
  }

  // -------- Economy --------
  getEconomyLevel() {
    return this.economyLevel;
  }

  getEconomyIncome() {
    const lvl = this.economyLevel;
    if (lvl <= 0) return 0;

    let baseIncome = Math.floor((lvl * (lvl + 1)) / 2);
    const fiveMilestones = [5, 15, 25, 35, 45];
    const tenMilestones = [10, 20, 30, 40, 50];

    let multiplier = 1;

    for (const m of fiveMilestones) {
      if (lvl >= m) multiplier *= 1.5;
    }

    for (const m of tenMilestones) {
      if (lvl >= m) multiplier *= 2;
    }

    // final income
    const income = Math.floor(baseIncome * multiplier);
    return income;
  }

  getEconomyCost() {
    return Math.floor(25 * Math.pow(1.3, this.economyLevel));
  }

  getScaledEconomyCost(costMult = 1) {
    return Math.floor(this.getEconomyCost() * (costMult || 1));
  }

  canUpgradeEconomy(score, costMult = 1) {
    if (this.economyLevel >= 50) return false;
    const cost = this.getScaledEconomyCost(costMult);
    return score >= cost;
  }

  upgradeEconomy() {
    if (this.economyLevel < 50) {
      this.economyLevel++;
    }
  }
  
  getHighStonksMultiplier(roundsDone = 0) {
    if (!this.hasBigUpgrade('highStonks')) return 1;
    const r = Math.max(0, roundsDone);
    return 1 + 0.05 * r;
  }
  
  // -------- Big Upgrades --------
  getBigUpgradeCost(key) {
    const costs = {
      clairvoyance: 500,
      stockExchange: 1000,
      comboX: 2500,
      masterPredict: 7500,
      fixated: 30000,
	  highStonks: 60000,
	  comboMasher: 150000
    };
    return costs[key] ?? Infinity;
  }

  hasBigUpgrade(key) {
    return this.bigUpgrades.has(key);
  }

  canBuyBigUpgrade(score, key) {
    return !this.hasBigUpgrade(key) && score >= this.getBigUpgradeCost(key);
  }

  buyBigUpgrade(key) {
    if (this.hasBigUpgrade(key)) return false;
    switch (key) {
      case 'clairvoyance':
        this.clairvoyanceChance = Math.max(this.clairvoyanceChance, 0.25);
        break;
      case 'masterPredict':
        this.clairvoyanceChance = Math.max(this.clairvoyanceChance, 0.5);
        break;
      case 'stockExchange':
        this.economyMultiplier = Math.max(this.economyMultiplier, 1.5);
        break;
      case 'comboX':
        this.comboGlobalMultiplier = Math.max(this.comboGlobalMultiplier, 1.5);
        break;
      case 'fixated':
        this.diceScoreMultiplier = Math.max(this.diceScoreMultiplier, 2);
        break;
	  case 'highStonks':
        break;
      case 'comboMasher':
        break;
      default:
        return false;
    }
    this.bigUpgrades.add(key);
    return true;
  }

  getClairvoyanceChance() { return this.clairvoyanceChance; }
  getEconomyMultiplier() { return this.economyMultiplier; }
  getComboGlobalMultiplier() { return this.comboGlobalMultiplier; }
  getDiceScoreMultiplier() { return this.diceScoreMultiplier; }
}