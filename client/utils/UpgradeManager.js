const DEFAULT_BIG_UPGRADE_DEFS = {
  clairvoyance: { key: 'clairvoyance', title: 'Clairvoyance', baseCost: 500, effect: 'predictChance', value: 0.25 },
  stockExchange: { key: 'stockExchange', title: 'Stock Exchange', baseCost: 1000, effect: 'ecoMultiplier', value: 1.5 },
  comboX: { key: 'comboX', title: 'Combo-X', baseCost: 2500, effect: 'comboMultiplier', value: 1.5 },
  masterPredict: { key: 'masterPredict', title: 'Master Predict', baseCost: 7500, effect: 'predictChance', value: 0.5 },
  fixated: { key: 'fixated', title: 'Fixated', baseCost: 30000, effect: 'rollMultiplier', value: 2 },
  highStonks: { key: 'highStonks', title: 'High Stonks', baseCost: 60000, effect: 'ecoRoundMultiplier', value: 0.05 },
  comboMasher: { key: 'comboMasher', title: 'Combo Masher', baseCost: 150000, effect: 'comboStreak', values: { percentage: 0.2, isMultiplicative: false } },
  rollicane: { key: 'rollicane', title: 'Rollicane', baseCost: 400000, effect: 'spinEffect', values: { chance: 0.25, minSec: 2, maxSec: 10 } },
  ultraStonks: { key: 'ultraStonks', title: 'Ultra Stonks', baseCost: 750000, effect: 'ecoMultiplier', value: 2.5 },
  scoreInvestor: { key: 'scoreInvestor', title: 'Score Investor', baseCost: 2000000, effect: 'interestRate', value: 0.02 },
  comboOverclock: { key: 'comboOverclock', title: 'Combo Overclock', baseCost: 6000000, effect: 'comboMultiplier', value: 1.75 }
};

const toNumber = (value, fallback = null) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const stackMultiplier = (current, value, min = 0.05, max = Infinity) => {
  const mult = toNumber(value, null);
  if (mult == null) return current;
  const next = current + (mult - 1);
  return clamp(next, min, max);
};
const stackMultiplierMul = (current, value, min = 0.05, max = Infinity) => {
  const mult = toNumber(value, null);
  if (mult == null) return current;
  const next = current * mult;
  return clamp(next, min, max);
};

