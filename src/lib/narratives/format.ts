/**
 * Number and date formatters used across the narrative + dashboard layers.
 *
 * The goal: make stats readable without losing meaning. A "mean of 5240.823"
 * is technically accurate but reads like a data dump; "5.2k" is what an
 * analyst would write. Same for percentages, dates, and counts.
 */

/**
 * Compact number format. Picks units (k, M, B) based on magnitude and keeps
 * 1 or 2 significant decimals where useful.
 *
 * Examples:
 *   formatNumber(0.034)      -> "0.034"
 *   formatNumber(3.14)       -> "3.14"
 *   formatNumber(1234)       -> "1.23k"
 *   formatNumber(1_500_000)  -> "1.5M"
 *   formatNumber(null)       -> "—"
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}k`
  if (abs >= 10) return value.toFixed(1)
  if (abs >= 1) return value.toFixed(2)
  if (abs >= 0.01) return value.toFixed(3)
  return value.toExponential(2)
}

/** Format a fraction (0..1) as a percentage with 0 or 1 decimals. */
export function formatPct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction))
    return '—'
  const pct = fraction * 100
  if (Math.abs(pct) >= 10) return `${pct.toFixed(0)}%`
  if (Math.abs(pct) >= 1) return `${pct.toFixed(1)}%`
  return `${pct.toFixed(2)}%`
}

/** Format an ISO timestamp as a short date (no time). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
}

/** Format a count with thousands separators. Always integer. */
export function formatCount(count: number): string {
  return Math.round(count).toLocaleString('en-US')
}
