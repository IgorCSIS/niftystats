/**
 * Narrative builders for descriptive results.
 *
 * Each builder takes a column summary and returns plain-English bullets
 * keyed off the actual statistics. The thresholds live as named constants
 * below so we can tune them in one place.
 *
 * Voice rules:
 *   - Headlines carry precise stats (skew, CV, Gini) so a technical reader
 *     can audit the claim. They're not condescending and they're not opaque,
 *     a stat with a sentence of context is fine.
 *   - Bodies translate the headline into "what this means for your business"
 *     in language a small business owner reads without effort. No ML jargon,
 *     no "classification models", no "Z-score thresholds". Action over theory.
 *   - When trade-offs exist (mean vs. median, fill vs. drop, etc.), name the
 *     concrete choice the reader should make rather than hedging.
 *
 * Severity guides UI tone:
 *   - info:    the dominant story, neutral or positive framing.
 *   - note:    a secondary observation, often a caveat.
 *   - warning: a data-quality flag the user should act on.
 */

import type {
  BooleanSummary,
  CategoricalSummary,
  ColumnSummary,
  DatetimeSummary,
  NumericSummary,
  UnknownSummary,
} from '@/types/stats'
import { formatCount, formatDate, formatNumber, formatPct } from './format'

export type NarrativeSeverity = 'info' | 'note' | 'warning'

export interface Narrative {
  headline: string
  body?: string
  severity: NarrativeSeverity
}

// ---------- Tunable thresholds ----------

const SKEW_NOTABLE = 0.5
const SKEW_HIGH = 1.5

const KURTOSIS_HEAVY_TAILS = 3.0

const CV_LOW = 0.1
const CV_HIGH = 1.0

const GINI_HIGH = 0.5

const NORMAL_LIKE_P = 0.05

const ENTROPY_CONCENTRATED = 0.4
const ENTROPY_BALANCED = 0.85

const MISSING_NOTABLE = 0.05
const MISSING_HIGH = 0.2

const BOOLEAN_IMBALANCED_DELTA = 0.3

// ---------- Dispatch ----------

export function buildNarrativesFor(summary: ColumnSummary): Narrative[] {
  switch (summary.kind) {
    case 'numeric':
      return buildNumericNarratives(summary)
    case 'categorical':
      return buildCategoricalNarratives(summary)
    case 'datetime':
      return buildDatetimeNarratives(summary)
    case 'boolean':
      return buildBooleanNarratives(summary)
    case 'unknown':
      return buildUnknownNarratives(summary)
  }
}

// ---------- Numeric ----------

function buildNumericNarratives(s: NumericSummary): Narrative[] {
  const out: Narrative[] = []

  out.push(centralTendencyNarrative(s))

  const variability = variabilityNarrative(s)
  if (variability) out.push(variability)

  const tail = tailNarrative(s)
  if (tail) out.push(tail)

  const inequality = inequalityNarrative(s)
  if (inequality) out.push(inequality)

  const quality = qualityNarrative(s)
  if (quality) out.push(quality)

  return out
}

