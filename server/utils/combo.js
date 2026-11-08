// Server-side mirror of client/utils/ComboManager.js.
//
// Online scoring must match local scoring exactly: the server is the only
// authority for points, so its combo table cannot drift from the client's.
// test/scoring.test.js exhaustively compares this module with the client one.

export function checkCombo(values) {
  const count = {};
  for (const v of values || []) count[v] = (count[v] || 0) + 1;

  const sorted = [...(values || [])].sort((a, b) => a - b);
  const unique = [...new Set(sorted)];
  const occurrences = Object.values(count);

  const pairs = occurrences.filter((c) => c === 2).length;
  const triples = occurrences.filter((c) => c === 3).length;

  // Clean straight (1..6)
  const clean = [1, 2, 3, 4, 5, 6];
  if (JSON.stringify(unique) === JSON.stringify(clean)) {
    return { type: 'CLEAN STRAIGHT!!!', key: 'straight', multiplier: 40, intensity: 1.6 };
  }

  // Six of a kind
  if (occurrences.includes(6)) {
    return { type: 'SIX OF A KIND?!!?!!?OP', key: 'sixOfAKind', multiplier: 1000, intensity: 2 };
  }

  // Power House (4 + 2) — check before four-of-a-kind
  if (occurrences.includes(4) && occurrences.includes(2)) {
    return { type: 'POWER HOUSE!!!???', key: 'powerHouse', multiplier: 120, intensity: 1.7 };
  }

  // Triple Trend (two separate triples) — check before triple
  if (triples === 2) {
    return { type: 'TRIPLE TREND! WOW!', key: 'tripleTrend', multiplier: 80, intensity: 1.5 };
  }

  // Three Pair (3 pairs)
  if (pairs === 3) {
    return { type: 'THREE PAIR!!', key: 'threePair', multiplier: 25, intensity: 1.3 };
  }

  // Large straight exact matches (5 in a row)
  const large1 = [1, 2, 3, 4, 5];
  const large2 = [2, 3, 4, 5, 6];
  if (JSON.stringify(unique) === JSON.stringify(large1) || JSON.stringify(unique) === JSON.stringify(large2)) {
    return { type: 'LARGE STRAIGHT!', key: 'straight', multiplier: 7.5, intensity: 1.4 };
  }

  // Small straight (4 in a row)
  if (unique.length >= 4) {
    for (let i = 0; i < unique.length - 3; i++) {
      if (unique[i] + 1 === unique[i + 1] &&
          unique[i] + 2 === unique[i + 2] &&
          unique[i] + 3 === unique[i + 3]) {
        return { type: 'SMALL STRAIGHT!', key: 'straight', multiplier: 5, intensity: 1.2 };
      }
    }
  }

  // Five of a kind
  if (occurrences.includes(5)) {
    return { type: 'FIVE OF A KIND?!!?!', key: 'fiveOfAKind', multiplier: 150, intensity: 1.8 };
  }

  // Four of a kind
  if (occurrences.includes(4)) {
    return { type: 'FOUR OF A KIND!!!!', key: 'fourOfAKind', multiplier: 30, intensity: 1.5 };
  }

  // Full house (3 + 2)
  if (occurrences.includes(3) && occurrences.includes(2)) {
    return { type: 'FULL HOUSE!!!', key: 'fullHouse', multiplier: 15, intensity: 1.4 };
  }

  // Three of a kind
  if (occurrences.includes(3)) {
    return { type: 'TRIPLE!', key: 'triple', multiplier: 6, intensity: 1.2 };
  }

  // Two pair
  if (pairs === 2) {
    return { type: 'TWO PAIR!', key: 'twoPair', multiplier: 4, intensity: 1.1 };
  }

  // Pair
  if (occurrences.includes(2)) {
    return { type: 'PAIR!', key: 'pair', multiplier: 2, intensity: 1 };
  }

  return null;
}

export const EMPTY_COMBO_STATS = Object.freeze({
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
});

export function createComboStats() {
  return { ...EMPTY_COMBO_STATS };
}

export default { checkCombo, createComboStats, EMPTY_COMBO_STATS };
