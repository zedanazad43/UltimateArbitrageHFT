export function usd(n: number, opts?: { compact?: boolean; sign?: boolean }) {
  const sign = opts?.sign && n > 0 ? "+" : ""
  return (
    sign +
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: opts?.compact ? "compact" : "standard",
      maximumFractionDigits: opts?.compact ? 1 : 0,
    }).format(n)
  )
}

export function num(n: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n)
}

export function pct(n: number, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`
}

export function ns(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}µs`
  return `${Math.round(n)}ns`
}

export function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 1) return "now"
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m`
}