function centralTendencyNarrative(s: NumericSummary): Narrative {
  const mean = formatNumber(s.mean)
  const median = formatNumber(s.median)

  if (s.std === 0 || (s.cv !== null && Math.abs(s.cv) < 1e-6)) {
    return {
      headline: `Every row has the same value (${mean}).`,
      body: `There's nothing to analyze here, every observation is identical. If that's a surprise, the column may have been filled in wrong; otherwise consider dropping it from the report.`,
      severity: 'warning',
    }
  }

  if (Math.abs(s.skew) >= SKEW_HIGH) {
    const direction = s.skew > 0 ? 'high' : 'low'
    return {
      headline: `Most rows sit around ${median}, with a long tail of ${direction} values.`,
      body: `The average (${mean}) is pulled ${s.mean > s.median ? 'up' : 'down'} by a small number of unusually ${direction} entries. For a fair "typical case" use the median (${median}), not the average. The average tells you about totals; the median tells you about a normal row.`,
      severity: 'info',
    }
  }

  if (Math.abs(s.skew) >= SKEW_NOTABLE) {
    const direction = s.skew > 0 ? 'higher' : 'lower'
    return {
      headline: `Average ${mean}, median ${median}.`,
      body: `Values lean ${direction} than a perfectly symmetric distribution would. The median (${median}) is usually the safer summary when describing a typical row.`,
      severity: 'info',
    }
  }

  if (s.normalityP !== null && s.normalityP >= NORMAL_LIKE_P) {
    return {
      headline: `Average ${mean}, median ${median}.`,
      body: `Values cluster fairly symmetrically around a typical case. The average and median agree closely, so either one is a reliable summary.`,
      severity: 'info',
    }
  }

  return {
    headline: `Average ${mean}, median ${median}.`,
    body: `Values range from ${formatNumber(s.min)} to ${formatNumber(s.max)}.`,
    severity: 'info',
  }
}

function variabilityNarrative(s: NumericSummary): Narrative | null {
  if (s.cv === null || !Number.isFinite(s.cv)) return null

  if (s.cv >= CV_HIGH) {
    return {
      headline: `Values vary widely (CV ${s.cv.toFixed(2)}).`,
      body: `The spread (${formatNumber(s.std)}) is about as big as the average (${formatNumber(s.mean)}). Expect rows to differ a lot from each other; any single "average" you quote will hide that variation.`,
      severity: 'note',
    }
  }

  if (s.cv < CV_LOW && s.std > 0) {
    return {
      headline: `Values stay close to the average (CV ${s.cv.toFixed(2)}).`,
      body: `Spread (${formatNumber(s.std)}) is small relative to the average (${formatNumber(s.mean)}). Rows look similar to each other, so the average is a good predictor of any single row.`,
      severity: 'note',
    }
  }

  return null
}

function tailNarrative(s: NumericSummary): Narrative | null {
  const robustOutliers = s.outlierRobustCount

  if (robustOutliers === 0 && s.kurtosisExcess < KURTOSIS_HEAVY_TAILS) {
    return null
  }

  if (robustOutliers > 0) {
    const headline =
      robustOutliers === 1
        ? '1 unusual value stands out.'
        : `${robustOutliers} unusual values stand out.`
    return {
      headline,
      body: `${robustOutliers === 1 ? 'One row sits' : 'These rows sit'} far above or below the rest. Worth opening ${robustOutliers === 1 ? 'it' : 'them'} to check, ${robustOutliers === 1 ? 'it' : 'each one'} could be a data-entry mistake, a real but rare case worth investigating, or noise you'd want to exclude before computing averages.`,
      severity: robustOutliers / s.count > 0.05 ? 'warning' : 'note',
    }
  }

  return {
    headline: `Extreme values show up more often than a typical bell curve would predict.`,
    body: `Plan for occasional surprises. Rules of thumb like "almost everything falls within two standard deviations" don't apply cleanly to data shaped like this.`,
    severity: 'note',
  }
}

function inequalityNarrative(s: NumericSummary): Narrative | null {
  if (s.gini < GINI_HIGH) return null

  const ratio = s.p99 / Math.max(s.median, 1e-9)
  return {
    headline: `A small group at the top drives most of the total.`,
    body: `Your largest values (top 1% sits at ${formatNumber(s.p99)}) are roughly ${formatNumber(ratio)}x the typical row (${formatNumber(s.median)}). Classic 80/20 pattern: focus there if you want to move the total, and don't be surprised when the average looks misleading.`,
    severity: 'info',
  }
}

