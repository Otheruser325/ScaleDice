export function formatCompact(n) {
  if (n === null || n === undefined) return '0';
  const abs = Math.abs(n);
  if (abs < 1000) return n.toString();
  if (abs < 1e6) return (n / 1e3).toFixed(3) + 'K';
  if (abs < 1e9) return (n / 1e6).toFixed(3) + 'M';
  if (abs < 1e12) return (n / 1e9).toFixed(3) + 'B';
  return (n / 1e12).toFixed(3) + 'T';
}