/**
 * ColumnCard, one card per column.
 *
 * Layout:
 *   [type badge] [column name]               (right-aligned: count + missing)
 *   ----------------------------------------------------------------------
 *   StatGrid (key/value pairs, 2 cols mobile, 4 cols desktop)
 *   ----------------------------------------------------------------------
 *   NarrativeList (bulleted plain-English explanations)
 *
 * Charts will land in part B beneath the StatGrid and above the
 * NarrativeList. The card's spacing is already sized to accommodate that.
 */

import { Hash, Type, Calendar, ToggleLeft, HelpCircle } from 'lucide-react'
import type { ColumnSummary, NumericSummary } from '@/types/stats'
import { buildNarrativesFor } from '@/lib/narratives/descriptive'
import {
  formatCount,
  formatDate,
  formatNumber,
  formatPct,
  formatStatValue,
} from '@/lib/narratives/format'
import { DistributionChart } from '@/components/charts/DistributionChart'
import { StatGrid } from './StatGrid'
import { NarrativeList } from './NarrativeList'

interface ColumnCardProps {
  summary: ColumnSummary
}

export function ColumnCard({ summary }: ColumnCardProps) {
  const narratives = buildNarrativesFor(summary)
  const meta = TYPE_META[summary.kind]
  const Icon = meta.icon

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      {/* Header strip. */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`inline-flex flex-shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${meta.badgeClass}`}
          >
            <Icon className="h-3 w-3" aria-hidden />
            {summary.kind}
          </span>
          <span className="truncate font-mono text-sm font-medium text-slate-100">
            {summary.name}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3 font-mono text-xs text-slate-500">
          <span>{formatCount(summary.totalRows - summary.missing)} rows</span>
          {summary.missing > 0 && (
            <span className="text-amber-400/70">
              {formatCount(summary.missing)} missing
            </span>
          )}
        </div>
      </header>

      {/* Stats grid varies by type. */}
      <div className="px-5 py-4">
        <StatGrid items={buildStatItems(summary)} />
      </div>

      {/* Distribution chart, numeric columns only. Renders between the
          stat grid and the narratives so the visual sits where the user's
          eye naturally lands after scanning the numbers. */}
      {summary.kind === 'numeric' && (
        <div className="border-t border-slate-800 px-5 py-4">
          <DistributionChart summary={summary} />
        </div>
      )}

      {/* Narrative bullets. */}
      <div className="border-t border-slate-800 px-5 pb-5 pt-4">
        <NarrativeList narratives={narratives} />
      </div>
    </section>
  )
}

/**
 * Build the StatGrid item list per column type. Order matters: most
 * decision-relevant stats first, edge-case ones last.
 */
function buildStatItems(summary: ColumnSummary): Array<{
  label: string
  value: string
  detail?: string
}> {
  switch (summary.kind) {
    case 'numeric': {
      // Per-column formatter that respects the year-vs-standard hint. Year
      // columns display 2024 instead of 2.02k.
      const num = (v: number) => formatStatValue(v, (summary as NumericSummary).formatHint)
      return [
        { label: 'mean', value: num(summary.mean) },
        { label: 'median', value: num(summary.median) },
        {
          label: 'std',
          value: formatNumber(summary.std),
          detail: `CV ${summary.cv !== null && Number.isFinite(summary.cv) ? summary.cv.toFixed(2) : '—'}`,
        },
        {
          label: 'MAD',
          value: formatNumber(summary.mad),
          detail: 'robust σ',
        },
        { label: 'min', value: num(summary.min) },
        { label: 'p25', value: num(summary.p25) },
        { label: 'p75', value: num(summary.p75) },
        { label: 'max', value: num(summary.max) },
        {
          label: 'skew',
          value: formatNumber(summary.skew),
          detail: 'Fisher-Pearson',
        },
        {
          label: 'kurtosis',
          value: formatNumber(summary.kurtosisExcess),
          detail: 'excess',
        },
        {
          label: 'outliers',
          value: `${summary.outlierRobustCount}`,
          detail: `Tukey ${summary.outlierIqrCount}`,
        },
        {
          label: 'gini',
          value: summary.gini.toFixed(2),
        },
      ]
    }
    case 'categorical': {
      const items = [
        { label: 'unique', value: formatCount(summary.uniqueCount) },
        { label: 'mode', value: summary.mode },
        {
          label: 'mode freq',
          value: formatPct(summary.modeFrequency / summary.count),
        },
        {
          label: 'entropy',
          value: summary.entropyNormalized.toFixed(2),
          detail: 'normalized 0..1',
        },
      ]
      return items
    }
    case 'datetime':
      return [
        { label: 'from', value: formatDate(summary.minDate) },
        { label: 'to', value: formatDate(summary.maxDate) },
        { label: 'range', value: `${summary.rangeDays} days` },
        { label: 'granularity', value: summary.granularity },
        { label: 'gaps', value: formatCount(summary.gapCount) },
      ]
    case 'boolean':
      return [
        { label: 'true', value: formatCount(summary.trueCount) },
        { label: 'false', value: formatCount(summary.falseCount) },
        { label: 'true rate', value: formatPct(summary.truePct) },
      ]
    case 'unknown':
      return []
  }
}

// Type-specific badge + icon metadata. Same palette as the FilePreview
// type badges so visual continuity carries from preview to dashboard.
const TYPE_META = {
  numeric: {
    icon: Hash,
    badgeClass: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300',
  },
  categorical: {
    icon: Type,
    badgeClass: 'border-violet-900/60 bg-violet-950/40 text-violet-300',
  },
  datetime: {
    icon: Calendar,
    badgeClass: 'border-sky-900/60 bg-sky-950/40 text-sky-300',
  },
  boolean: {
    icon: ToggleLeft,
    badgeClass: 'border-amber-900/60 bg-amber-950/40 text-amber-300',
  },
  unknown: {
    icon: HelpCircle,
    badgeClass: 'border-slate-800 bg-slate-900 text-slate-400',
  },
} as const

/**
 * If categorical, we also want to surface the top-N value list. The
 * StatGrid doesn't have a slot for tabular data, so we render a separate
 * compact list and append it inside the card.
 */
export function TopValuesList({
  summary,
}: {
  summary: { kind: 'categorical'; topValues: Array<{ value: string; count: number; pct: number }> }
}) {
  if (summary.topValues.length === 0) return null
  return (
    <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
        Top values
      </div>
      <ul className="space-y-1">
        {summary.topValues.map((entry) => (
          <li
            key={entry.value}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="truncate font-mono text-slate-200">
              {entry.value}
            </span>
            <span className="font-mono text-slate-500">
              {formatCount(entry.count)}{' '}
              <span className="text-slate-600">/ {formatPct(entry.pct)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