function qualityNarrative(s: NumericSummary): Narrative | null {
  if (s.zerosCount > s.count * 0.5) {
    const pct = formatPct(s.zerosCount / s.count)
    return {
      headline: `Mostly zeros (${pct}).`,
      body: `Over half of the values are exactly zero. Worth confirming whether "0" means "really nothing happened" or "we didn't record this." They mean very different things when you do the math.`,
      severity: 'warning',
    }
  }

  if (s.missingPct >= MISSING_HIGH) {
    return {
      headline: `${formatPct(s.missingPct)} of rows are missing a value here.`,
      body: `Before you fill in averages, ask whether "no value" itself carries meaning (skipped, not applicable, opted out). If so, you'll lose that signal by imputing.`,
      severity: 'warning',
    }
  }

  if (s.missingPct >= MISSING_NOTABLE) {
    return {
      headline: `${formatPct(s.missingPct)} of rows are missing a value here.`,
      body: `${formatCount(s.missing)} out of ${formatCount(s.totalRows)} rows are blank. Small enough to ignore for most summaries, worth noting if you slice the data narrowly.`,
      severity: 'note',
    }
  }

  return null
}

// ---------- Categorical ----------

function buildCategoricalNarratives(s: CategoricalSummary): Narrative[] {
  const out: Narrative[] = []
  out.push(categoricalCardinalityNarrative(s))

  const diversity = categoricalDiversityNarrative(s)
  if (diversity) out.push(diversity)

  const missing = missingNarrative(s.missingPct, s.missing, s.totalRows)
  if (missing) out.push(missing)

  return out
}

function categoricalCardinalityNarrative(s: CategoricalSummary): Narrative {
  if (s.uniqueCount === s.count) {
    return {
      headline: `Looks like an ID column (${formatCount(s.uniqueCount)} unique values).`,
      body: `Every row has its own value. Probably an identifier like a customer ID or order number, not something to analyze on its own. Useful for matching this table to others, not for stats.`,
      severity: 'note',
    }
  }

  const top = s.topValues[0]
  if (!top) {
    return {
      headline: `${formatCount(s.uniqueCount)} unique values.`,
      severity: 'info',
    }
  }
  const topPct = formatPct(top.pct)

  if (s.uniqueCount <= 2) {
    return {
      headline: `Two-state column. \`${top.value}\` covers ${topPct} of rows.`,
      body: `Effectively a yes/no split. Same analytical shape as a boolean.`,
      severity: 'info',
    }
  }

  // Detect ties at the top. Two or three categories sharing the lead is
  // common in real data (50/50 plans, three-way splits) and reading
  // "X is most common, followed by Y" when X and Y are equal is misleading.
  // Use a tight numeric tolerance because percentages come from float math.
  const tiedTop = s.topValues.filter((v) => Math.abs(v.pct - top.pct) < 0.0005)
  if (tiedTop.length >= 2) {
    const names = tiedTop.map((v) => `\`${v.value}\``).join(tiedTop.length === 2 ? ' and ' : ', ')
    return {
      headline: `${formatCount(s.uniqueCount)} unique values; ${names} ${tiedTop.length === 2 ? 'are tied' : 'all tie'} at ${topPct}.`,
      body: `${tiedTop.length === 2 ? 'Two categories' : `${tiedTop.length} categories`} share the lead. Anything you compare across this column should account for the even split rather than treating one as dominant.`,
      severity: 'info',
    }
  }

  const runnerUp = s.topValues[1]
  return {
    headline: `${formatCount(s.uniqueCount)} unique values; \`${top.value}\` is most common at ${topPct}.`,
    body: runnerUp
      ? `Followed by \`${runnerUp.value}\` at ${formatPct(runnerUp.pct)}. The full breakdown sits in the "Top values" list below.`
      : `Worth knowing the top value before slicing the data by this column.`,
    severity: 'info',
  }
}

function categoricalDiversityNarrative(
  s: CategoricalSummary,
): Narrative | null {
  if (s.uniqueCount <= 2) return null

  if (s.entropyNormalized <= ENTROPY_CONCENTRATED) {
    return {
      headline: `A few values dominate (entropy ${s.entropyNormalized.toFixed(2)}).`,
      body: `Most rows fall into just a handful of categories. When you slice the data, the top buckets are where the action is, the long tail won't move the numbers much.`,
      severity: 'note',
    }
  }

  if (s.entropyNormalized >= ENTROPY_BALANCED) {
    return {
      headline: `Rows spread fairly evenly across categories (entropy ${s.entropyNormalized.toFixed(2)}).`,
      body: `No single category dominates. Cross-category comparisons here will give you meaningful differences rather than artifacts of an uneven mix.`,
      severity: 'info',
    }
  }

  return null
}

