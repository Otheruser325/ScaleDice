// Server-owned progression for the online "local rules" mode.
//
// LocalGameScene stores progression inside client objects. Online cannot trust
// those objects, so this module mirrors the same formulas while the lobby owns
// the only live copy. The cost helpers in upgrades.js are shared with the
// existing parity tests; this class adds the effect/state behavior.
import {
  COMBO_BASE_COSTS,
  DICE_BASE_COSTS,
  getActiveBigUpgrades,
  getBigUpgradeCost,
  getComboCost,
  getEconomyCost,
  getLuckCost,
  normalizeCostMultiplier,
  SCORE_DRAIN_METHODS
} from './upgrades.js';

export const COMBO_KEYS = Object.freeze([
  'pair',
  'twoPair',
  'triple',
  'fullHouse',
  'straight',
  'fourOfAKind',
  'fiveOfAKind',
  'threePair',
  'tripleTrend',
  'powerHouse',
  'sixOfAKind'
]);

export const COMBO_REQUIREMENTS = Object.freeze({
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
});

export const MAX_DICE = 6;
export const MAX_LUCK_LEVEL = 25;
export const DEFAULT_ECONOMY_CAP = 50;

const toNumber = (value, fallback = null) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const stackMultiplier = (current, value, min = 0.05, max = Infinity) => {
  const mult = toNumber(value, null);
  if (mult == null) return current;
  return clamp(current + (mult - 1), min, max);
};

const stackMultiplierMul = (current, value, min = 0.05, max = Infinity) => {
  const mult = toNumber(value, null);
  if (mult == null) return current;
  return clamp(current * mult, min, max);
};

export class PlayerProgression {
  constructor(config = {}) {
    this.costMultiplier = normalizeCostMultiplier(config.costMultiplier, 1);
    this.diceUnlocked = 1;

    this.comboLevels = {};
    this.luckLevel = 0;
    this.luckBonus = 0;
    this.economyLevel = 0;
    this.economyCap = DEFAULT_ECONOMY_CAP;

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
    this.investmentCap = 1;
    this.comboUpgradePercent = 0;
    this.comboUpgradeIsMultiplicative = false;
    this.scoreDrainPercent = 0;
    this.scoreDrainNumPlayers = 0;
    this.scoreDrainStealMethod = null;
    this.scoreDrainLabel = null;

    this.lastComboKey = null;
    this.comboStreak = 0;

    const activeDefs = config.bigUpgradesEnabled === false
      ? []
      : getActiveBigUpgrades(config.customBigUpgrades || []);
    this.bigUpgradeDefs = activeDefs.map((def) => ({ ...def }));
    this.bigUpgradeMap = new Map(this.bigUpgradeDefs.map((def) => [def.key, def]));
  }

  // -------- Dice --------
  getNextDiceCost() {
    const base = DICE_BASE_COSTS[this.diceUnlocked - 1];
    if (!base) return null;
    return Math.floor(base * this.costMultiplier);
  }

  canUpgradeDice() {
    return this.diceUnlocked < MAX_DICE && this.getNextDiceCost() != null;
  }

  upgradeDice() {
    if (!this.canUpgradeDice()) return false;
    this.diceUnlocked += 1;
    return true;
  }

  // -------- Combo --------
  getComboLevel(key) {
    return this.comboLevels[key] ?? 0;
  }

  getComboCost(key) {
    return getComboCost(
      key,
      this.getComboLevel(key),
      this.costMultiplier,
      this.comboCostMultiplier
    );
  }

  upgradeCombo(key) {
    if (!COMBO_KEYS.includes(key)) return false;
    if (this.diceUnlocked < (COMBO_REQUIREMENTS[key] ?? 2)) return false;
    this.comboLevels[key] = this.getComboLevel(key) + 1;
    return true;
  }

  getComboMultiplier(key) {
    const level = this.getComboLevel(key);
    const flat = 1 + level * 0.1;
    if (level <= 0 || this.comboUpgradePercent <= 0) return flat;
    if (this.comboUpgradeIsMultiplicative) {
      return flat * Math.pow(1 + this.comboUpgradePercent, level);
    }
    return flat + level * this.comboUpgradePercent;
  }