class UpgradeManager {
  constructor() {
    this.comboLevels = {};
    this.luckBonus = 0;
    this.luckLevel = 0;
    this.economyLevel = 0;
    this.economyCap = 50;
    this.bigUpgrades = new Set();
    this.clairvoyanceChance = 0;
    this.economyMultiplier = 1;
    this.comboGlobalMultiplier = 1;
    this.diceScoreMultiplier = 1;
    this.comboCostMultiplier = 1;
    this.ecoRoundRate = 0;
    this.comboStreakPercent = 0;
    this.comboStreakIsMultiplicative = false;
    this.comboStreakLabel = null;
    this.spinEffectConfig = null;
    this.interestRate = 0;
    this.bigUpgradeDefs = new Map();
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
    const raw = base * Math.pow(1.5, lvl);
    const mult = this.comboCostMultiplier || 1;
    return Math.floor(raw * mult);
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
    const fiveMilestones = [];
    const tenMilestones = [];
    const twentyFiveMilestones = [];
    const fiftyMilestones = [];

    // Preserve the existing cadence at 50-cap and extend it for challenge caps (ex: 250).
    for (let m = 5; m <= this.economyCap; m += 10) fiveMilestones.push(m);
    for (let m = 10; m <= this.economyCap; m += 10) tenMilestones.push(m);
    for (let m = 25; m <= this.economyCap; m += 25) twentyFiveMilestones.push(m);
    for (let m = 50; m <= this.economyCap; m += 50) fiftyMilestones.push(m);

    let multiplier = 1;

    for (const m of fiveMilestones) {
      if (lvl >= m) multiplier *= 1.5;
    }

    for (const m of tenMilestones) {
      if (lvl >= m) multiplier *= 2;
    }

    for (const m of twentyFiveMilestones) {
      if (lvl >= m) multiplier *= 2.5;
    }

    for (const m of fiftyMilestones) {
      if (lvl >= m) multiplier *= 3;
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
    if (this.economyLevel >= this.economyCap) return false;
    const cost = this.getScaledEconomyCost(costMult);
    return score >= cost;
  }

  upgradeEconomy() {
    if (this.economyLevel < this.economyCap) {
      this.economyLevel++;
    }
  }

  setEconomyCap(cap = 50) {
    const safe = Math.max(1, Math.floor(cap || 50));
    this.economyCap = safe;
    if (this.economyLevel > this.economyCap) {
      this.economyLevel = this.economyCap;
    }
  }

  getEconomyCap() {
    return this.economyCap;
  }
  
  getHighStonksMultiplier(roundsDone = 0) {
    const rate = this.ecoRoundRate || 0;
    if (rate <= 0) return 1;
    const r = Math.max(0, roundsDone);
    return 1 + rate * r;
  }
  
  // -------- Big Upgrades --------
  setBigUpgradeDefs(defs = []) {
    this.bigUpgradeDefs = new Map();
    if (!Array.isArray(defs)) return;
    defs.forEach(def => {
      if (!def || !def.key) return;
      this.bigUpgradeDefs.set(def.key, def);
    });
  }

  getBigUpgradeDef(key) {
    const custom = this.bigUpgradeDefs?.get(key);
    const fallback = DEFAULT_BIG_UPGRADE_DEFS[key];

    if (!custom) return fallback || null;
    if (!fallback) return custom;

    const normalize = (value) => (value === '' ? null : value);
    const merged = { ...fallback, ...custom };

    const customEffect = normalize(custom.effect);
    const customValue = normalize(custom.value);
    const customValues = custom.values;
    const hasCustomValues = customValues && typeof customValues === 'object' && Object.keys(customValues).length > 0;

    if (customEffect == null) merged.effect = fallback.effect;
    if (customValue == null && fallback.value != null) merged.value = fallback.value;
    if (!hasCustomValues && fallback.values != null) merged.values = fallback.values;
    if (custom.title == null && fallback.title != null) merged.title = fallback.title;

    const overrideDefaults = !!custom.overrideDefaults;
    if (!overrideDefaults && fallback) {
      const effect = merged.effect || fallback.effect;
      if (effect === 'comboStreak') {
        const pct = Number(merged.values?.percentage);
        if (!Number.isFinite(pct) || pct <= 0) {
          merged.values = fallback.values;
        }
      } else if (effect === 'spinEffect') {
        const chance = Number(merged.values?.chance);
        const minSec = Number(merged.values?.minSec);
        const maxSec = Number(merged.values?.maxSec);
        if (!Number.isFinite(chance) || chance <= 0 || !Number.isFinite(minSec) || minSec <= 0 || !Number.isFinite(maxSec) || maxSec <= 0) {
          merged.values = fallback.values;
        }
      } else {
        const valueNum = Number(merged.value);
        if (!Number.isFinite(valueNum) || valueNum <= 0) {
          if (fallback.value != null) {
            merged.value = fallback.value;
          }
        }
      }
    }

    return merged;
  }

  getBigUpgradeCost(key) {
    const def = this.getBigUpgradeDef(key);
    const cost = def?.baseCost;
    return Number.isFinite(cost) ? cost : Infinity;
  }

  hasBigUpgrade(key) {
    return this.bigUpgrades.has(key);
  }

  canBuyBigUpgrade(score, key) {
    return !this.hasBigUpgrade(key) && score >= this.getBigUpgradeCost(key);
  }

  applyBigUpgradeEffect(def) {
    if (!def || !def.effect) return false;
    const effect = def.effect;

    switch (effect) {
      case 'predictChance': {
        const chance = clamp(toNumber(def.value, 0), 0, 1);
        this.clairvoyanceChance = clamp(this.clairvoyanceChance + chance, 0, 1);
        return true;
      }
      case 'ecoMultiplier': {
        const mult = toNumber(def.value, 1);
        if (mult == null) return false;
        this.economyMultiplier = stackMultiplierMul(this.economyMultiplier, mult, 0.05);
        return true;
      }
      case 'economyCap': {
        const delta = Math.trunc(toNumber(def.value, 0) || 0);
        if (!Number.isFinite(delta) || delta === 0) return false;
        const currentCap = typeof this.getEconomyCap === 'function' ? this.getEconomyCap() : this.economyCap;
        const baseCap = Number.isFinite(currentCap) ? currentCap : (this.economyCap || 50);
        const nextCap = Math.max(1, baseCap + delta);
        if (typeof this.setEconomyCap === 'function') {
          this.setEconomyCap(nextCap);
        } else {
          this.economyCap = nextCap;
        }
        return true;
      }
      case 'comboMultiplier': {
        const mult = toNumber(def.value, 1);
        if (mult == null) return false;
        this.comboGlobalMultiplier = stackMultiplierMul(this.comboGlobalMultiplier, mult, 0.05);
        return true;
      }
      case 'rollMultiplier': {
        const mult = toNumber(def.value, 1);
        if (mult == null) return false;
        this.diceScoreMultiplier = stackMultiplierMul(this.diceScoreMultiplier, mult, 0.05);
        return true;
      }
      case 'ecoRoundMultiplier': {
        const rate = Math.max(0, toNumber(def.value, 0) || 0);
        this.ecoRoundRate = Math.max(0, this.ecoRoundRate + rate);
        return true;
      }
      case 'comboCostMultiplier': {
        const mult = toNumber(def.value, 1);
        if (mult == null || mult <= 0) return false;
        this.comboCostMultiplier = stackMultiplier(this.comboCostMultiplier, mult, 0.05, 10);
        return true;
      }
      case 'comboStreak': {
        const values = def.values || {};
        const percent = Math.max(0, toNumber(values.percentage ?? def.value, 0) || 0);
        const isMultiplicative = !!values.isMultiplicative;
        if (percent > 0) {
          this.comboStreakPercent = Math.max(0, this.comboStreakPercent + percent);
          if (isMultiplicative) this.comboStreakIsMultiplicative = true;
          const nextLabel = def.title || def.key || 'Combo Streak';
          if (!this.comboStreakLabel) {
            this.comboStreakLabel = nextLabel;
          } else if (this.comboStreakLabel !== nextLabel) {
            this.comboStreakLabel = 'Combo Streak';
          }
        }
        return true;
      }
      case 'spinEffect': {
        const values = def.values || {};
        const chance = clamp(toNumber(values.chance ?? def.value, 0), 0, 1);
        const minSecRaw = toNumber(values.minSec, 2);
        const maxSecRaw = toNumber(values.maxSec, 10);
        const minSec = Math.max(0.1, minSecRaw == null ? 2 : minSecRaw);
        const maxSec = Math.max(minSec, maxSecRaw == null ? minSec : maxSecRaw);
        const label = def.title || def.key || 'Spin Effect';

        const next = { chance, minSec, maxSec, label: 'Dice Spin' };

        if (!this.spinEffectConfig) {
          this.spinEffectConfig = next;
        } else {
          const mergedChance = clamp(this.spinEffectConfig.chance + chance, 0, 1);
          const mergedMin = Math.max(this.spinEffectConfig.minSec, minSec);
          const mergedMax = Math.max(this.spinEffectConfig.maxSec, maxSec);
          this.spinEffectConfig = { chance: mergedChance, minSec: mergedMin, maxSec: mergedMax, label: 'Dice Spin' };
        }
        return true;
      }
      case 'interestRate': {
        const rate = clamp(toNumber(def.value, 0), 0, 1);
        this.interestRate = clamp(this.interestRate + rate, 0, 1);
        return true;
      }
      default:
        return false;
    }
  }

  buyBigUpgrade(key) {
    if (this.hasBigUpgrade(key)) return false;
    const def = this.getBigUpgradeDef(key);
    const applied = this.applyBigUpgradeEffect(def);
    if (!applied) return false;
    this.bigUpgrades.add(key);
    return true;
  }

  getClairvoyanceChance() { return this.clairvoyanceChance; }
  getEconomyMultiplier() { return this.economyMultiplier; }
  getComboGlobalMultiplier() { return this.comboGlobalMultiplier; }
  getDiceScoreMultiplier() { return this.diceScoreMultiplier; }
  getComboStreakMultiplier(streak = 1) {
    if (this.comboStreakPercent <= 0) return 1;
    const safeStreak = Math.max(1, Math.floor(streak || 1));
    if (this.comboStreakIsMultiplicative) {
      return Math.pow(1 + this.comboStreakPercent, safeStreak - 1);
    }
    return 1 + this.comboStreakPercent * (safeStreak - 1);
  }

  getComboStreakLabel() {
    return this.comboStreakLabel || null;
  }

  getSpinEffectConfig() {
    return this.spinEffectConfig;
  }

  getSpinEffectLabel() {
    return this.spinEffectConfig?.label || null;
  }

  getInterestRate() {
    return this.interestRate || 0;
  }
}

export default UpgradeManager;
