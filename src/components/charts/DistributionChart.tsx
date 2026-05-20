/**
 * DistributionChart: histogram + central-tendency markers + outlier strip.
 *
 * Three layers stacked into one chart:
 *
 *   1. Histogram bars built from the pre-computed bin edges/counts (the
 *      Python engine ran np.histogram with Freedman-Diaconis so we don't
 *      ship raw rows). Bars are emerald, matching the brand accent.
 *
 *   2. Vertical reference lines at the mean (amber, dashed) and median
 *      (emerald, solid). Letting the user see the gap between these two
 *      is the fastest way to read distribution shape.
 *
 *   3. Outlier markers along a tiny strip below the bars, showing the
 *      actual flagged values (modified Z-score > 3.5) so the user can
 *      see how far from the bulk they sit.
 *
 * Hover tooltips show the bin range and count. Plotly handles all of this
 * for us with the right `data` shape.
 */

import type { NumericSummary } from '@/types/stats'
import { DARK_LAYOUT, PLOTLY_CONFIG, PlotlyChart } from './PlotlyChart'
import { formatNumber } from '@/lib/narratives/format'

interface DistributionChartProps {
  summary: NumericSummary
}

export function DistributionChart({ summary }: DistributionChartProps) {
  // Edge case: empty histogram. Could happen on a constant column or one
  // that lost everything to coercion. Render a tiny "no distribution"
  // notice so the card stays consistent in height.
  if (summary.histogramBins.length < 2 || summary.histogramCounts.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded border border-slate-800 bg-slate-950/40 font-mono text-[10px] uppercase tracking-wider text-slate-600">
        no distribution to plot
      </div>
    )
  }

  // Build the bar geometry. Plotly's `bar` type with explicit bin centers
  // gives us histogram-shaped output without the auto-binning that the
  // `histogram` type would re-apply over our pre-binned counts.
  const binCenters = summary.histogramBins.slice(0, -1).map((edge, i) => {
    const next = summary.histogramBins[i + 1]
    return (edge + next) / 2
  })
  const binWidths = summary.histogramBins.slice(0, -1).map((edge, i) => {
    return summary.histogramBins[i + 1] - edge
  })

  // Hover text per bar: human-readable bin range + count.
  const hoverText = summary.histogramBins.slice(0, -1).map((edge, i) => {
    const next = summary.histogramBins[i + 1]
    const count = summary.histogramCounts[i]
    return `${formatNumber(edge)} to ${formatNumber(next)}<br>${count} value${count === 1 ? '' : 's'}`
  })

  const data: Array<Record<string, unknown>> = [
    {
      type: 'bar',
      x: binCenters,
      y: summary.histogramCounts,
      width: binWidths,
      marker: {
        color: '#10b981', // emerald-500
        line: { color: '#020617', width: 1 },
      },
      hovertext: hoverText,
      hoverinfo: 'text',
      name: 'frequency',
    },
  ]

  // Outlier strip beneath the histogram. We render it on a secondary y-axis
  // (y2) so its points sit visually under the bars without rescaling the
  // primary axis. Tiny circles, amber, with hover text showing the value.
  if (summary.outlierValues.length > 0) {
    data.push({
      type: 'scatter',
      mode: 'markers',
      x: summary.outlierValues,
      // Use zero on the second y-axis so all dots sit on the same baseline.
      y: summary.outlierValues.map(() => 0),
      yaxis: 'y2',
      marker: {
        color: '#f59e0b', // amber-500
        size: 6,
        line: { color: '#020617', width: 1 },
        opacity: 0.85,
      },
      hovertext: summary.outlierValues.map((v) => `outlier: ${formatNumber(v)}`),
      hoverinfo: 'text',
      name: 'outliers',
    })
  }

  // Reference lines for mean (amber dashed) and median (emerald solid).
  // Plotly's `shapes` accept `yref: 'paper'` which spans the full chart
  // height regardless of data scale.
  const shapes: Array<Record<string, unknown>> = []
  if (Number.isFinite(summary.mean)) {
    shapes.push({
      type: 'line',
      x0: summary.mean,
      x1: summary.mean,
      y0: 0,
      y1: 1,
      yref: 'paper',
      line: { color: '#f59e0b', width: 1.5, dash: 'dash' },
    })
  }
  if (Number.isFinite(summary.median)) {
    shapes.push({
      type: 'line',
      x0: summary.median,
      x1: summary.median,
      y0: 0,
      y1: 1,
      yref: 'paper',
      line: { color: '#34d399', width: 1.5 },
    })
  }

  const layout = {
    ...DARK_LAYOUT,
    height: 200,
    margin: { t: 30, b: 30, l: 40, r: 10 },
    bargap: 0.05,
    xaxis: { ...DARK_LAYOUT.xaxis, title: '' },
    yaxis: {
      ...DARK_LAYOUT.yaxis,
      title: '',
      // Hide the y-axis tick labels: the user cares about shape, not exact
      // bin counts (those show up on hover).
      showticklabels: false,
    },
    // Secondary axis just hosts the outlier strip; we hide it visually.
    yaxis2: {
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      showticklabels: false,
      zeroline: false,
      range: [-1, 1],
    },
    shapes,
    annotations: buildLegendAnnotations(summary),
  }

  return <PlotlyChart data={data} layout={layout} config={PLOTLY_CONFIG} height={200} />
}

/**
 * Inline legend explaining the reference lines. Three small labels in the
 * top-right corner. Plotly's built-in legend is bigger than we want for
 * the in-card chart size, so we hand-place lightweight annotations.
 */
function buildLegendAnnotations(summary: NumericSummary): Array<Record<string, unknown>> {
  const annotations: Array<Record<string, unknown>> = []

  annotations.push({
    text: `<span style="color:#34d399;">━</span> median ${formatNumber(summary.median)}`,
    showarrow: false,
    xref: 'paper',
    yref: 'paper',
    x: 1,
    y: 1.08,
    xanchor: 'right',
    yanchor: 'bottom',
    font: { size: 10, family: 'JetBrains Mono, monospace', color: '#94a3b8' },
  })

  annotations.push({
    text: `<span style="color:#f59e0b;">┄</span> mean ${formatNumber(summary.mean)}`,
    showarrow: false,
    xref: 'paper',
    yref: 'paper',
    x: 0.5,
    y: 1.08,
    xanchor: 'right',
    yanchor: 'bottom',
    font: { size: 10, family: 'JetBrains Mono, monospace', color: '#94a3b8' },
  })

  if (summary.outlierValues.length > 0) {
    annotations.push({
      text: `<span style="color:#f59e0b;">●</span> ${summary.outlierValues.length} outlier${summary.outlierValues.length === 1 ? '' : 's'}`,
      showarrow: false,
      xref: 'paper',
      yref: 'paper',
      x: 0.1,
      y: 1.08,
      xanchor: 'right',
      yanchor: 'bottom',
      font: { size: 10, family: 'JetBrains Mono, monospace', color: '#94a3b8' },
    })
  }

  return annotations
}
