/**
 * TimeSeriesChart: a line chart of historical values + forecast + 95%
 * prediction interval band.
 *
 * Three traces stacked into one plot:
 *
 *   1. Historical line (solid emerald). The actual observed values.
 *   2. Forecast line (dashed amber). Linear-trend projection forward.
 *   3. CI band (translucent amber fill between lower and upper). 95%
 *      prediction interval around the forecast.
 *
 * X-axis is real datetime, formatted humanely by Plotly. Y-axis is the
 * value column's native units. Hover shows the exact date and value.
 *
 * Why a single chart per (datetime, value) pair instead of small
 * multiples: each card already has its own chart context (header,
 * narrative, stat strip), and stacking trends per row scales linearly
 * with the number of value columns without compromising readability.
 */

import type { TimeSeriesAnalysis } from '@/types/stats'
import { DARK_LAYOUT, PLOTLY_CONFIG, PlotlyChart } from './PlotlyChart'

interface TimeSeriesChartProps {
  series: TimeSeriesAnalysis
}

export function TimeSeriesChart({ series }: TimeSeriesChartProps) {
  if (series.historicalDates.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded border border-slate-800 bg-slate-950/40 font-mono text-[10px] uppercase tracking-wider text-slate-600">
        no points to plot
      </div>
    )
  }

  // Trend line for the historical window: same slope/intercept as the fit,
  // evaluated at the first and last historical day. Two-point line that
  // visually anchors the forecast extrapolation.
  const firstHistoricalDate = series.historicalDates[0]
  const lastHistoricalDate =
    series.historicalDates[series.historicalDates.length - 1]
  const firstHistoricalValue =
    series.trendIntercept // value at day 0 from the intercept
  const daysSpan = daysBetweenIso(firstHistoricalDate, lastHistoricalDate)
  const lastHistoricalTrendValue =
    firstHistoricalValue + series.trendSlope * daysSpan

  // CI band: upper trace + lower trace with fill='tonexty' between them.
  // Plotly's "fill" needs the two traces declared in this order.
  const data = [
    // Historical observations.
    {
      type: 'scatter',
      mode: 'lines+markers',
      x: series.historicalDates,
      y: series.historicalValues,
      name: 'observed',
      line: { color: '#10b981', width: 2 },
      marker: { color: '#10b981', size: 4 },
      hovertemplate: '%{x|%b %d, %Y}<br>%{y:,.2f}<extra></extra>',
    },
    // Trend line through historical period.
    {
      type: 'scatter',
      mode: 'lines',
      x: [firstHistoricalDate, lastHistoricalDate],
      y: [firstHistoricalValue, lastHistoricalTrendValue],
      name: 'trend',
      line: { color: '#94a3b8', width: 1, dash: 'dot' },
      hoverinfo: 'skip',
    },
    // Upper CI bound. Invisible line; sets up the fill anchor.
    {
      type: 'scatter',
      mode: 'lines',
      x: series.forecastDates,
      y: series.forecastUpper95,
      name: 'upper 95%',
      line: { color: 'transparent' },
      showlegend: false,
      hoverinfo: 'skip',
    },
    // Lower CI bound. Fill = 'tonexty' fills the area between this trace
    // and the previous (upper) trace.
    {
      type: 'scatter',
      mode: 'lines',
      x: series.forecastDates,
      y: series.forecastLower95,
      name: '95% range',
      line: { color: 'transparent' },
      fill: 'tonexty',
      fillcolor: 'rgba(245, 158, 11, 0.18)',
      hoverinfo: 'skip',
    },
    // Forecast line (dashed amber).
    {
      type: 'scatter',
      mode: 'lines+markers',
      x: series.forecastDates,
      y: series.forecastValues,
      name: 'forecast',
      line: { color: '#f59e0b', width: 2, dash: 'dash' },
      marker: { color: '#f59e0b', size: 4, symbol: 'diamond' },
      hovertemplate: '%{x|%b %d, %Y}<br>forecast: %{y:,.2f}<extra></extra>',
    },
  ]

  const layout = {
    ...DARK_LAYOUT,
    height: 280,
    margin: { t: 24, b: 40, l: 60, r: 12 },
    xaxis: {
      ...DARK_LAYOUT.xaxis,
      type: 'date',
      automargin: true,
    },
    yaxis: {
      ...DARK_LAYOUT.yaxis,
      automargin: true,
    },
    showlegend: true,
    legend: {
      orientation: 'h',
      x: 0,
      xanchor: 'left',
      y: -0.18,
      yanchor: 'top',
      font: { color: '#cbd5e1', size: 10 },
      bgcolor: 'rgba(0,0,0,0)',
    },
  }

  return <PlotlyChart data={data} layout={layout} config={PLOTLY_CONFIG} height={300} />
}

/** Days between two ISO date strings; used for the trend-line anchor points. */
function daysBetweenIso(a: string, b: string): number {
  const aMs = new Date(a).getTime()
  const bMs = new Date(b).getTime()
  return (bMs - aMs) / (1000 * 60 * 60 * 24)
}
