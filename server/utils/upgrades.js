// Server-side mirror of the local upgrade economy.
//
// The online game does not yet expose an upgrade shop, but the lobby config
// already has to accept and validate the same settings the local game uses.
// Keeping the formulas and the big-upgrade catalog here gives the server one
// authoritative place to grow that feature, and the parity tests make sure it
// cannot silently drift from client/utils/UpgradeManager.js and
// client/utils/BigUpgradeCustomizer.js.

export const COMBO_BASE_COSTS = Object.freeze({
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
  sixOfAKind: 250
});

// Cost of unlocking the next die, indexed by the current diceUnlocked value
// (the local game reads diceCosts[player.diceUnlocked - 1]).
export const DICE_BASE_COSTS = Object.freeze([10, 100, 500, 3000, 20000]);

export const COST_MULTIPLIERS = Object.freeze([0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5]);

export const MAX_CUSTOM_BIG_UPGRADES = 200;

// Must stay in sync with BigUpgradeCustomizer.DEFAULT_UPGRADES. The test suite
// compares these values directly.
export const DEFAULT_BIG_UPGRADES = Object.freeze([
  { key: 'clairvoyance', title: 'Clairvoyance', baseCost: 500, effect: 'predictChance', value: 0.25 },
  { key: 'stockExchange', title: 'Stock Exchange', baseCost: 1000, effect: 'ecoMultiplier', value: 1.5 },
  { key: 'comboX', title: 'Combo-X', baseCost: 2500, effect: 'comboMultiplier', value: 1.5 },
  { key: 'masterPredict', title: 'Master Predict', baseCost: 7500, effect: 'predictChance', value: 0.5 },
  { key: 'fixated', title: 'Fixated', baseCost: 30000, effect: 'rollMultiplier', value: 2 },
  { key: 'highStonks', title: 'High Stonks', baseCost: 60000, effect: 'ecoRoundMultiplier', value: 0.05 },
  {
    key: 'comboMasher',
    title: 'Combo Masher',
    baseCost: 150000,
    effect: 'comboStreak',
    values: { percentage: 0.2, isMultiplicative: false }
  },
  {
    key: 'rollicane',
    title: 'Rollicane',
    baseCost: 400000,
    effect: 'spinEffect',
    values: { chance: 0.25, minSec: 2, maxSec: 10 }
  }
]);

export const BIG_UPGRADE_EFFECTS = Object.freeze([
  'rollMultiplier',
  'comboMultiplier',
  'ecoMultiplier',
  'economyCap',
  'ecoRoundMultiplier',
  'predictChance',
  'comboCostMultiplier',
  'interestRate',
  'comboStreak',
  'spinEffect',
  'comboUpgrade',
  'scoreDrain'
]);

export const SCORE_DRAIN_METHODS = Object.freeze(['random', 'highest', 'lowest', 'before', 'after']);

const EFFECT_SET = new Set(BIG_UPGRADE_EFFECTS);
const SCORE_DRAIN_METHOD_SET = new Set(SCORE_DRAIN_METHODS);

const finiteNumber = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const positiveLevel = (value) => Math.max(0, Math.floor(finiteNumber(value, 0)));
const safeMultiplier = (value) => {
  const number = finiteNumber(value, 1);
  return number > 0 ? number : 1;
};

// Lobby settings are user supplied. Keep them on the same list the local UI
// offers and reject NaN/negative values instead of letting them poison costs.
export function normalizeCostMultiplier(value, fallback = 1) {
  const number = finiteNumber(value, fallback);
  return Math.min(COST_MULTIPLIERS.at(-1), Math.max(COST_MULTIPLIERS[0], number));
}

export function getComboCost(key, level = 0, costMultiplier = 1, comboCostMultiplier = 1) {
  const base = COMBO_BASE_COSTS[key] ?? 30;
  const raw = base * Math.pow(1.5, positiveLevel(level));
  const comboMultiplier = safeMultiplier(comboCostMultiplier);
  return Math.floor(Math.floor(raw * comboMultiplier) * safeMultiplier(costMultiplier));
}

export function getLuckCost(level = 0, costMultiplier = 1) {
  return Math.floor(
    Math.floor(50 * Math.pow(1.5, positiveLevel(level))) * safeMultiplier(costMultiplier)
  );
}

export function getEconomyCost(level = 0, costMultiplier = 1) {
  return Math.floor(
    Math.floor(25 * Math.pow(1.3, positiveLevel(level))) * safeMultiplier(costMultiplier)
  );
}

export function getDiceCost(diceUnlocked, costMultiplier = 1) {
  const index = Math.floor(Number(diceUnlocked) - 1);
  if (!Number.isInteger(index) || index < 0) return null;
  const base = DICE_BASE_COSTS[index];
  if (!base) return null;
  return Math.floor(base * safeMultiplier(costMultiplier));
}

