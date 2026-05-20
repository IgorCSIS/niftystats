/**
 * ClusteringSection: the natural-groups layer of the dashboard.
 *
 * Layout, top to bottom:
 *
 *   1. Section header ("Natural groups / What clusters together")
 *   2. Summary narrative (how clean the separation is, how many groups)
 *   3. PCA scatter plot, one color per cluster
 *   4. Caption explaining the scatter
 *   5. One ClusterCard per group, with distinguishing features
 *
 * Handles both "happy path" (real ClusteringResult) and "skipped" cases
 * (not enough rows, too few numeric columns, sklearn failure). Skipped
 * renders a friendly info card with the reason rather than empty space.
 */

import { motion } from 'framer-motion'
import { Layers, AlertCircle } from 'lucide-react'
import type { ClusteringOutcome, ClusteringResult } from '@/types/stats'
import { ClusterScatter } from '@/components/charts/ClusterScatter'
import { NarrativeList } from './NarrativeList'
import { ClusterCard } from './ClusterCard'
import {
  buildClusteringSummaryNarrative,
  buildProjectionExplanation,
} from '@/lib/narratives/clustering'

/** Same color palette as ClusterScatter, repeated here so the cards can
 *  use the same accent color as their matching scatter dots. */
const CLUSTER_COLORS = [
  '#10b981',
  '#a855f7',
  '#0ea5e9',
  '#f59e0b',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#06b6d4',
] as const

interface ClusteringSectionProps {
  outcome: ClusteringOutcome
}

export function ClusteringSection({ outcome }: ClusteringSectionProps) {
  const isSkipped = 'skippedReason' in outcome

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
      className="mt-12"
      aria-labelledby="clustering-heading"
    >
      <header
        className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end"
        data-pdf-block="true"
      >
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent-bright)]">
            <Layers className="h-3 w-3" aria-hidden />
            Natural groups
          </div>
          <h2
            id="clustering-heading"
            className="mt-1 text-2xl font-semibold tracking-tight text-slate-50"
          >
            What clusters together.
          </h2>
        </div>
        {!isSkipped && (
          <div className="font-mono text-xs text-slate-500">
            {outcome.k} groups · silhouette {outcome.silhouetteScore.toFixed(2)} ·
            computed in {outcome.computeMs}ms
          </div>
        )}
      </header>

      {isSkipped ? (
        <div
          className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-6"
          data-pdf-block="true"
        >
          <div className="flex items-start gap-3">
            <AlertCircle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400"
              aria-hidden
            />
            <div className="text-sm text-slate-300">
              <div className="font-medium text-slate-100">
                Clustering wasn't run for this dataset.
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {outcome.skippedReason}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Body result={outcome} />
      )}
    </motion.section>
  )
}

function Body({ result }: { result: ClusteringResult }) {
  const summaryNarrative = buildClusteringSummaryNarrative(result)
  const projectionExplanation = buildProjectionExplanation(result)

  return (
    <div className="space-y-8">
      {/* Summary narrative card. */}
      <div
        className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4"
        data-pdf-block="true"
      >
        <NarrativeList narratives={[summaryNarrative]} />
      </div>

      {/* Scatter + caption together as one block so they don't split. */}
      <div data-pdf-block="true">
        <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">
          <span>Scatter view</span>
          <span className="text-slate-700">/</span>
          <span>PCA 2D projection</span>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <ClusterScatter result={result} />
        </div>
        <div className="mt-2 px-2">
          <NarrativeList narratives={[projectionExplanation]} />
        </div>
      </div>

      {/* Per-cluster cards. */}
      <div>
        <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">
          <span>Groups</span>
          <span className="text-slate-700">/</span>
          <span>{result.clusters.length}</span>
        </div>
        <div className="space-y-4">
          {result.clusters.map((cluster, i) => (
            <div key={cluster.id} data-pdf-block="true">
              <ClusterCard
                cluster={cluster}
                accentColor={CLUSTER_COLORS[i % CLUSTER_COLORS.length]}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
