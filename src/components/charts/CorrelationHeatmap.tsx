/**
 * CorrelationHeatmap: a Plotly heatmap of the Pearson correlation matrix.
 *
 * Color encoding: diverging scale centered at 0. Strong positive = emerald,
 * strong negative = a magenta-purple, zero or near-zero = dark slate.
 * Diverging palette is the right choice because the user cares equally
 * about positive and negative relationships and zero is the neutral
 * reference.
 *
 * Hover detail shows r and p so the user can see both magnitude and
 * statistical significance at a glance.
 *
 * Why Pearson by default (not Spearman): linear correlation is more
 * familiar to non-statistical readers. We surface the Pearson/Spearman gap
 * separately in the "non-linear hints" narrative strip when it matters.
 */

import type { CorrelationMatrix } from '@/types/stats'
import { DARK_LAYOUT, PLOTLY_CONFIG, PlotlyChart } from './PlotlyChart'

interface CorrelationHeatmapProps {
  matrix: CorrelationMatrix
}

export function CorrelationHeatmap({ matrix }: CorrelationHeatmapProps) {
  if (matrix.columns.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded border border-slate-800 bg-slate-950/40 font-mono text-[10px] uppercase tracking-wider text-slate-600">
        need at least two numeric columns to compute correlations
      </div>
    )
  }

  // Plotly expects a 2D z array. Values are -1..1; nulls become NaN which
  // Plotly draws as a transparent gap.
  const z = matrix.values.map((row) => row.map((v) => (v === null ? NaN : v)))
  // Hover text per cell: column names + r + p.
  const text = matrix.values.map((row, i) =>
    row.map((v, j) => {
      const colA = matrix.columns[i]
      const colB = matrix.columns[j]
      const p = matrix.pValues[i][j]
      if (v === null) return `${colA} × ${colB}<br>insufficient data`
      const rStr = v.toFixed(3)
      const pStr = p === null ? 'n/a' : p < 0.001 ? '< 0.001' : p.toFixed(3)
      return `${colA} × ${colB}<br>r = ${rStr}<br>p = ${pStr}`
    }),
  )

  // Diverging color scale, centered at 0. Plotly's `RdBu_r` is the
  // standard choice but doesn't match our palette. Hand-rolling a slate→
  // emerald (positive) and slate→fuchsia (negative) scale that fits the
  // dark theme without losing the "red = bad" → "green = good" intuition
  // (positive is emerald, the brand "good signal" color; negative is a
  // muted magenta so it reads as "opposite direction" not as alarming).
  const colorscale = [
    [0.0, '#a21caf'], // negative max: fuchsia-700
    [0.25, '#581c87'], // violet-900
    [0.5, '#020617'], // slate-950, the "near zero" middle
    [0.75, '#065f46'], // emerald-800
    [1.0, '#10b981'], // emerald-500, positive max
  ]

  const data = [
    {
      type: 'heatmap',
      z,
      x: matrix.columns,
      y: matrix.columns,
      text,
      hoverinfo: 'text',
      colorscale,
      zmin: -1,
      zmax: 1,
      // Show a colorbar so users can read the scale without hovering on
      // every cell.
      colorbar: {
        tickfont: { color: '#94a3b8', size: 10 },
        outlinewidth: 0,
        thickness: 12,
        len: 0.7,
        title: { text: 'r', font: { color: '#94a3b8', size: 10 } },
      },
      xgap: 1,
      ygap: 1,
    },
  ]

  // Height scales with the number of columns so labels remain readable.
  // Cap at 600 for very wide CSVs.
  const cellSize = 28
  const height = Math.min(140 + matrix.columns.length * cellSize, 700)

  const layout = {
    ...DARK_LAYOUT,
    height,
    margin: { t: 24, b: 60, l: 120, r: 60 },
    xaxis: {
      ...DARK_LAYOUT.xaxis,
      tickangle: -35,
      automargin: true,
      tickfont: {
        ...DARK_LAYOUT.xaxis.tickfont,
        family: 'JetBrains Mono, monospace',
      },
    },
    yaxis: {
      ...DARK_LAYOUT.yaxis,
      automargin: true,
      autorange: 'reversed',
      tickfont: {
        ...DARK_LAYOUT.yaxis.tickfont,
        family: 'JetBrains Mono, monospace',
      },
    },
  }

  // Wrap in overflow-x-auto so very wide matrices (15+ columns) can scroll
  // horizontally on mobile rather than shrinking cells past readability.
  // For typical 3-8 column matrices this is a no-op visually.
  return (
    <div className="-mx-2 overflow-x-auto">
      <div style={{ minWidth: Math.max(matrix.columns.length * 60, 320) }}>
        <PlotlyChart data={data} layout={layout} config={PLOTLY_CONFIG} height={height} />
      </div>
    </div>
  )
}
