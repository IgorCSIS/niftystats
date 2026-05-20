/**
 * Narrative builders for time-series results.
 *
 * Each TimeSeriesAnalysis becomes a small bundle of plain-English
 * bullets: trend direction + magnitude, forecast range, fit quality.
 *
 * Voice is the same as everywhere else: headline carries the precise
 * number (slope, R²), body translates into a business sentence.
 */

import type { TimeSeriesAnalysis } from '@/types/stats'
import type { Narrative } from './descriptive'
import { formatNumber } from './format'

/** R² bands for trend-quality language. */
const R2_TRUSTABLE = 0.5
const R2_WEAK = 0.15

/** Slope magnitude threshold (% of the average value) to call a trend "notable." */
const SLOPE_NOTABLE_PCT = 0.005 // 0.5% of the mean per period

export function buildTimeSeriesNarratives(series: TimeSeriesAnalysis): Narrative[] {
  const out: Narrative[] = []

  // Trend headline + direction.
  const trendNarrative = buildTrendNarrative(series)
  out.push(trendNarrative)

  // Forecast summary.
  const forecastNarrative = buildForecastNarrative(series)
  if (forecastNarrative) out.push(forecastNarrative)

  // Fit-quality caveat when R² is low.
  const qualityNarrative = buildFitQualityNarrative(series)
  if (qualityNarrative) out.push(qualityNarrative)

  return out
}

function buildTrendNarrative(series: TimeSeriesAnalysis): Narrative {
  const slopePerPeriod = series.trendSlope * series.medianGapDays
  const meanValue =
    series.historicalValues.reduce((a, b) => a + b, 0) /
    Math.max(series.historicalValues.length, 1)
  const slopePctOfMean = Math.abs(slopePerPeriod) / Math.max(Math.abs(meanValue), 1e-9)
  const direction = series.trendSlope > 0 ? 'up' : series.trendSlope < 0 ? 'down' : 'flat'
  const cadenceWord = cadenceToPeriodNoun(series.cadenceLabel)

  if (slopePctOfMean < SLOPE_NOTABLE_PCT) {
    return {
      headline: `${series.valueColumn} is roughly flat over time.`,
      body: `Across ${series.nObservations} ${cadenceWord} observations, the trend is too small to be meaningful (${formatNumber(slopePerPeriod)} per ${cadenceWord} on an average of ${formatNumber(meanValue)}). Treat this as a stable series rather than one with momentum in either direction.`,
      severity: 'info',
    }
  }

  if (direction === 'up') {
    return {
      headline: `${series.valueColumn} is trending up.`,
      body: `On average, ${series.valueColumn} gains about ${formatNumber(slopePerPeriod)} per ${cadenceWord}. Over the ${series.nObservations} ${cadenceWord} observations in this dataset, that adds up to a ${formatNumber(Math.abs(slopePerPeriod) * (series.nObservations - 1))} total change.`,
      severity: 'info',
    }
  }

  return {
    headline: `${series.valueColumn} is trending down.`,
    body: `On average, ${series.valueColumn} loses about ${formatNumber(Math.abs(slopePerPeriod))} per ${cadenceWord}. Worth understanding what's driving the decline before it compounds.`,
    severity: 'warning',
  }
}

function buildForecastNarrative(series: TimeSeriesAnalysis): Narrative | null {
  if (series.forecastValues.length === 0) return null
  const horizon = series.forecastValues.length
  const cadenceWord = cadenceToPeriodNoun(series.cadenceLabel)
  const finalValue = series.forecastValues[series.forecastValues.length - 1]
  const finalLower = series.forecastLower95[series.forecastLower95.length - 1]
  const finalUpper = series.forecastUpper95[series.forecastUpper95.length - 1]
  const intervalWidth = finalUpper - finalLower
  const meanValue =
    series.historicalValues.reduce((a, b) => a + b, 0) /
    Math.max(series.historicalValues.length, 1)
  const widePct = intervalWidth / Math.max(Math.abs(meanValue), 1e-9)

  const widthQualifier =
    widePct > 1.0
      ? 'a wide range, reflecting the noise in the historical data'
      : widePct > 0.4
        ? 'a moderate range'
        : 'a fairly tight range'

  return {
    headline: `Forecast: ${formatNumber(finalValue)} in ${horizon} ${cadenceWord}${horizon === 1 ? '' : 's'}.`,
    body: `Extending the linear trend forward, the model projects ${formatNumber(finalValue)} at the end of the horizon, with a 95% range of ${formatNumber(finalLower)} to ${formatNumber(finalUpper)} (${widthQualifier}). Use the point estimate for planning; use the range when accounting for uncertainty.`,
    severity: 'info',
  }
}

function buildFitQualityNarrative(series: TimeSeriesAnalysis): Narrative | null {
  if (series.trendRSquared >= R2_TRUSTABLE) {
    return null
  }
  const periodNoun = cadenceToPeriodNoun(series.cadenceLabel)
  if (series.trendRSquared >= R2_WEAK) {
    return {
      headline: `Noisy trend (R² ${series.trendRSquared.toFixed(2)}).`,
      body: `A linear trend captures only part of the variation, the rest is ${periodNoun}-to-${periodNoun} noise. The direction is informative; specific point values are not precise.`,
      severity: 'note',
    }
  }
  return {
    headline: `No clean linear trend (R² ${series.trendRSquared.toFixed(2)}).`,
    body: `The line we fit barely fits. The series either has no real direction or moves in a non-linear pattern that a straight line can't capture. Don't lean on the forecast values; treat this as essentially flat with high noise.`,
    severity: 'warning',
  }
}

function cadenceToPeriodNoun(
  cadence: TimeSeriesAnalysis['cadenceLabel'],
): string {
  switch (cadence) {
    case 'daily':
      return 'day'
    case 'weekly':
      return 'week'
    case 'monthly':
      return 'month'
    case 'quarterly':
      return 'quarter'
    case 'yearly':
      return 'year'
    default:
      return 'period'
  }
}
