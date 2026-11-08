import test from 'node:test';
import assert from 'node:assert/strict';
import UpgradeManager from '../client/utils/UpgradeManager.js';
import BigUpgradeCustomizer from '../client/utils/BigUpgradeCustomizer.js';
import {
  COMBO_BASE_COSTS,
  DICE_BASE_COSTS,
  COST_MULTIPLIERS,
  DEFAULT_BIG_UPGRADES,
  BIG_UPGRADE_EFFECTS,
  MAX_CUSTOM_BIG_UPGRADES,
  normalizeCostMultiplier,
  getComboCost,
  getLuckCost,
  getEconomyCost,
  getDiceCost,
  getBigUpgradeCost,
  getActiveBigUpgrades,
  sanitizeCustomBigUpgrades
} from '../server/utils/upgrades.js';
import { normalizeConfig } from '../server/utils/gameConfig.js';
import { PlayerProgression } from '../server/utils/progression.js';

test('server combo costs match the local upgrade manager at every level and multiplier', () => {
  const local = new UpgradeManager();

  for (const key of Object.keys(COMBO_BASE_COSTS)) {
    for (let level = 0; level < 20; level += 1) {
      local.comboLevels = { [key]: level };
      local.comboCostMultiplier = 1;

      for (const multiplier of COST_MULTIPLIERS) {
        assert.equal(
          getComboCost(key, level, multiplier),
          local.getScaledComboCost(key, multiplier),
          `combo ${key} level ${level} x${multiplier}`
        );
      }

      local.comboCostMultiplier = 0.8;
      for (const multiplier of [0.1, 1, 2.5, 5]) {
        assert.equal(
          getComboCost(key, level, multiplier, local.comboCostMultiplier),
          local.getScaledComboCost(key, multiplier),
          `discounted combo ${key} level ${level} x${multiplier}`
        );
      }
    }
  }
});

test('server luck and economy costs match the local upgrade manager', () => {
  const local = new UpgradeManager();

  for (let level = 0; level <= 25; level += 1) {
    local.luckLevel = level;
    local.economyLevel = level;

    for (const multiplier of COST_MULTIPLIERS) {
      assert.equal(
        getLuckCost(level, multiplier),
        local.getScaledLuckCost(multiplier),
        `luck level ${level} x${multiplier}`
      );
      assert.equal(
        getEconomyCost(level, multiplier),
        local.getScaledEconomyCost(multiplier),
        `economy level ${level} x${multiplier}`
      );
    }
  }
});

test('server dice costs match the local dice unlock ladder', () => {
  assert.deepEqual([...DICE_BASE_COSTS], [10, 100, 500, 3000, 20000]);

  for (let unlocked = 1; unlocked <= DICE_BASE_COSTS.length; unlocked += 1) {
    for (const multiplier of COST_MULTIPLIERS) {
      assert.equal(
        getDiceCost(unlocked, multiplier),
        Math.floor(DICE_BASE_COSTS[unlocked - 1] * multiplier),
        `die ${unlocked} x${multiplier}`
      );
    }
  }

  assert.equal(getDiceCost(0), null);
  assert.equal(getDiceCost(DICE_BASE_COSTS.length + 1), null);
});

test('server big-upgrade catalog matches the local customizer defaults exactly', () => {
  assert.deepEqual(DEFAULT_BIG_UPGRADES, BigUpgradeCustomizer.DEFAULT_UPGRADES);
  assert.deepEqual(
    BIG_UPGRADE_EFFECTS,
    BigUpgradeCustomizer.EFFECT_TYPES.map((effect) => effect.key)
  );

  for (const upgrade of DEFAULT_BIG_UPGRADES) {
    for (const multiplier of COST_MULTIPLIERS) {
      assert.equal(
        getBigUpgradeCost(upgrade.baseCost, multiplier),
        Math.max(1, Math.floor(upgrade.baseCost * multiplier)),
        `${upgrade.key} x${multiplier}`
      );
    }
  }

  assert.equal(getBigUpgradeCost(0, 0.1), 1);
});

