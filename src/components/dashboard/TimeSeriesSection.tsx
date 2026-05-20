/**
 * TimeSeriesSection: the over-time layer of the dashboard.
 *
 * Renders one card per analyzable (datetime, numeric) pair. Each card has
 * a header strip (target column + cadence + R² badge), the
 * historical+forecast Plotly chart, a small stat strip (slope, R²,
 * forecast point, CI width), and the narrative bullets explaining trend
 * direction, forecast range, and fit quality.
 *
 * Mirrors the layout pattern of RegressionCard so the dashboard reads as
 * a unified surface across analytical layers.
 */

import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus, Activity, AlertCircle } from 'lucide-react'
import type { TimeSeriesAnalysis, TimeSeriesResult } from '@/types/stats'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { NarrativeList } from './NarrativeList'
import { StatGrid } from './StatGrid'
import { buildTimeSeriesNarratives } from '@/lib/narratives/timeseries'
import { formatNumber } from '@/lib/narratives/format'

interface TimeSeriesSectionProps {
  result: TimeSeriesResult
}

export function TimeSeriesSection({ result }: TimeSeriesSectionProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
      className="mt-12"
      aria-labelledby="timeseries-heading"
    >
      <header
        className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end"
        data-pdf-block="true"
      >
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent-bright)]">
            <Activity className="h-3 w-3" aria-hidden />
            Over time
          </div>
          <h2
            id="timeseries-heading"
            className="mt-1 text-2xl font-semibold tracking-tight text-slate-50"
          >
            What's the trend.
          </h2>
        </div>
        {result.skippedReason ? null : (
          <div className="font-mono text-xs text-slate-500">
            {result.serieses.length} series · computed in {result.computeMs}ms
          </div>
        )}
      </header>

      {result.skippedReason ? (
        <SkippedCard reason={result.skippedReason} />
      ) : (
        <div className="space-y-4">
          {result.serieses.map((series, i) => (
            <div
              key={`${series.datetimeColumn}-${series.valueColumn}-${i}`}
              data-pdf-block="true"
            >
              <SeriesCard series={series} />
            </div>
          ))}
        </div>
      )}
    </motion.section>
  )
}

function SkippedCard({ reason }: { reason: string }) {
  return (
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
            Time-series analysis wasn't run for this dataset.
          </div>
          <div className="mt-1 text-xs text-slate-400">{reason}</div>
        </div>
      </div>
    </div>
  )
}

function SeriesCard({ series }: { series: TimeSeriesAnalysis }) {
  const narratives = buildTimeSeriesNarratives(series)
  const slopePerPeriod = series.trendSlope * series.medianGapDays
  const TrendIcon =
    slopePerPeriod > 0 ? TrendingUp : slopePerPeriod < 0 ? TrendingDown : Minus
  const trendColor =
    slopePerPeriod > 0
      ? 'text-emerald-300'
      : slopePerPeriod < 0
        ? 'text-fuchsia-300'
        : 'text-slate-400'

  const lastForecast = series.forecastValues[series.forecastValues.length - 1]
  const lastForecastLower =
    series.forecastLower95[series.forecastLower95.length - 1]
  const lastForecastUpper =
    series.forecastUpper95[series.forecastUpper95.length - 1]

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded border border-sky-900/60 bg-sky-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-sky-300">
            <Activity className="h-3 w-3" aria-hidden />
            tracking
          </span>
          <span className="truncate font-mono text-sm font-medium text-slate-100">
            {series.valueColumn}
          </span>
          <span className="hidden flex-shrink-0 font-mono text-[10px] text-slate-500 sm:inline">
            over {series.datetimeColumn} · {series.cadenceLabel}
          </span>
        </div>
        <div
          className={`flex flex-shrink-0 items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-xs ${trendColor}`}
        >
          <TrendIcon className="h-3 w-3" aria-hidden />
          R² {series.trendRSquared.toFixed(2)}
        </div>
      </header>

      <div className="px-5 py-4">
        <StatGrid
          items={[
            {
              label: 'slope',
              value: formatNumber(slopePerPeriod),
              detail: `per ${series.cadenceLabel === 'irregular' ? 'period' : series.cadenceLabel.replace(/ly$/, '')}`,
            },
            { label: 'R²', value: series.trendRSquared.toFixed(2) },
            {
              label: 'forecast end',
              value: formatNumber(lastForecast),
              detail: `${series.forecastValues.length} ahead`,
            },
            {
              label: '95% range',
              value: `${formatNumber(lastForecastLower)} – ${formatNumber(lastForecastUpper)}`,
            },
          ]}
        />
      </div>

      <div className="border-t border-slate-800 px-5 py-4">
        <TimeSeriesChart series={series} />
      </div>

      <div className="border-t border-slate-800 px-5 pb-5 pt-4">
        <NarrativeList narratives={narratives} />
      </div>
    </section>
  )
}
