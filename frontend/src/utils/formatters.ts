export function formatCompactNumber(n: number, decimals: number = 2): string {
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e15) return (n / 1e15).toFixed(Math.min(decimals, 1)) + 'Q'
  if (abs >= 1e12) return (n / 1e12).toFixed(decimals) + 'T'
  if (abs >= 1e9) return (n / 1e9).toFixed(decimals) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(decimals) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(Math.min(decimals, 1)) + 'K'
  return n.toLocaleString()
}
