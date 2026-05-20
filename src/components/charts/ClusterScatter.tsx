/**
 * ClusterScatter: a Plotly scatter showing the PCA-projected clustering
 * result, one color per cluster.
 *
 * The scatter is the visual headline of the clustering section. Each
 * point is one row from the source CSV, positioned by its first two
 * principal-component coordinates and colored by the cluster k-means
 * assigned it to.
 *
 * The PCA projection is an abstract space (PC1, PC2 aren't real units),
 * so we annotate the chart with the variance-explained percentages so a
 * curious reader can see how much information the 2D view captures.
 * High variance explained (60%+) means the scatter is a faithful picture;
 * low (under 30%) means the real clusters separate along dimensions
 * you can't see in this view.
 */

import type { ClusteringResult } from '@/types/stats'
import { DARK_LAYOUT, PLOTLY_CONFIG, PlotlyChart } from './PlotlyChart'

interface ClusterScatterProps {
  result: ClusteringResult
}

/**
 * Plotly's "Set2" palette is too pastel for our dark theme. Hand-picking
 * a set that reads well against slate-950: emerald (brand), violet, sky,
 * amber, fuchsia, lime, orange, cyan. Eight colors covers our K_MAX = 8.
 */
const CLUSTER_COLORS = [
  '#10b981', // emerald-500
  '#a855f7', // purple-500
  '#0ea5e9', // sky-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
  '#f97316', // orange-500
  '#06b6d4', // cyan-500
]

export function ClusterScatter({ result }: ClusterScatterProps) {
  if (result.projection.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded border border-slate-800 bg-slate-950/40 font-mono text-[10px] uppercase tracking-wider text-slate-600">
        no points to plot
      </div>
    )
  }

  // Group points by cluster so each gets its own trace (and its own
  // color + legend entry).
  const traces = result.clusters.map((cluster, i) => {
    const points = result.projection.filter((p) => p.cluster === cluster.id)
    const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length]
    return {
      type: 'scatter',
      mode: 'markers',
      name: `${cluster.label} (${points.length})`,
      x: points.map((p) => p.x),
      y: points.map((p) => p.y),
      marker: {
        color,
        size: 6,
        line: { color: '#020617', width: 0.5 },
        opacity: 0.85,
      },
      hoverinfo: 'name',
    }
  })

  // Variance-explained annotation in the corner so users know how much
  // of the data structure this 2D view captures.
  const variancePct = (
    result.pcaVarianceExplained[0] + result.pcaVarianceExplained[1]
  ) * 100
  const varianceAnnotation = {
    text: `<span style="color:#94a3b8;">${variancePct.toFixed(0)}% of variation captured in this view</span>`,
    showarrow: false,
    xref: 'paper',
    yref: 'paper',
    x: 0.5,
    y: 1.06,
    xanchor: 'center',
    yanchor: 'bottom',
    font: { size: 10, family: 'JetBrains Mono, monospace', color: '#94a3b8' },
  }

  const layout = {
    ...DARK_LAYOUT,
    height: 360,
    margin: { t: 36, b: 40, l: 50, r: 10 },
    xaxis: {
      ...DARK_LAYOUT.xaxis,
      title: {
        text: `PC1 (${(result.pcaVarianceExplained[0] * 100).toFixed(0)}%)`,
        font: { size: 10, color: '#64748b' },
      },
      showticklabels: false,
    },
    yaxis: {
      ...DARK_LAYOUT.yaxis,
      title: {
        text: `PC2 (${(result.pcaVarianceExplained[1] * 100).toFixed(0)}%)`,
        font: { size: 10, color: '#64748b' },
      },
      showticklabels: false,
    },
    showlegend: true,
    legend: {
      orientation: 'h',
      x: 0,
      xanchor: 'left',
      y: -0.12,
      yanchor: 'top',
      font: { color: '#cbd5e1', size: 11 },
      bgcolor: 'rgba(0,0,0,0)',
    },
    annotations: [varianceAnnotation],
  }

  return <PlotlyChart data={traces} layout={layout} config={PLOTLY_CONFIG} height={360} />
}