test('combo upgrader and score drain are customizer effects, not defaults', () => {
  const effectKeys = BigUpgradeCustomizer.EFFECT_TYPES.map((effect) => effect.key);
  assert.ok(effectKeys.includes('comboUpgrade'));
  assert.ok(effectKeys.includes('scoreDrain'));
  assert.equal(DEFAULT_BIG_UPGRADES.some((upgrade) => upgrade.key === 'comboUpgrader'), false);
  assert.equal(DEFAULT_BIG_UPGRADES.some((upgrade) => upgrade.key === 'scoreDrain'), false);
  assert.equal(BigUpgradeCustomizer.DEFAULT_UPGRADES.some((upgrade) => upgrade.key === 'comboUpgrader'), false);
  assert.equal(BigUpgradeCustomizer.DEFAULT_UPGRADES.some((upgrade) => upgrade.key === 'scoreDrain'), false);
  assert.equal(DEFAULT_BIG_UPGRADES.length, 8);

  const custom = [
    {
      key: 'customComboUpgrader',
      title: 'Custom Combo Upgrader',
      baseCost: 1000000,
      effect: 'comboUpgrade',
      values: { percentage: 0.15, isMultiplicative: true }
    },
    {
      key: 'customScoreDrain',
      title: 'Custom Score Drain',
      baseCost: 2000000,
      effect: 'scoreDrain',
      values: { percentage: 0.2, numPlayers: 2, stealMethod: 'after' }
    }
  ];
  assert.deepEqual(sanitizeCustomBigUpgrades(custom), custom);

  const local = new BigUpgradeCustomizer();
  local.customUpgrades = custom;
  assert.deepEqual(getActiveBigUpgrades(custom), local.getActiveUpgrades());
  assert.ok(local.getActiveUpgrades().some((upgrade) => upgrade.key === 'customComboUpgrader'));
  assert.ok(local.getActiveUpgrades().some((upgrade) => upgrade.key === 'customScoreDrain'));

  assert.deepEqual(sanitizeCustomBigUpgrades([
    { ...custom[0], key: 'badComboPercentage', values: { ...custom[0].values, percentage: 1.5 } },
    { ...custom[1], key: 'badDrainCount', values: { ...custom[1].values, numPlayers: 7 } },
    { ...custom[1], key: 'badDrainMethod', values: { ...custom[1].values, stealMethod: 'sideways' } }
  ]), []);
});

test('investor caps replace the interest ceiling in local and online progression', () => {
  const defs = [
    {
      key: 'customInvestor',
      title: 'Capped Investor',
      baseCost: 1000,
      effect: 'interestRate',
      value: 0.8,
      investmentCap: 1.5
    },
    {
      key: 'customInterest',
      title: 'Interest Bonus',
      baseCost: 2000,
      effect: 'interestRate',
      value: 0.8
    },
    {
      key: 'customInterestTwo',
      title: 'Interest Bonus II',
      baseCost: 3000,
      effect: 'interestRate',
      value: 0.8
    }
  ];

  assert.deepEqual(sanitizeCustomBigUpgrades(defs), defs);
  assert.deepEqual(sanitizeCustomBigUpgrades([
    { ...defs[0], investmentCap: -1 },
    { ...defs[0], investmentCap: 'not-a-number' }
  ]), []);

  const local = new UpgradeManager();
  local.setBigUpgradeDefs(defs);
  const online = new PlayerProgression({ bigUpgradesEnabled: true, customBigUpgrades: defs });

  for (const def of defs) {
    assert.equal(local.buyBigUpgrade(def.key), true, `${def.key} local purchase`);
    assert.equal(online.buyBigUpgrade(def.key), true, `${def.key} online purchase`);
  }

  assert.equal(local.getInvestmentCap(), 1.5);
  assert.equal(online.getInvestmentCap(), 1.5);
  assert.equal(local.getInterestRate(), 1.5);
  assert.equal(online.getInterestRate(), 1.5);

  const uncappedDefs = defs.map((def, index) => ({
    ...def,
    key: `uncapped_${index}`,
    investmentCap: undefined
  }));
  const localDefault = new UpgradeManager();
  localDefault.setBigUpgradeDefs(uncappedDefs);
  const onlineDefault = new PlayerProgression({
    bigUpgradesEnabled: true,
    customBigUpgrades: uncappedDefs
  });

  for (const def of uncappedDefs) {
    assert.equal(localDefault.buyBigUpgrade(def.key), true);
    assert.equal(onlineDefault.buyBigUpgrade(def.key), true);
  }

  assert.equal(localDefault.getInvestmentCap(), 1);
  assert.equal(onlineDefault.getInvestmentCap(), 1);
  assert.equal(localDefault.getInterestRate(), 1);
  assert.equal(onlineDefault.getInterestRate(), 1);
});

