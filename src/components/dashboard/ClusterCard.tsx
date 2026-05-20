/**
 * ClusterCard: one card per detected cluster.
 *
 * Header carries the cluster label and size pill. Body shows the
 * distinguishing-feature mini-table (feature, centroid value in original
 * units, deviation in SD units, direction icon) followed by the
 * plain-English narrative.
 */

import { Users, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import type { ClusterSummary } from '@/types/stats'
import { buildClusterNarrative } from '@/lib/narratives/clustering'
import { formatCount, formatNumber, formatPct } from '@/lib/narratives/format'
import { NarrativeList } from './NarrativeList'

interface ClusterCardProps {
  cluster: ClusterSummary
  /** Hex color matching the cluster's scatter dots, for the header accent. */
  accentColor: string
}

export function ClusterCard({ cluster, accentColor }: ClusterCardProps) {
  const narrative = buildClusterNarrative(cluster)

  return (
    <section
      className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"
      style={{
        // Use the cluster's color as a left-border accent so it visually
        // ties to the scatter dot color.
        borderLeftColor: accentColor,
        borderLeftWidth: '3px',
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
          <span className="font-mono text-sm font-medium text-slate-100">
            {cluster.label}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-300">
          <Users className="h-3 w-3" aria-hidden />
          {formatCount(cluster.size)} rows · {formatPct(cluster.sizePct)}
        </div>
      </header>

      {cluster.distinguishingFeatures.length > 0 && (
        <div className="border-b border-slate-800 px-5 py-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Distinguishing features
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="py-1.5 pr-3 font-mono font-normal">feature</th>
                <th className="py-1.5 pr-3 text-right font-mono font-normal">
                  centroid
                </th>
                <th className="py-1.5 pr-3 text-right font-mono font-normal">
                  vs avg
                </th>
                <th className="py-1.5 font-mono font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {cluster.distinguishingFeatures.map((f) => (
                <DistinguishingRow key={f.feature} feature={f} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-5 pb-5 pt-4">
        <NarrativeList narratives={[narrative]} />
      </div>
    </section>
  )
}

function DistinguishingRow({
  feature,
}: {
  feature: { feature: string; centerValue: number; deviationFromMeanStd: number }
}) {
  const dev = feature.deviationFromMeanStd
  const Icon = dev > 0.1 ? ArrowUp : dev < -0.1 ? ArrowDown : Minus
  const iconClass =
    dev > 0.5
      ? 'text-emerald-400'
      : dev < -0.5
        ? 'text-fuchsia-400'
        : 'text-slate-500'
  return (
    <tr className="border-b border-slate-800/50 last:border-0">
      <td className="py-1.5 pr-3 font-mono text-slate-200">{feature.feature}</td>
      <td className="py-1.5 pr-3 text-right font-mono text-slate-300">
        {formatNumber(feature.centerValue)}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-slate-300">
        {dev > 0 ? '+' : ''}
        {dev.toFixed(2)} SD
      </td>
      <td className="py-1.5 text-right">
        <Icon className={`ml-auto h-3.5 w-3.5 ${iconClass}`} aria-hidden />
      </td>
    </tr>
  )
}
