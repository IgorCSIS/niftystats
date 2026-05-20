/**
 * MissingValuesChart, the data-quality glance at the top of the dashboard.
 *
 * Renders a horizontal bar chart with one bar per column that has any
 * missing values, sorted by missing percentage descending. If no column
 * has missing values, the parent should skip rendering this entirely.
 *
 * Why horizontal: column names can be long (`customer_acquisition_cost`)
 * and a horizontal layout lets us show the label without ellipsis on
 * any reasonable screen.
 *
 * Why amber: we use emerald for "data" (the signal) and amber for "data
 * quality flags" (the noise) across the app. Consistent encoding helps the
 * user scan a dashboard and immediately know where to look.
 */

import type { ColumnSummary } from '@/types/stats'
import { DARK_LAYOUT, PLOTLY_CONFIG, PlotlyChart } from './PlotlyChart'

interface MissingValuesChartProps {
  columns: ColumnSummary[]
}

export function MissingValuesChart({ columns }: MissingValuesChartProps) {
  const withMissing = columns
    .filter((c) => c.missing > 0)
    // Sort descending so the worst offenders sit at the top of the chart.
    .sort((a, b) => b.missingPct - a.missingPct)

  if (withMissing.length === 0) return null

  // Plotly's horizontal bar chart reads the categorical y-axis from the
  // bottom up by default. Reversing here lets the largest bar render at
  // the top of the chart, which matches how the eye scans a sorted list.
  const sortedForRender = [...withMissing].reverse()

  const data = [
    {
      type: 'bar',
      orientation: 'h',
      x: sortedForRender.map((c) => c.missingPct * 100),
      y: sortedForRender.map((c) => c.name),
      marker: {
        color: '#f59e0b', // amber-500, signals data-quality issue not data
        line: { color: '#020617', width: 1 },
      },
      hovertext: sortedForRender.map(
        (c) =>
          `${c.name}<br>${c.missing.toLocaleString()} of ${c.totalRows.toLocaleString()} missing (${(c.missingPct * 100).toFixed(1)}%)`,
      ),
      hoverinfo: 'text',
    },
  ]

  // Dynamic height: 28px per row plus padding. Caps so very wide datasets
  // (50+ columns with missingness) don't stretch the chart off-screen.
  const height = Math.min(60 + sortedForRender.length * 28, 600)

  const layout = {
    ...DARK_LAYOUT,
    height,
    margin: { t: 24, b: 28, l: 140, r: 24 },
    xaxis: {
      ...DARK_LAYOUT.xaxis,
      ticksuffix: '%',
      range: [0, 100],
    },
    yaxis: {
      ...DARK_LAYOUT.yaxis,
      tickfont: {
        ...DARK_LAYOUT.yaxis.tickfont,
        family: 'JetBrains Mono, monospace',
      },
      // Hide the gridlines on the categorical axis, they don't add info.
      showgrid: false,
    },
  }

  return <PlotlyChart data={data} layout={layout} config={PLOTLY_CONFIG} height={height} />
}
