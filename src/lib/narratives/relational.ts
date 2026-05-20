/**
 * Narrative builders for relational results.
 *
 * Same voice rules as src/lib/narratives/descriptive.ts: precise stats in
 * headlines, plain-English bodies that tell a small business owner what
 * the relationship MEANS for their decisions.
 *
 * Two flavors of narratives live here:
 *   - Per-pair commentary on the top correlations (positive, negative,
 *     non-linear-hint). Used in the highlight strip at the top of the
 *     relational section.
 *   - Per-target regression commentary. One narrative bundle per
 *     RegressionAnalysis card.
 */

import type {
  CoefficientEstimate,
  RegressionAnalysis,
  TopCorrelation,
} from '@/types/stats'
import type { Narrative } from './descriptive'
import { formatNumber, formatPct } from './format'

// ---------- Thresholds ----------

/** Bands for descriptive language around correlation strength.
 *  PRACTICALLY_IDENTICAL gets a dedicated narrative variant because three
 *  separate "very strong" entries that are all r=1.00 read like a copy/paste
 *  mistake; the user wants to know "these are the same thing." */
const CORR_PRACTICALLY_IDENTICAL = 0.95
const CORR_VERY_STRONG = 0.85
const CORR_STRONG = 0.7
const CORR_MODERATE = 0.4
const CORR_WEAK = 0.2

/** Significance threshold for the "statistically reliable" language. */
const SIG_ALPHA = 0.05

/** R^2 bands for regression narratives. */
const R2_EXCELLENT = 0.7
const R2_GOOD = 0.5
const R2_MODEST = 0.2

// ---------- Correlation narratives ----------

/**
 * One narrative for a single TopCorrelation entry. Used in the highlight
 * strip beneath the heatmap. The headline carries the precise r and p,
 * the body translates into "what this means" prose.
 */
export function buildCorrelationNarrative(corr: TopCorrelation): Narrative {
  const r = Math.max(Math.abs(corr.pearson), Math.abs(corr.spearman))
  const direction = corr.pearson >= 0 ? 'together' : 'in opposite directions'
  const sigText =
    corr.pValue < 0.001
      ? 'statistically reliable (p < 0.001)'
      : corr.pValue < SIG_ALPHA
        ? `statistically reliable (p = ${corr.pValue.toFixed(3)})`
        : `not statistically reliable (p = ${corr.pValue.toFixed(3)})`

  if (corr.nonLinearHint) {
    return {
      headline: `${corr.columnA} ↔ ${corr.columnB} (r=${corr.pearson.toFixed(2)}, Spearman=${corr.spearman.toFixed(2)})`,
      body: `Strong rank correlation but weaker linear correlation. Suggests a non-linear pattern, things like diminishing returns, thresholds, or saturation rather than a straight line. Worth plotting these two against each other before trusting a linear model.`,
      severity: 'note',
    }
  }

  if (r >= CORR_PRACTICALLY_IDENTICAL) {
    return {
      headline: `${corr.columnA} ↔ ${corr.columnB} (r=${corr.pearson.toFixed(2)})`,
      body: `Practically identical. These two columns track each other almost perfectly, they likely represent the same underlying quantity scaled or counted differently. Tracking one will tell you what the other is doing, and you don't need to model them as separate inputs.`,
      severity: 'info',
    }
  }

  let strength: string
  if (r >= CORR_VERY_STRONG) strength = 'very strong'
  else if (r >= CORR_STRONG) strength = 'strong'
  else if (r >= CORR_MODERATE) strength = 'moderate'
  else if (r >= CORR_WEAK) strength = 'weak'
  else strength = 'very weak'

  return {
    headline: `${corr.columnA} ↔ ${corr.columnB} (r=${corr.pearson.toFixed(2)})`,
    body: `${strength.charAt(0).toUpperCase() + strength.slice(1)} relationship. The two columns move ${direction}, and it's ${sigText}.${
      r < CORR_WEAK
        ? ' Worth ignoring for predictive purposes.'
        : r >= CORR_STRONG
          ? ' This is the kind of relationship worth digging into further.'
          : ''
    }`,
    severity: r >= CORR_STRONG ? 'info' : 'note',
  }
}

// ---------- Regression narratives ----------

/**
 * Two-to-four narrative bullets for a single regression target. The
 * headline captures the headline R^2, follow-up bullets call out the most
 * influential predictors, weak relationships, and multicollinearity.
 */
