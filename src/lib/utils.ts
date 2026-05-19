/**
 * Small utility helpers used across the app.
 *
 * `cn` is the standard className combiner pattern from the shadcn ecosystem.
 * It merges Tailwind utility lists and dedupes conflicting classes so
 * `cn('p-2', 'p-4')` yields `'p-4'` instead of both. Saves you from accidental
 * style overrides when composing variants.
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Formats a number for display in stat cards. Picks a sensible precision based
 * on magnitude so we don't show "1234567.0000" or "0.00000123".
 *
 * Real CSVs throw a wide range of values at us (revenue in millions, conversion
 * rates in fractions, counts in dozens). One formatter that handles all three
 * is worth the few lines of logic.
 */
export function formatStat(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}k`
  if (abs >= 1) return value.toFixed(2)
  if (abs >= 0.01) return value.toFixed(3)
  return value.toExponential(2)
}
