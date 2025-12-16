import { formatCompact } from './FormatManager.js';

export default class UpgradeManager {
  constructor() {
    this.comboLevels = {};   // e.g. { pair: 2, triple: 1 }
    this.luckBonus = 0;      // additive luck bonus (0.2 per upgrade)
    this.luckLevel = 0;      // 0..25
    this.economyLevel = 0;   // 0..50
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
}