export function buildRegressionNarratives(reg: RegressionAnalysis): Narrative[] {
  if (reg.skippedReason) {
    return [
      {
        headline: `Couldn't model ${reg.target}.`,
        body: reg.skippedReason,
        severity: 'warning',
      },
    ]
  }

  const out: Narrative[] = []

  out.push(buildRSquaredNarrative(reg))

  const topPredictor = reg.coefficients[0]
  if (topPredictor) {
    out.push(buildTopPredictorNarrative(reg.target, topPredictor))
  }

  // Mention the runner-up if it's also significant. Helps the user
  // understand which features deserve attention beyond the top one.
  const runnerUp = reg.coefficients[1]
  if (
    runnerUp &&
    runnerUp.isSignificant &&
    Math.abs(runnerUp.standardizedEstimate) > 0.15
  ) {
    out.push({
      headline: `Also notable: \`${runnerUp.feature}\`.`,
      body: `${describeCoefficientImpact(reg.target, runnerUp)}`,
      severity: 'info',
    })
  }

  if (reg.multicollinearFeatures.length > 0) {
    const featureList = reg.multicollinearFeatures.map((f) => `\`${f}\``).join(', ')
    out.push({
      headline: `Some predictors overlap a lot.`,
      body: `${featureList} ${reg.multicollinearFeatures.length === 1 ? 'is' : 'are'} highly correlated with the other features. The individual numbers for these can flip around if you change which features you include. Treat the headline R² as solid, but be careful drawing conclusions from any single overlapping predictor's coefficient.`,
      severity: 'warning',
    })
  }

  return out
}

function buildRSquaredNarrative(reg: RegressionAnalysis): Narrative {
  const pct = formatPct(reg.rSquared)
  const adjPct = formatPct(reg.adjustedRSquared)

  if (reg.rSquared >= R2_EXCELLENT) {
    return {
      headline: `${pct} of ${reg.target} variation is explained by the other columns (R²=${reg.rSquared.toFixed(2)}).`,
      body: `That's a strong fit. The columns in this table do a good job predicting ${reg.target}. Adjusted R² is ${adjPct}, similar enough that we're not just overfitting on too many features.`,
      severity: 'info',
    }
  }
  if (reg.rSquared >= R2_GOOD) {
    return {
      headline: `${pct} of ${reg.target} variation is explained (R²=${reg.rSquared.toFixed(2)}).`,
      body: `A solid fit. The other columns explain a meaningful chunk of why ${reg.target} varies, though there's still real unexplained variation. Adjusted R² ${adjPct}.`,
      severity: 'info',
    }
  }
  if (reg.rSquared >= R2_MODEST) {
    return {
      headline: `Modest fit (R²=${reg.rSquared.toFixed(2)}, ${pct} explained).`,
      body: `The other columns explain some of ${reg.target}, but most of the variation comes from factors not in this table. Useful as a directional signal, not a precise predictor.`,
      severity: 'note',
    }
  }

  return {
    headline: `Hard to predict from this table (R²=${reg.rSquared.toFixed(2)}).`,
    body: `${reg.target} doesn't follow a clear linear pattern with the other columns. Either the real drivers aren't here, or the relationships are non-linear. Don't trust this as a predictor; look for what's missing from the data.`,
    severity: 'warning',
  }
}

function buildTopPredictorNarrative(
  target: string,
  predictor: CoefficientEstimate,
): Narrative {
  const significance = predictor.isSignificant
    ? `statistically reliable (p ${formatPValue(predictor.pValue)})`
    : `not statistically reliable on its own (p ${formatPValue(predictor.pValue)})`

  // "Strongest association" instead of "top predictor" because linear
  // regression measures correlation, not causation. The headline framing
  // matters: clicks predicting impressions is a statistical artifact (clicks
  // come from impressions, not the other way around), and the prose should
  // not imply otherwise.
  return {
    headline: `Strongest association with ${target}: \`${predictor.feature}\`.`,
    body: `${describeCoefficientImpact(target, predictor)} The relationship is ${significance}.`,
    severity: predictor.isSignificant ? 'info' : 'note',
  }
}

/**
 * Plain-English description of one coefficient. Translates "for every
 * one-unit increase in feature, target changes by X" into business terms.
 */
function describeCoefficientImpact(
  target: string,
  coef: CoefficientEstimate,
): string {
  const moreOrLess = coef.estimate > 0 ? 'more' : 'less'
  const magnitude = formatNumber(Math.abs(coef.estimate))
  return `On average, each additional unit of \`${coef.feature}\` is associated with about ${magnitude} ${moreOrLess} ${target}, holding the other predictors constant.`
}

function formatPValue(p: number): string {
  if (p < 0.001) return '< 0.001'
  if (p < 0.01) return `= ${p.toFixed(3)}`
  return `= ${p.toFixed(2)}`
}
