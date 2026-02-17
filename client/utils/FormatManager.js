class FormatManager {
  static UNITS = [
    { threshold: 1e63, short: 'Vg', name: 'Vigintillion' },
    { threshold: 1e60, short: 'NoD', name: 'Novemdecillion' },
    { threshold: 1e57, short: 'OcD', name: 'Octodecillion' },
    { threshold: 1e54, short: 'SpD', name: 'Septendecillion' },
    { threshold: 1e51, short: 'SxD', name: 'Sexdecillion' },
    { threshold: 1e48, short: 'QiD', name: 'Quindecillion' },
    { threshold: 1e45, short: 'QaD', name: 'Quattuordecillion' },
    { threshold: 1e42, short: 'TD', name: 'Tredecillion' },
    { threshold: 1e39, short: 'DD', name: 'Duodecillion' },
    { threshold: 1e36, short: 'UD', name: 'Undecillion' },
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

  static formatEngineering(n) {
    if (n === null || n === undefined) return '0';
    if (!Number.isFinite(n)) return '0';
    if (n === 0) return '0';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const exp = Math.floor(Math.log10(abs));
    const engExp = Math.floor(exp / 3) * 3;
    const mantissa = abs / Math.pow(10, engExp);
    return `${sign}${mantissa.toFixed(3)}e${engExp}`;
  }

  static formatWithCommas(n) {
    if (n === null || n === undefined) return '0';
    if (!Number.isFinite(n)) return '0';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const parts = abs.toString().split('.');
    const intPart = parts[0];
    const fracPart = parts[1] ? `.${parts[1]}` : '';
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}${withCommas}${fracPart}`;
  }

  static formatCompact(n) {
    if (n === null || n === undefined) return '0';
    const abs = Math.abs(n);
    
    if (abs < 1000) return n.toString();

    const maxUnit = this.UNITS[0];
    const overflowThreshold = maxUnit ? maxUnit.threshold * 1000 : 1e66;
    if (abs >= overflowThreshold) {
      return this.formatEngineering(n);
    }
    
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
    
    if (abs < 1e6) return this.formatWithCommas(n);

    const maxUnit = this.UNITS[0];
    const overflowThreshold = maxUnit ? maxUnit.threshold * 1000 : 1e66;
    if (abs >= overflowThreshold) {
      return n < 0 ? '-A LOT!' : 'A LOT!';
    }
    
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

export function formatCompactFull(n) {
  return FormatManager.formatCompactFull(n);
}

export default GlobalFormat;