// LocalGameScene charges big upgrades with a one-point floor so a tiny cost
// multiplier can never make a purchase free.
export function getBigUpgradeCost(baseCost, costMultiplier = 1) {
  const base = Math.max(0, finiteNumber(baseCost, 0));
  return Math.max(1, Math.floor(base * safeMultiplier(costMultiplier)));
}

// Matches BigUpgradeCustomizer.getActiveUpgrades(): deleted defaults are
// removed, custom entries override defaults by key, and insertion order is
// preserved for keys that already exist.
export function getActiveBigUpgrades(customUpgrades = []) {
  const custom = Array.isArray(customUpgrades)
    ? customUpgrades.filter((upgrade) => upgrade && typeof upgrade === 'object')
    : [];
  const deleted = new Set(
    custom
      .filter((upgrade) => typeof upgrade.key === 'string' && upgrade.key.startsWith('deleted_'))
      .map((upgrade) => upgrade.key.slice('deleted_'.length))
  );

  const defaults = DEFAULT_BIG_UPGRADES.filter((upgrade) => !deleted.has(upgrade.key));
  const active = custom.filter(
    (upgrade) => !upgrade.deleted && typeof upgrade.key === 'string' &&
      upgrade.key.length > 0 && !upgrade.key.startsWith('deleted_')
  );

  const merged = new Map();
  defaults.forEach((upgrade) => merged.set(upgrade.key, upgrade));
  active.forEach((upgrade) => merged.set(upgrade.key, upgrade));
  return [...merged.values()];
}

// Server-side boundary for SCD imports/self-hosted custom packs. The local
// customizer trusts localStorage; a server must not accept unbounded or
// malformed objects from a client.
export function sanitizeCustomBigUpgrades(customUpgrades = []) {
  const source = Array.isArray(customUpgrades) ? customUpgrades : [];
  const sanitized = [];

  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    if (!key) continue;

    if (raw.deleted && key.startsWith('deleted_')) {
      sanitized.push({ key, deleted: true });
      continue;
    }
    if (key.startsWith('deleted_')) continue;

    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 80) : '';
    const baseCost = finiteNumber(raw.baseCost, null);
    const effect = typeof raw.effect === 'string' ? raw.effect : '';
    if (!title || baseCost === null || baseCost < 0 || !EFFECT_SET.has(effect)) continue;

    const upgrade = {
      key: key.slice(0, 80),
      title,
      baseCost: Math.floor(baseCost),
      effect
    };

    if (raw.value !== undefined) {
      const value = finiteNumber(raw.value, null);
      if (value === null || value < 0) continue;
      upgrade.value = value;
    }
    if (effect === 'interestRate' && raw.investmentCap !== undefined) {
      const investmentCap = finiteNumber(raw.investmentCap, null);
      if (investmentCap === null || investmentCap < 0) continue;
      upgrade.investmentCap = investmentCap;
    }
    if (raw.values && typeof raw.values === 'object' && !Array.isArray(raw.values)) {
      const values = raw.values;
      if (effect === 'comboUpgrade') {
        const percentage = finiteNumber(values.percentage, null);
        if (percentage === null || percentage < 0 || percentage > 1) continue;
        upgrade.values = {
          percentage,
          isMultiplicative: values.isMultiplicative === true
        };
      } else if (effect === 'scoreDrain') {
        const percentage = finiteNumber(values.percentage, null);
        const numPlayers = Math.floor(finiteNumber(values.numPlayers, 1));
        const stealMethod = typeof values.stealMethod === 'string' ? values.stealMethod : 'random';
        if (
          percentage === null || percentage < 0 || percentage > 1 ||
          numPlayers < 1 || numPlayers > 6 || !SCORE_DRAIN_METHOD_SET.has(stealMethod)
        ) continue;
        upgrade.values = { percentage, numPlayers, stealMethod };
      } else {
        upgrade.values = { ...values };
      }
    } else if (effect === 'comboUpgrade' || effect === 'scoreDrain') {
      continue;
    }
    if (raw.overrideDefaults === true) upgrade.overrideDefaults = true;

    sanitized.push(upgrade);
    if (sanitized.length >= MAX_CUSTOM_BIG_UPGRADES) break;
  }

  return sanitized;
}

export default {
  COMBO_BASE_COSTS,
  DICE_BASE_COSTS,
  COST_MULTIPLIERS,
  DEFAULT_BIG_UPGRADES,
  BIG_UPGRADE_EFFECTS,
  SCORE_DRAIN_METHODS,
  normalizeCostMultiplier,
  getComboCost,
  getLuckCost,
  getEconomyCost,
  getDiceCost,
  getBigUpgradeCost,
  getActiveBigUpgrades,
  sanitizeCustomBigUpgrades
};
