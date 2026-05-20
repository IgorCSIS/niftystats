/**
 * RelationalSection: the relationships layer of the dashboard.
 *
 * Renders three blocks, in order of how a non-technical reader scans them:
 *
 *   1. Top-relationships strip: 3 strongest positive, 3 strongest
 *      negative, plus any non-linear hints. Each is a narrative card,
 *      not a chart, because the takeaway IS the prose ("revenue and
 *      marketing spend move together strongly").
 *
 *   2. Correlation heatmap: the full Pearson matrix, hover for r and p.
 *      For wide CSVs this becomes the primary scan surface.
 *
 *   3. Regression cards: one per numeric target. Each card carries R²
 *      badge, predictor table, and the narrative.
 *
 * If there aren't enough numeric columns to compute relationships at all,
 * we render a single info card explaining the situation rather than
 * surfacing empty charts.
 */

import { motion } from 'framer-motion'
import { GitCompareArrows } from 'lucide-react'
import type { RelationalResult, TopCorrelation } from '@/types/stats'
import { CorrelationHeatmap } from '@/components/charts/CorrelationHeatmap'
import { NarrativeList } from './NarrativeList'
import { RegressionCard } from './RegressionCard'
import { buildCorrelationNarrative } from '@/lib/narratives/relational'

interface RelationalSectionProps {
  result: RelationalResult
}

export function RelationalSection({ result }: RelationalSectionProps) {
  const numericColumnCount = result.pearson.columns.length
  const hasEnoughForRelational = numericColumnCount >= 2

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
      className="mt-12"
      aria-labelledby="relational-heading"
    >
      <header
        className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end"
        data-pdf-block="true"
      >
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent-bright)]">
            <GitCompareArrows className="h-3 w-3" aria-hidden />
            Relationships
          </div>
          <h2
            id="relational-heading"
            className="mt-1 text-2xl font-semibold tracking-tight text-slate-50"
          >
            What predicts what.
          </h2>
        </div>
        <div className="font-mono text-xs text-slate-500">
          {numericColumnCount} numeric column{numericColumnCount === 1 ? '' : 's'}{' '}
          analyzed · {result.regressions.length} regression
          {result.regressions.length === 1 ? '' : 's'} · computed in{' '}
          {result.computeMs}ms
        </div>
      </header>

      {!hasEnoughForRelational ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-6 text-sm text-slate-400">
          We need at least two numeric columns to compute correlations and
          regressions. This dataset doesn't have enough numeric variation for a
          relationships analysis. Descriptive analysis above still applies.
        </div>
      ) : (
        <div className="space-y-10">
          <TopRelationshipsStrip result={result} />
          <HeatmapBlock result={result} />
          <RegressionsBlock result={result} />
        </div>
      )}
    </motion.section>
  )
}

function TopRelationshipsStrip({ result }: { result: RelationalResult }) {
  const hasAny =
    result.topPositive.length > 0 ||
    result.topNegative.length > 0 ||
    result.topNonLinear.length > 0

  if (!hasAny) return null

  return (
    <div>
      <div
        className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-slate-500"
        data-pdf-block="true"
      >
        <span>Strongest relationships</span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {result.topPositive.length > 0 && (
          <RelationshipGroup
            label="Move together"
            tone="positive"
            entries={result.topPositive}
          />
        )}
        {result.topNegative.length > 0 && (
          <RelationshipGroup
            label="Move in opposite directions"
            tone="negative"
            entries={result.topNegative}
          />
        )}
        {result.topNonLinear.length > 0 && (
          <div className="md:col-span-2">
            <RelationshipGroup
              label="Non-linear hints"
              tone="hint"
              entries={result.topNonLinear}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function RelationshipGroup({
  label,
  tone,
  entries,
}: {
  label: string
  tone: 'positive' | 'negative' | 'hint'
  entries: TopCorrelation[]
}) {
  const toneClasses = {
    positive: 'border-emerald-900/60',
    negative: 'border-fuchsia-900/60',
    hint: 'border-amber-900/60',
  }[tone]

  return (
    <div
      className={`rounded-xl border ${toneClasses} bg-slate-900/40 px-5 py-4`}
      data-pdf-block="true"
    >
      <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <NarrativeList narratives={entries.map(buildCorrelationNarrative)} />
    </div>
  )
}

function HeatmapBlock({ result }: { result: RelationalResult }) {
  return (
    <div data-pdf-block="true">
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">
        <span>Correlation heatmap</span>
        <span className="text-slate-700">/</span>
        <span>Pearson</span>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <CorrelationHeatmap matrix={result.pearson} />
      </div>
      <p className="mt-2 px-4 text-xs leading-relaxed text-slate-500">
        Green means columns move together, magenta means they move in opposite
        directions, near-black means no linear relationship. Hover any cell for
        the exact correlation coefficient and statistical significance.
      </p>
    </div>
  )
}

function RegressionsBlock({ result }: { result: RelationalResult }) {
  if (result.regressions.length === 0) return null
  return (
    <div>
      <div
        className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-slate-500"
        data-pdf-block="true"
      >
        <span>Regression per target</span>
        <span className="text-slate-700">/</span>
        <span>{result.regressions.length}</span>
      </div>
      <div className="space-y-4">
        {result.regressions.map((reg) => (
          <div key={reg.target} data-pdf-block="true">
            <RegressionCard regression={reg} />
          </div>
        ))}
      </div>
    </div>
  )
}