test('server catalog merge matches the local customizer override and soft-delete rules', () => {
  const custom = [
    {
      key: 'comboX',
      title: 'Combo-X Deluxe',
      baseCost: 9000,
      effect: 'comboMultiplier',
      value: 2.25,
      overrideDefaults: true
    },
    {
      key: 'customRoll',
      title: 'Custom Roll',
      baseCost: 1234,
      effect: 'rollMultiplier',
      value: 1.75
    },
    { key: 'deleted_masterPredict', deleted: true }
  ];

  const local = new BigUpgradeCustomizer();
  local.customUpgrades = custom;

  assert.deepEqual(getActiveBigUpgrades(custom), local.getActiveUpgrades());
  assert.equal(getActiveBigUpgrades(custom).some((upgrade) => upgrade.key === 'masterPredict'), false);
  assert.equal(
    getActiveBigUpgrades(custom).find((upgrade) => upgrade.key === 'comboX').title,
    'Combo-X Deluxe'
  );
});

test('the custom big-upgrade limit is 200 in both the client and server', () => {
  assert.equal(BigUpgradeCustomizer.MAX_UPGRADES, 200);
  assert.equal(MAX_CUSTOM_BIG_UPGRADES, 200);
});

test('server custom-upgrade boundary drops malformed and unbounded entries', () => {
  const valid = {
    key: 'customRoll',
    title: 'Custom Roll',
    baseCost: 1234,
    effect: 'rollMultiplier',
    value: 1.75
  };
  const sanitized = sanitizeCustomBigUpgrades([
    valid,
    { key: 'badEffect', title: 'Bad', baseCost: 10, effect: 'executeCode' },
    { key: 'negativeCost', title: 'Bad', baseCost: -1, effect: 'rollMultiplier' },
    { key: '', title: 'Bad', baseCost: 10, effect: 'rollMultiplier' },
    null,
    'not an object'
  ]);

  assert.deepEqual(sanitized, [valid]);

  const many = Array.from({ length: MAX_CUSTOM_BIG_UPGRADES + 25 }, (_, index) => ({
    ...valid,
    key: `custom_${index}`
  }));
  assert.equal(sanitizeCustomBigUpgrades(many).length, MAX_CUSTOM_BIG_UPGRADES);
});

test('lobby config accepts and bounds the local cost multiplier and big-upgrade flag', () => {
  const defaults = normalizeConfig({});
  assert.equal(defaults.progression, true);
  assert.equal(defaults.rounds, 30);
  assert.equal(defaults.bigUpgradesEnabled, true);
  assert.equal(defaults.costMultiplier, 1);
  assert.deepEqual(defaults.customBigUpgrades, []);
  assert.equal('combos' in defaults, false, 'classic combo mode is gone');

  assert.equal(normalizeConfig({ bigUpgradesEnabled: true }).bigUpgradesEnabled, true);
  assert.equal(normalizeConfig({ costMultiplier: 0.1 }).costMultiplier, 0.1);
  assert.equal(normalizeConfig({ costMultiplier: 5 }).costMultiplier, 5);
  assert.equal(normalizeConfig({ costMultiplier: 99 }).costMultiplier, 5);
  assert.equal(normalizeConfig({ costMultiplier: -99 }).costMultiplier, 0.1);
  assert.equal(normalizeConfig({ costMultiplier: 'not-a-number' }).costMultiplier, 1);
  assert.equal(normalizeConfig({ costMult: 2 }).costMultiplier, 2, 'the local costMult shape is accepted');
  assert.equal(normalizeCostMultiplier(undefined), 1);

  const progression = normalizeConfig({
    progression: false,
    combos: false,
    rounds: 5,
    bigUpgradesEnabled: false,
    costMultiplier: 2,
    customBigUpgrades: [{
      key: 'customRoll',
      title: 'Custom Roll',
      baseCost: 1234,
      effect: 'rollMultiplier',
      value: 1.75
    }]
  });
  assert.equal(progression.progression, true, 'classic requests are ignored');
  assert.equal(progression.rounds, 10, 'rounds use the local ladder floor');
  assert.equal(progression.bigUpgradesEnabled, false);
  assert.equal(progression.costMultiplier, 2);
  assert.equal(progression.customBigUpgrades.length, 1);
  assert.equal(progression.teams, false);
});
