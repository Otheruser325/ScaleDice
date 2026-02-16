export const DEBUG_MODE = false;

class DebugManager {
  static enabled = DEBUG_MODE;
  static namespace = 'Debug';

  static log(...args) {
    if (!DebugManager.enabled) return;
    console.log(`[${DebugManager.namespace}]`, ...args);
  }

  static warn(...args) {
    if (!DebugManager.enabled) return;
    console.warn(`[${DebugManager.namespace}]`, ...args);
  }

  static error(...args) {
    if (!DebugManager.enabled) return;
    console.error(`[${DebugManager.namespace}]`, ...args);
  }

  static setNamespace(namespace = 'Debug') {
    DebugManager.namespace = namespace;
  }

  static turnStart({ playerIndex, playerName, round } = {}) {
    DebugManager.log('turn-start', {
      playerIndex,
      playerName,
      round
    });
  }

  static turnEnd({ playerIndex, playerName, reason } = {}) {
    DebugManager.log('turn-end', {
      playerIndex,
      playerName,
      reason
    });
  }

  static rollStart({ playerIndex, playerName } = {}) {
    DebugManager.log('roll-start', { playerIndex, playerName });
  }

  static rollResult({ playerIndex, playerName, dice, scored } = {}) {
    DebugManager.log('roll-result', { playerIndex, playerName, dice, scored });
  }
}

const GlobalDebug = DebugManager;
export default GlobalDebug;
