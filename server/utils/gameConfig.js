// Normalized settings for Scale Dice online play. Online matches use the same
// local progression rules as LocalGameScene: combos, dice unlocks, economy,
// luck, and the local big-upgrade catalogue. There is no classic/Fives fallback.
import { normalizeCostMultiplier, sanitizeCustomBigUpgrades } from './upgrades.js';

export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const players = Math.min(6, Math.max(2, Number(source.players) || 2));
  // Keep the same round choices local play offers: 10–100, default 30.
  const rounds = Math.min(100, Math.max(10, Number(source.rounds) || 30));
  const timeLimitSeconds = Math.min(300, Math.max(5, Number(source.timeLimitSeconds) || 30));

  return {
    players,
    rounds,
    teams: !!(source.teams ?? source.teamsEnabled),
    timeLimitSeconds,
    // Kept in the live game payload so existing clients can distinguish this
    // ruleset, but it is no longer a host-selectable fallback.
    progression: true,
    bigUpgradesEnabled: source.bigUpgradesEnabled !== false,
    costMultiplier: normalizeCostMultiplier(source.costMultiplier ?? source.costMult),
    customBigUpgrades: sanitizeCustomBigUpgrades(source.customBigUpgrades)
  };
}

export default normalizeConfig;