// ---------- Datetime ----------

function buildDatetimeNarratives(s: DatetimeSummary): Narrative[] {
  const out: Narrative[] = []

  out.push({
    headline: `Covers ${s.rangeDays} days, ${s.granularity} cadence.`,
    body: `Records run from ${formatDate(s.minDate)} to ${formatDate(s.maxDate)}.`,
    severity: 'info',
  })

  if (s.gapCount > 0) {
    out.push({
      headline: `${s.gapCount} gap${s.gapCount === 1 ? '' : 's'} in the timeline.`,
      body: `Some expected ${s.granularity} periods have no record. If you plot a trend here, decide up front how to handle the gaps: leave them empty, copy the previous value forward, or smooth between adjacent points. Each choice tells a slightly different story.`,
      severity: 'note',
    })
  }

  const missing = missingNarrative(s.missingPct, s.missing, s.totalRows)
  if (missing) out.push(missing)

  return out
}

// ---------- Boolean ----------

function buildBooleanNarratives(s: BooleanSummary): Narrative[] {
  const out: Narrative[] = []

  const truePct = formatPct(s.truePct)
  const falsePct = formatPct(1 - s.truePct)
  const delta = Math.abs(s.truePct - 0.5)

  if (delta >= BOOLEAN_IMBALANCED_DELTA) {
    const dominant = s.truePct > 0.5 ? 'true' : 'false'
    const dominantLabel = dominant === 'true' ? 'true' : 'false'
    const minorityLabel = dominant === 'true' ? 'false' : 'true'
    return [
      {
        headline: `Roughly ${formatPct(Math.max(s.truePct, 1 - s.truePct))} are ${dominantLabel}.`,
        body: `True ${truePct} (${formatCount(s.trueCount)} rows), false ${falsePct} (${formatCount(s.falseCount)} rows). The two outcomes aren't balanced. If you later build something that tries to predict ${minorityLabel} cases, the imbalance can make it look "right" just by guessing the common answer. Worth keeping in mind.`,
        severity: 'warning',
      },
      ...(missingNarrative(s.missingPct, s.missing, s.totalRows)
        ? [missingNarrative(s.missingPct, s.missing, s.totalRows)!]
        : []),
    ]
  }

  out.push({
    headline: `Roughly balanced (true ${truePct}, false ${falsePct}).`,
    body: `Both outcomes show up at similar rates. Comparing rows that are true to rows that are false will give you a fair picture rather than one dominated by class size.`,
    severity: 'info',
  })

  const missing = missingNarrative(s.missingPct, s.missing, s.totalRows)
  if (missing) out.push(missing)

  return out
}

// ---------- Unknown ----------

function buildUnknownNarratives(s: UnknownSummary): Narrative[] {
  return [
    {
      headline: 'Column not analyzed.',
      body: s.reason,
      severity: 'warning',
    },
  ]
}

// ---------- Shared helpers ----------

function missingNarrative(
  missingPct: number,
  missing: number,
  totalRows: number,
): Narrative | null {
  if (missingPct >= MISSING_HIGH) {
    return {
      headline: `${formatPct(missingPct)} of rows are missing a value here.`,
      body: `${formatCount(missing)} out of ${formatCount(totalRows)} rows are blank. Before filling in averages or defaults, ask whether "no value" is itself a signal (skipped, not applicable, opted out).`,
      severity: 'warning',
    }
  }
  if (missingPct >= MISSING_NOTABLE) {
    return {
      headline: `${formatPct(missingPct)} of rows are missing here.`,
      severity: 'note',
    }
  }
  return null
}
