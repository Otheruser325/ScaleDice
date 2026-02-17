class BigUpgradeCustomizer {
  // Default big upgrades that can be customized or deleted
  static DEFAULT_UPGRADES = [
    { key: 'clairvoyance', title: 'Clairvoyance', baseCost: 500, effect: 'predictChance', value: 0.25 },
    { key: 'stockExchange', title: 'Stock Exchange', baseCost: 1000, effect: 'ecoMultiplier', value: 1.5 },
    { key: 'comboX', title: 'Combo-X', baseCost: 2500, effect: 'comboMultiplier', value: 1.5 },
    { key: 'masterPredict', title: 'Master Predict', baseCost: 7500, effect: 'predictChance', value: 0.5 },
    { key: 'fixated', title: 'Fixated', baseCost: 30000, effect: 'rollMultiplier', value: 2 },
    { key: 'highStonks', title: 'High Stonks', baseCost: 60000, effect: 'ecoRoundMultiplier', value: 0.05 },
    { key: 'comboMasher', title: 'Combo Masher', baseCost: 150000, effect: 'comboStreak', values: { percentage: 0.2, isMultiplicative: false } },
    { key: 'rollicane', title: 'Rollicane', baseCost: 400000, effect: 'spinEffect', values: { chance: 0.25, minSec: 2, maxSec: 10 } }
  ];

  // Effect types available
  static EFFECT_TYPES = [
    { key: 'rollMultiplier', name: 'Roll Multiplier', desc: 'Dice-earned scores multiplier' },
    { key: 'comboMultiplier', name: 'Combo Multiplier', desc: 'Combo multipliers boost' },
    { key: 'ecoMultiplier', name: 'Eco Multiplier', desc: 'Economy income multiplier' },
    { key: 'economyCap', name: 'Economy Cap', desc: 'Adjust max economy upgrade cap' },
    { key: 'ecoRoundMultiplier', name: 'Eco Round Multiplier', desc: 'Economy scale per round %' },
    { key: 'predictChance', name: 'Predict Chance', desc: 'Roll prediction chance' },
    { key: 'comboCostMultiplier', name: 'Combo Cost Multiplier', desc: 'Discount for combo upgrades' },
    { key: 'interestRate', name: 'Interest Rate', desc: 'Bonus income based on current score' },
    { key: 'comboStreak', name: 'Combo Streak', desc: 'Bonus per consecutive combo' },
    { key: 'spinEffect', name: 'Spin Effect', desc: 'Dice spin chance (3 values)' }
  ];

  constructor() {
    this.customUpgrades = this.loadCustomUpgrades() || [];
  }

  loadCustomUpgrades() {
    try {
      const stored = localStorage.getItem('scaleDice_customBigUpgrades');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.warn('Failed to load custom big upgrades:', e);
      return [];
    }
  }

  saveCustomUpgrades() {
    try {
      localStorage.setItem('scaleDice_customBigUpgrades', JSON.stringify(this.customUpgrades));
    } catch (e) {
      console.warn('Failed to save custom big upgrades:', e);
    }
  }

  // Get all upgrades (defaults + custom)
  getAllUpgrades() {
    return [...BigUpgradeCustomizer.DEFAULT_UPGRADES, ...this.customUpgrades];
  }

  // Add or update custom upgrade
  saveUpgrade(upgrade) {
    const isDefault = BigUpgradeCustomizer.DEFAULT_UPGRADES.some(d => d.key === upgrade.key);
    if (isDefault) {
      upgrade.overrideDefaults = true;
    }
    const index = this.customUpgrades.findIndex(u => u.key === upgrade.key);
    if (index >= 0) {
      this.customUpgrades[index] = upgrade;
    } else {
      this.customUpgrades.push(upgrade);
    }
    this.saveCustomUpgrades();
  }

  resetToDefaults() {
    this.customUpgrades = [];
    this.saveCustomUpgrades();
  }

  // Delete custom upgrade
  deleteUpgrade(key) {
    this.customUpgrades = this.customUpgrades.filter(u => u.key !== key);
    this.saveCustomUpgrades();
  }

  // Delete default upgrade (soft delete - store in list)
  deleteDefaultUpgrade(key) {
    this.customUpgrades = this.customUpgrades.filter(u => u.key !== `deleted_${key}`);
    this.customUpgrades.push({ key: `deleted_${key}`, deleted: true });
    this.saveCustomUpgrades();
  }

  // Check if default upgrade is deleted
  isDefaultUpgradeDeleted(key) {
    return this.customUpgrades.some(u => u.key === `deleted_${key}`);
  }

  // Restore deleted default
  restoreDefaultUpgrade(key) {
    this.customUpgrades = this.customUpgrades.filter(u => u.key !== `deleted_${key}`);
    this.saveCustomUpgrades();
  }

  // Get active upgrades (excluding deleted defaults and internal deleted markers)
  getActiveUpgrades() {
    const defaults = BigUpgradeCustomizer.DEFAULT_UPGRADES.filter(
      u => !this.isDefaultUpgradeDeleted(u.key)
    );
    const custom = this.customUpgrades.filter(u => !u.deleted);
    const merged = new Map();
    defaults.forEach(u => merged.set(u.key, u));
    custom.forEach(u => merged.set(u.key, u));
    return [...merged.values()];
  }
}

export default BigUpgradeCustomizer;
