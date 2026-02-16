class FormatManager {
  static UNITS = [
    { threshold: 1e33, short: 'Dc', name: 'Decillion' },
    { threshold: 1e30, short: 'No', name: 'Nonillion' },
    { threshold: 1e27, short: 'Oc', name: 'Octillion' },
    { threshold: 1e24, short: 'Sp', name: 'Septillion' },
    { threshold: 1e21, short: 'Sx', name: 'Sextillion' },
    { threshold: 1e18, short: 'Qi', name: 'Quintillion' },
    { threshold: 1e15, short: 'Qa', name: 'Quadrillion' },
    { threshold: 1e12, short: 'T', name: 'Trillion' },
    { threshold: 1e9, short: 'B', name: 'Billion' },
    { threshold: 1e6, short: 'M', name: 'Million' },
    { threshold: 1e3, short: 'K', name: 'Thousand' }
  ];

  static formatCompact(n) {
    if (n === null || n === undefined) return '0';
    const abs = Math.abs(n);
    
    if (abs < 1000) return n.toString();
    
    // Find the appropriate unit
    for (let unit of this.UNITS) {
      if (abs >= unit.threshold) {
        const value = (n / unit.threshold).toFixed(3);
        return value + unit.short;
      }
    }
    
    return n.toString();
  }

  // Format with full names (e.g. "1.234 Million" instead of "1.234M")
  static formatCompactFull(n) {
    if (n === null || n === undefined) return '0';
    const abs = Math.abs(n);
    
    if (abs < 1000) return n.toString();
    
    // Find the appropriate unit
    for (let unit of this.UNITS) {
      if (abs >= unit.threshold) {
        const value = (n / unit.threshold).toFixed(3);
        return value + ' ' + unit.name;
      }
    }
    
    return n.toString();
  }
}

const GlobalFormat = FormatManager;

// Export both named and default for compatibility
export function formatCompact(n) {
  return FormatManager.formatCompact(n);
}

export default GlobalFormat;