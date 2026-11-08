import { randomInt } from 'node:crypto';

export const DICE_COUNT = 1;
export const DICE_SIDES = 6;

// Online dice are server-authoritative, so they come from a CSPRNG rather than
// Math.random(). Otherwise a player could observe enough rolls to predict the
// generator and know every future turn.
export function rollDice(count = DICE_COUNT, sides = DICE_SIDES) {
  const safeCount = Math.max(0, count | 0);
  const safeSides = Math.max(2, sides | 0);
  return Array.from({ length: safeCount }, () => randomInt(1, safeSides + 1));
}

export function baseScore(dice = []) {
  if (!Array.isArray(dice) || dice.length === 0) return 0;
  return dice.reduce((a, b) => a + b, 0);
}

export default { rollDice, baseScore, DICE_COUNT, DICE_SIDES };