  getComboGlobalMultiplier() {
    return this.comboGlobalMultiplier;
  }

  recordCombo(key) {
    if (!key) {
      this.lastComboKey = null;
      this.comboStreak = 0;
      return 0;
    }
    if (this.lastComboKey === key) this.comboStreak += 1;
    else this.comboStreak = 1;
    this.lastComboKey = key;
    return this.comboStreak;
  }

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

  // -------- Luck --------
  getLuckLevel() {
    return this.luckLevel;
  }

  getLuckBonus() {
    return this.luckBonus;
  }

  getEffectiveLuck(baseLuck = 1) {
    return clamp((Number(baseLuck) || 1) + this.luckBonus, 0.5, 6);
  }

  getLuckCost() {
    return getLuckCost(this.luckLevel, this.costMultiplier);
  }

  canUpgradeLuck(score, baseLuck = 1) {
    if (this.luckLevel >= MAX_LUCK_LEVEL) return false;
    if (this.getEffectiveLuck(baseLuck) >= 6) return false;
    return Number(score) >= this.getLuckCost();
  }

  upgradeLuck(baseLuck = 1) {
    if (this.luckLevel >= MAX_LUCK_LEVEL || this.getEffectiveLuck(baseLuck) >= 6) return false;
    this.luckBonus += 0.2;
    this.luckLevel += 1;
    return true;
  }

  // -------- Economy --------
  getEconomyLevel() {
    return this.economyLevel;
  }

  getEconomyCap() {
    return this.economyCap;
  }

  setEconomyCap(cap = DEFAULT_ECONOMY_CAP) {
    const safe = Math.max(1, Math.floor(cap || DEFAULT_ECONOMY_CAP));
    this.economyCap = safe;
    if (this.economyLevel > this.economyCap) this.economyLevel = this.economyCap;
  }

  getEconomyIncome() {
    const lvl = this.economyLevel;
    if (lvl <= 0) return 0;

    const baseIncome = Math.floor((lvl * (lvl + 1)) / 2);
    const fiveMilestones = [];
    const tenMilestones = [];
    const twentyFiveMilestones = [];
    const fiftyMilestones = [];

    for (let m = 5; m <= this.economyCap; m += 10) fiveMilestones.push(m);
    for (let m = 10; m <= this.economyCap; m += 10) tenMilestones.push(m);
    for (let m = 25; m <= this.economyCap; m += 25) twentyFiveMilestones.push(m);
    for (let m = 50; m <= this.economyCap; m += 50) fiftyMilestones.push(m);

    let multiplier = 1;
    for (const m of fiveMilestones) if (lvl >= m) multiplier *= 1.5;
    for (const m of tenMilestones) if (lvl >= m) multiplier *= 2;
    for (const m of twentyFiveMilestones) if (lvl >= m) multiplier *= 2.5;
    for (const m of fiftyMilestones) if (lvl >= m) multiplier *= 3;

    return Math.floor(baseIncome * multiplier);
  }

  getEconomyCost() {
    return getEconomyCost(this.economyLevel, this.costMultiplier);
  }

  canUpgradeEconomy(score) {
    if (this.economyLevel >= this.economyCap) return false;
    return Number(score) >= this.getEconomyCost();
  }

  upgradeEconomy() {
    if (this.economyLevel >= this.economyCap) return false;
    this.economyLevel += 1;
    return true;
  }

  getHighStonksMultiplier(roundsDone = 0) {
    const rate = this.ecoRoundRate || 0;
    if (rate <= 0) return 1;
    return 1 + rate * Math.max(0, roundsDone);
  }

  // -------- Big upgrades --------
  getBigUpgradeDef(key) {
    return this.bigUpgradeMap.get(key) || null;
  }

  getBigUpgradeCost(key) {
    const def = this.getBigUpgradeDef(key);
    if (!def) return Infinity;
    return getBigUpgradeCost(def.baseCost, this.costMultiplier);
  }

  hasBigUpgrade(key) {
    return this.bigUpgrades.has(key);
  }

