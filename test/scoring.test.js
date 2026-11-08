import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCombo as serverCombo, createComboStats } from '../server/utils/combo.js';
import { checkCombo as clientCombo } from '../client/utils/ComboManager.js';
import { rollDice, baseScore } from '../server/utils/dice.js';

test('server combo detection matches the client for every 5-dice combination', () => {
  let combos = 0;
  for (let a = 1; a <= 6; a += 1) {
    for (let b = 1; b <= 6; b += 1) {
      for (let c = 1; c <= 6; c += 1) {
        for (let d = 1; d <= 6; d += 1) {
          for (let e = 1; e <= 6; e += 1) {
            const dice = [a, b, c, d, e];
            const server = serverCombo(dice);
            const client = clientCombo(dice);
            assert.deepEqual(server, client, `mismatch for ${dice.join(',')}`);
            if (server) combos += 1;
          }
        }
      }
    }
  }
  assert.ok(combos > 0, 'expected some combos in the sample space');
});

test('combo multipliers contribute to local progression scoring', () => {
  const dice = [2, 2, 2, 2, 2]; // five of a kind: base 10, x150
  const combo = serverCombo(dice);
  assert.equal(baseScore(dice), 10);
  assert.equal(combo.key, 'fiveOfAKind');
  assert.equal(Math.floor(baseScore(dice) * combo.multiplier), 1500);
});

test('straights use the same multiplied values as the client', () => {
  const largeDice = [2, 3, 4, 5, 6];
  const largeCombo = serverCombo(largeDice);
  assert.equal(largeCombo.key, 'straight');
  assert.equal(Math.floor(baseScore(largeDice) * largeCombo.multiplier), Math.floor(20 * 7.5));

  const smallDice = [1, 2, 3, 4, 6];
  const smallCombo = serverCombo(smallDice);
  assert.equal(smallCombo.key, 'straight');
  assert.equal(Math.floor(baseScore(smallDice) * smallCombo.multiplier), Math.floor(16 * 5));
});

test('rollDice returns the requested in-range faces and is not constant', () => {
  const seen = new Set();
  for (let i = 0; i < 250; i += 1) {
    const dice = rollDice(6);
    assert.equal(dice.length, 6);
    for (const face of dice) {
      assert.ok(Number.isInteger(face) && face >= 1 && face <= 6, `bad face ${face}`);
    }
    seen.add(dice.join(','));
  }
  assert.ok(seen.size > 10, 'CSPRNG output should vary across rolls');
});

test('combo stats use the same complete local combo shape for each online player', () => {
  const expectedKeys = [
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
  ];
  const stats = createComboStats();
  assert.deepEqual(Object.keys(stats), expectedKeys);
  assert.ok(Object.values(stats).every((value) => value === 0));
  assert.notEqual(createComboStats(), stats, 'each player must get its own object');
});

test('server combo detection matches the client for one through six dice', () => {
  for (let length = 1; length <= 6; length += 1) {
    const combinations = 6 ** length;
    for (let index = 0; index < combinations; index += 1) {
      const dice = [];
      let remaining = index;
      for (let i = 0; i < length; i += 1) {
        dice.push((remaining % 6) + 1);
        remaining = Math.floor(remaining / 6);
      }

      assert.deepEqual(
        serverCombo(dice),
        clientCombo(dice),
        `mismatch for ${dice.join(',')}`
      );
    }
  }
});

test('the server combo table supports the local six-dice high-tier multipliers', () => {
  const cases = [
    { dice: [1, 1, 1, 1, 1, 1], key: 'sixOfAKind' },
    { dice: [1, 1, 1, 1, 2, 2], key: 'powerHouse' },
    { dice: [1, 1, 1, 2, 2, 2], key: 'tripleTrend' },
    { dice: [1, 1, 2, 2, 3, 3], key: 'threePair' },
    { dice: [1, 2, 3, 4, 5, 6], key: 'straight' }
  ];

  for (const { dice, key } of cases) {
    const combo = clientCombo(dice);
    assert.equal(combo?.key, key, `${dice.join(',')} should be ${key}`);
    const server = serverCombo(dice);
    assert.deepEqual(server, combo, `${dice.join(',')} should match the client`);
    assert.equal(
      Math.floor(baseScore(dice) * server.multiplier),
      Math.floor(baseScore(dice) * combo.multiplier),
      `${dice.join(',')} should score like local`
    );
  }
});
