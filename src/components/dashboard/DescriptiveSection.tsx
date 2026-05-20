/**
 * DescriptiveSection, the top-level descriptive dashboard.
 *
 * Renders the result of an Analyze run. Groups column cards by type
 * (numeric first because that's where the most analytic value lives, then
 * categorical, datetime, boolean, unknown). Within each group, columns
 * keep source order so the layout mirrors the source CSV.
 *
 * For part A of v2.s3 the cards are text-only (StatGrid + NarrativeList).
 * Part B adds Plotly histograms inside each numeric card, an outlier
 * scatter, and a global missing-values bar chart at the top.
 */

import { motion } from 'framer-motion'
import { BarChart3 } from 'lucide-react'
import type {
  CategoricalSummary,
  ColumnSummary,
  DescriptiveResult,
} from '@/types/stats'
import { MissingValuesChart } from '@/components/charts/MissingValuesChart'
import { ColumnCard, TopValuesList } from './ColumnCard'
import { formatCount } from '@/lib/narratives/format'

interface DescriptiveSectionProps {
  result: DescriptiveResult
}

/** Display order for the column-type groups. */
const TYPE_ORDER: ColumnSummary['kind'][] = [
  'numeric',
  'categorical',
  'datetime',
  'boolean',
  'unknown',
]

const GROUP_LABEL: Record<ColumnSummary['kind'], string> = {
  numeric: 'Numeric columns',
  categorical: 'Categorical columns',
  datetime: 'Datetime columns',
  boolean: 'Boolean columns',
  unknown: 'Not analyzed',
}

export function DescriptiveSection({ result }: DescriptiveSectionProps) {
  // Bucket columns by kind while preserving source order within each bucket.
  const groups = new Map<ColumnSummary['kind'], ColumnSummary[]>()
  for (const col of result.columns) {
    const bucket = groups.get(col.kind) ?? []
    bucket.push(col)
    groups.set(col.kind, bucket)
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="mt-8"
      aria-labelledby="descriptive-heading"
    >
      {/* Section header. data-pdf-block so the PDF exporter treats it as
          its own atomic snapshot. */}
      <header
        className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end"
        data-pdf-block="true"
      >
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent-bright)]">
            <BarChart3 className="h-3 w-3" aria-hidden />
            Descriptive analysis
          </div>
          <h2
            id="descriptive-heading"
            className="mt-1 text-2xl font-semibold tracking-tight text-slate-50"
          >
            What your data says.
          </h2>
        </div>
        <div className="font-mono text-xs text-slate-500">
          {formatCount(result.rowCount)} rows ·{' '}
          {formatCount(result.columnCount)} columns · computed in{' '}
          {result.computeMs}ms
        </div>
      </header>

      {/* Data-quality snapshot at the top. Only renders if any column
          actually has missing values, so a clean dataset doesn't get a
          large empty banner. */}
      <DataQualitySection columns={result.columns} />

      {/* One section per non-empty type bucket, in declared order. */}
      <div className="space-y-10">
        {TYPE_ORDER.map((kind) => {
          const bucket = groups.get(kind)
          if (!bucket || bucket.length === 0) return null

          return (
            <div key={kind}>
              <div
                className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-slate-500"
                data-pdf-block="true"
              >
                <span>{GROUP_LABEL[kind]}</span>
                <span className="text-slate-700">/</span>
                <span>{bucket.length}</span>
              </div>
              <div className="space-y-4">
                {bucket.map((summary) => (
                  // Wrap each card to inject the optional categorical
                  // TopValuesList that doesn't fit naturally inside the
                  // generic ColumnCard StatGrid.
                  <ColumnCardWithExtras key={summary.name} summary={summary} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </motion.section>
  )
}

/**
 * Renders a ColumnCard plus any type-specific addendum (categorical
 * top-values list, future numeric histogram, etc.). Keeping this wrapper
 * here rather than inside ColumnCard means the card itself stays a clean
 * "stats + narratives" primitive.
 *
 * `data-pdf-block` marks each wrapper as a natural page-break boundary
 * for the PDF exporter: the paginator will avoid slicing through a card
 * + its addendum and instead start a new page if they don't fit together.
 */
function ColumnCardWithExtras({ summary }: { summary: ColumnSummary }) {
  if (summary.kind === 'categorical') {
    return (
      <div data-pdf-block="true">
        <ColumnCard summary={summary} />
        <CategoricalAddendum summary={summary} />
      </div>
    )
  }
  return (
    <div data-pdf-block="true">
      <ColumnCard summary={summary} />
    </div>
  )
}

function CategoricalAddendum({ summary }: { summary: CategoricalSummary }) {
  // Render a top-values mini-table beneath the card. We slot it outside the
  // card so the card stays a uniform shape across types.
  return (
    <div className="mt-2 pl-4">
      <TopValuesList summary={summary} />
    </div>
  )
}

/**
 * Data quality section at the top of the dashboard. Renders a small header
 * + the MissingValuesChart, but only if at least one column has missing
 * values. A pristine dataset gets no banner, which keeps the dashboard
 * focused on the actual stats.
 */
function DataQualitySection({ columns }: { columns: ColumnSummary[] }) {
  const hasMissing = columns.some((c) => c.missing > 0)
  if (!hasMissing) return null

  return (
    <div className="mb-10" data-pdf-block="true">
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">
        <span>Data quality</span>
        <span className="text-slate-700">/</span>
        <span>missing values per column</span>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <MissingValuesChart columns={columns} />
      </div>
    </div>
  )
}