  canBuyBigUpgrade(score, key) {
    return !!this.getBigUpgradeDef(key) &&
      !this.hasBigUpgrade(key) &&
      Number(score) >= this.getBigUpgradeCost(key);
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
        this.setEconomyCap(this.economyCap + delta);
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
          if (!this.comboStreakLabel) this.comboStreakLabel = nextLabel;
          else if (this.comboStreakLabel !== nextLabel) this.comboStreakLabel = 'Combo Streak';
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
        const next = { chance, minSec, maxSec, label: 'Dice Spin' };

        if (!this.spinEffectConfig) this.spinEffectConfig = next;
        else {
          this.spinEffectConfig = {
            chance: clamp(this.spinEffectConfig.chance + chance, 0, 1),
            minSec: Math.max(this.spinEffectConfig.minSec, minSec),
            maxSec: Math.max(this.spinEffectConfig.maxSec, maxSec),
            label: 'Dice Spin'
          };
        }
        return true;
      }
      case 'interestRate': {
        // investmentCap replaces the current ceiling; without it the online
        // default remains 100%.
        const cap = toNumber(def.investmentCap, null);
        if (cap != null) this.investmentCap = Math.max(0, cap);
        const rate = Math.max(0, toNumber(def.value, 0) || 0);
        this.interestRate = clamp(this.interestRate + rate, 0, this.investmentCap);
        return true;
      }
      case 'comboUpgrade': {
        const values = def.values || {};
        const percent = clamp(toNumber(values.percentage ?? def.value, 0), 0, 1);
        if (percent <= 0) return false;
        this.comboUpgradePercent = clamp(this.comboUpgradePercent + percent, 0, 1);
        if (values.isMultiplicative) this.comboUpgradeIsMultiplicative = true;
        return true;
      }
      case 'scoreDrain': {
        const values = def.values || {};
        const percent = clamp(toNumber(values.percentage ?? def.value, 0), 0, 1);
        if (percent <= 0) return false;
        const numPlayers = Math.max(1, Math.floor(toNumber(values.numPlayers, 1) || 1));
        const method = SCORE_DRAIN_METHODS.includes(values.stealMethod) ? values.stealMethod : 'random';
        this.scoreDrainPercent = clamp(this.scoreDrainPercent + percent, 0, 1);
        this.scoreDrainNumPlayers = Math.max(this.scoreDrainNumPlayers || 0, numPlayers);
        this.scoreDrainStealMethod = this.scoreDrainStealMethod || method;
        this.scoreDrainLabel = this.scoreDrainLabel || def.title || def.key || 'Score Drain';
        return true;
      }
      default:
        return false;
    }
  }

  buyBigUpgrade(key) {
    if (this.hasBigUpgrade(key)) return false;
    const def = this.getBigUpgradeDef(key);
    if (!def) return false;
    if (!this.applyBigUpgradeEffect(def)) return false;
    this.bigUpgrades.add(key);
    return true;
  }

  getClairvoyanceChance() {
    return this.clairvoyanceChance;
  }

  getEconomyMultiplier() {
    return this.economyMultiplier;
  }

  getDiceScoreMultiplier() {
    return this.diceScoreMultiplier;
  }

  getSpinEffectConfig() {
    return this.spinEffectConfig;
  }

  getInterestRate() {
    return this.interestRate;
  }

  getInvestmentCap() {
    return this.investmentCap;
  }

  getComboUpgradePercent() {
    return this.comboUpgradePercent;
  }

  isComboUpgradeMultiplicative() {
    return !!this.comboUpgradeIsMultiplicative;
  }

  getScoreDrainConfig() {
    if (this.scoreDrainPercent <= 0 || this.scoreDrainNumPlayers <= 0) return null;
    return {
      percentage: this.scoreDrainPercent,
      numPlayers: this.scoreDrainNumPlayers,
      stealMethod: this.scoreDrainStealMethod || 'random',
      label: this.scoreDrainLabel || 'Score Drain'
    };
  }

  resolveScoreDrain({ ownerIndex, players = [], random = Math.random, claimedBy = {} } = {}) {
    const config = this.getScoreDrainConfig();
    if (!config || !Array.isArray(players)) {
      return { config: null, targets: [], total: 0, skipped: [] };
    }

    const getClaimant = (index) => {
      const value = claimedBy instanceof Map ? claimedBy.get(index) : claimedBy?.[index];
      if (value === undefined || value === null) return null;
      const claimant = Number(value);
      return Number.isInteger(claimant) ? claimant : null;
    };
    const isClaimedByOther = (index) => {
      const claimant = getClaimant(index);
      return claimant !== null && claimant !== ownerIndex;
    };
    const skipped = players
      .map((player, index) => ({ player, index, claimedBy: getClaimant(index) }))
      .filter(({ player, index, claimedBy: claimant }) => (
        index !== ownerIndex && player && !player.left &&
        claimant !== null && claimant !== ownerIndex
      ))
      .map(({ index, claimedBy: claimant }) => ({ index, claimedBy: claimant }));
    const candidates = players
      .map((player, index) => ({ player, index, score: Number(player?.score) || 0 }))
      .filter(({ player, index }) => (
        index !== ownerIndex && player && !player.left && !isClaimedByOther(index)
      ));

    let ordered = [];
    switch (config.stealMethod) {
      case 'highest':
        ordered = candidates.slice().sort((a, b) => b.score - a.score || a.index - b.index);
        break;
      case 'lowest':
        ordered = candidates.slice().sort((a, b) => a.score - b.score || a.index - b.index);
        break;
      case 'before':
      case 'after': {
        const activeOrder = players
          .map((player, index) => ({ player, index }))
          .filter(({ player }) => player && !player.left);
        const anchorIndex = activeOrder.findIndex((entry) => entry.index === ownerIndex);
        if (anchorIndex >= 0) {
          const count = activeOrder.length;
          for (let step = 1; step <= count; step += 1) {
            const offset = config.stealMethod === 'before' ? -step : step;
            const index = activeOrder[(anchorIndex + offset + count) % count]?.index;
            if (index !== ownerIndex && !isClaimedByOther(index)) {
              ordered.push({ player: players[index], index, score: Number(players[index]?.score) || 0 });
            }
          }
        } else {
          ordered = candidates.slice();
        }
        break;
      }
      case 'random':
      default: {
        ordered = candidates.slice();
        for (let i = ordered.length - 1; i > 0; i -= 1) {
          const j = Math.floor(random() * (i + 1));
          [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
        }
        break;
      }
    }

    const selected = ordered.slice(0, Math.min(config.numPlayers, ordered.length));
    const targets = selected
      .map(({ index, score }) => ({ index, amount: Math.floor(score * config.percentage) }))
      .filter((target) => target.amount > 0);
    return {
      config,
      percentage: config.percentage,
      numPlayers: config.numPlayers,
      stealMethod: config.stealMethod,
      label: config.label,
      targets,
      skipped,
      total: targets.reduce((sum, target) => sum + target.amount, 0)
    };
  }

  // Serialized for clients. The prediction itself is deliberately absent.
  toPublic(round = 1) {
    return {
      diceUnlocked: this.diceUnlocked,
      economyLevel: this.economyLevel,
      economyCap: this.economyCap,
      economyIncome: Math.floor(
        this.getEconomyIncome() *
        this.getEconomyMultiplier() *
        this.getHighStonksMultiplier(Math.max(0, Number(round) - 1))
      ),
      luckLevel: this.luckLevel,
      luckBonus: this.luckBonus,
      effectiveLuck: this.getEffectiveLuck(),
      comboLevels: { ...this.comboLevels },
      bigUpgrades: [...this.bigUpgrades],
      clairvoyanceChance: this.clairvoyanceChance,
      economyMultiplier: this.economyMultiplier,
      comboGlobalMultiplier: this.comboGlobalMultiplier,
      diceScoreMultiplier: this.diceScoreMultiplier,
      comboCostMultiplier: this.comboCostMultiplier,
      ecoRoundRate: this.ecoRoundRate,
      comboStreakPercent: this.comboStreakPercent,
      comboStreakLabel: this.comboStreakLabel,
      spinEffect: this.spinEffectConfig,
      interestRate: this.interestRate,
      investmentCap: this.investmentCap,
      comboUpgradePercent: this.comboUpgradePercent,
      comboUpgradeIsMultiplicative: this.comboUpgradeIsMultiplicative,
      scoreDrain: this.getScoreDrainConfig()
    };
  }
}

export function createProgression(config = {}) {
  return new PlayerProgression(config);
}

export default PlayerProgression;
