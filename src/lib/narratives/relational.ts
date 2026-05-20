/**
 * Narrative builders for relational results.
 *
 * Same voice rules as src/lib/narratives/descriptive.ts: precise stats in
 * headlines, plain-English bodies that tell a small business owner what
 * the relationship MEANS for their decisions.
 *
 * Three flavors live here:
 *   - Per-pair commentary on top correlations.
 *   - Per-target LINEAR regression commentary.
 *   - Per-target LOGISTIC regression commentary (boolean targets, with
 *     odds-ratio framing).
 */

import type {
  CoefficientEstimate,
  LinearRegressionAnalysis,
  LogisticCoefficient,
  LogisticRegressionAnalysis,
  TopCorrelation,
} from '@/types/stats'
import type { Narrative } from './descriptive'
import { formatNumber, formatPct } from './format'

// ---------- Thresholds ----------

const CORR_PRACTICALLY_IDENTICAL = 0.95
const CORR_VERY_STRONG = 0.85
const CORR_STRONG = 0.7
const CORR_MODERATE = 0.4
const CORR_WEAK = 0.2

const SIG_ALPHA = 0.05

const R2_EXCELLENT = 0.7
const R2_GOOD = 0.5
const R2_MODEST = 0.2

// AUC bands for logistic regression. 0.5 is chance; 0.7+ is useful;
// 0.85+ is genuinely strong predictive power.
const AUC_STRONG = 0.85
const AUC_DECENT = 0.7
const AUC_WEAK = 0.6

// Odds-ratio magnitude bands for "noticeable" feature impact narratives.
// An OR of 1.5 means each unit multiplies odds by 1.5x; 2.0 doubles them.
const OR_NOTABLE = 1.3
const OR_STRONG = 2.0

// Sample-size thresholds for the "treat as exploratory" warning. Logistic
// regression converges with as few as 20 rows but the p-values, AUC, and
// odds ratios are noisy at that scale. We fire the warning so a user
// running on a sample-sized demo dataset doesn't over-interpret the result.
const SMALL_SAMPLE_N = 50
const SMALL_MINORITY = 15

// ---------- Correlation narratives ----------

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

// ---------- Linear regression narratives ----------

export function buildLinearRegressionNarratives(
  reg: LinearRegressionAnalysis,
): Narrative[] {
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
  out.push(buildLinearR2Narrative(reg))

  const topPredictor = reg.coefficients[0]
  if (topPredictor) {
    out.push(buildLinearTopPredictorNarrative(reg.target, topPredictor))
  }

  const runnerUp = reg.coefficients[1]
  if (
    runnerUp &&
    runnerUp.isSignificant &&
    Math.abs(runnerUp.standardizedEstimate) > 0.15
  ) {
    out.push({
      headline: `Also notable: \`${runnerUp.feature}\`.`,
      body: describeLinearCoefImpact(reg.target, runnerUp),
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

function buildLinearR2Narrative(reg: LinearRegressionAnalysis): Narrative {
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

function buildLinearTopPredictorNarrative(
  target: string,
  predictor: CoefficientEstimate,
): Narrative {
  const significance = predictor.isSignificant
    ? `statistically reliable (p ${formatPValue(predictor.pValue)})`
    : `not statistically reliable on its own (p ${formatPValue(predictor.pValue)})`

  return {
    headline: `Strongest association with ${target}: \`${predictor.feature}\`.`,
    body: `${describeLinearCoefImpact(target, predictor)} The relationship is ${significance}.`,
    severity: predictor.isSignificant ? 'info' : 'note',
  }
}

function describeLinearCoefImpact(
  target: string,
  coef: CoefficientEstimate,
): string {
  const moreOrLess = coef.estimate > 0 ? 'more' : 'less'
  const magnitude = formatNumber(Math.abs(coef.estimate))
  return `On average, each additional unit of \`${coef.feature}\` is associated with about ${magnitude} ${moreOrLess} ${target}, holding the other predictors constant.`
}

// ---------- Logistic regression narratives ----------

export function buildLogisticRegressionNarratives(
  reg: LogisticRegressionAnalysis,
): Narrative[] {
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
  out.push(buildAucNarrative(reg))

  const topPredictor = reg.coefficients[0]
  if (topPredictor) {
    out.push(buildLogisticTopPredictorNarrative(reg.target, topPredictor))
  }

  // Runner-up if also significant and large enough magnitude.
  const runnerUp = reg.coefficients[1]
  if (
    runnerUp &&
    runnerUp.isSignificant &&
    Math.abs(runnerUp.standardizedEstimate) > 0.15
  ) {
    out.push({
      headline: `Also notable: \`${runnerUp.feature}\`.`,
      body: describeLogisticCoefImpact(reg.target, runnerUp),
      severity: 'info',
    })
  }

  // Class-imbalance note when one outcome is very rare.
  const truePct = reg.nObservations ? reg.trueCount / reg.nObservations : 0
  if (truePct <= 0.2 || truePct >= 0.8) {
    const minority = truePct < 0.5 ? 'true' : 'false'
    const minorityPct = formatPct(truePct < 0.5 ? truePct : 1 - truePct)
    out.push({
      headline: `Imbalanced outcome.`,
      body: `Only ${minorityPct} of rows are "${minority}". Accuracy alone is misleading on data like this, the model could be ${formatPct(1 - (truePct < 0.5 ? truePct : 1 - truePct))} accurate just by always predicting the common answer. AUC and the predictor table tell the real story.`,
      severity: 'warning',
    })
  }

  // Small-sample warning. Logistic on 20-30 rows is technically valid but
  // p-values and AUC bounce around with each added observation. Surfacing
  // this protects users from over-confident takeaways on tiny demo data.
  const minorityCount = Math.min(reg.trueCount, reg.falseCount)
  if (reg.nObservations < SMALL_SAMPLE_N || minorityCount < SMALL_MINORITY) {
    out.push({
      headline: `Small sample, treat as exploratory.`,
      body: `Only ${reg.nObservations} rows with ${minorityCount} cases of the smaller class. Results are directionally interesting but the specific p-values and odds ratios can move noticeably if you add or remove a few rows. Validate the headline finding on more data before acting on it.`,
      severity: 'note',
    })
  }

  return out
}

function buildAucNarrative(reg: LogisticRegressionAnalysis): Narrative {
  const auc = reg.auc
  const aucText = auc.toFixed(2)

  // Complete-separation check. When AUC is essentially perfect AND either
  // the sample is small or no individual coefficient is statistically
  // reliable, the model has memorized the training data rather than found
  // a generalizable pattern. Logistic regression coefficients blow up to
  // infinity under perfect separation, which is what produces the huge
  // standard errors that wipe out p-values.
  const minorityCount = Math.min(reg.trueCount, reg.falseCount)
  const allPValuesUnreliable = reg.coefficients.every((c) => c.pValue > 0.5)
  if (auc >= 0.98 && (reg.nObservations < 50 || allPValuesUnreliable || minorityCount < 10)) {
    return {
      headline: `Suspiciously perfect fit (AUC ${aucText}).`,
      body: `An AUC this high on ${reg.nObservations} rows with ${minorityCount} cases of the smaller class usually means the model has memorized the training data, not found a real pattern. The huge standard errors (every coefficient shows p above 0.5) are the tell: with this little data and this few minority cases, the math allows perfect separation but the result won't hold up on new rows. Treat the predictor table as a directional hint about which columns matter, nothing more.`,
      severity: 'warning',
    }
  }

  if (auc >= AUC_STRONG) {
    return {
      headline: `Strong predictive signal for ${reg.target} (AUC ${aucText}).`,
      body: `The model correctly ranks a "true" row above a "false" row about ${formatPct(auc)} of the time when given a random pair. That's genuinely useful prediction power.`,
      severity: 'info',
    }
  }
  if (auc >= AUC_DECENT) {
    return {
      headline: `Decent predictive signal (AUC ${aucText}).`,
      body: `The model can distinguish "true" from "false" better than guessing. Directionally useful, not precise enough for high-stakes individual predictions.`,
      severity: 'info',
    }
  }
  if (auc >= AUC_WEAK) {
    return {
      headline: `Weak predictive signal (AUC ${aucText}).`,
      body: `The model barely beats guessing the majority class. The features in this table don't carry strong information about whether ${reg.target} is true or false. Either the real drivers are elsewhere or the relationship isn't linear.`,
      severity: 'note',
    }
  }

  return {
    headline: `No useful prediction (AUC ${aucText}).`,
    body: `The model performs no better than chance. ${reg.target} can't be predicted from these features. Worth investigating what features WOULD predict it.`,
    severity: 'warning',
  }
}

function buildLogisticTopPredictorNarrative(
  target: string,
  predictor: LogisticCoefficient,
): Narrative {
  const significance = predictor.isSignificant
    ? `statistically reliable (p ${formatPValue(predictor.pValue)})`
    : `not statistically reliable on its own (p ${formatPValue(predictor.pValue)})`

  return {
    headline: `Strongest association with ${target}: \`${predictor.feature}\`.`,
    body: `${describeLogisticCoefImpact(target, predictor)} The relationship is ${significance}.`,
    severity: predictor.isSignificant ? 'info' : 'note',
  }
}

/**
 * Translate an odds ratio into business-friendly "X times more/less likely"
 * language. We avoid the term "odds ratio" itself in the body since it's
 * an unfamiliar concept; the precise value sits in the predictor table for
 * anyone who wants it.
 */
function describeLogisticCoefImpact(
  target: string,
  coef: LogisticCoefficient,
): string {
  const or = coef.oddsRatio
  if (!Number.isFinite(or) || or <= 0) {
    return `Each additional unit of \`${coef.feature}\` shifts the odds of ${target}=true, but the effect estimate is unstable for this data.`
  }

  if (or >= OR_STRONG) {
    return `Each additional unit of \`${coef.feature}\` makes ${target}=true about ${formatNumber(or)}x more likely (compounding for each extra unit).`
  }
  if (or >= OR_NOTABLE) {
    const pctIncrease = formatPct(or - 1)
    return `Each additional unit of \`${coef.feature}\` raises the odds of ${target}=true by about ${pctIncrease}, holding the other predictors constant.`
  }
  if (or > 1) {
    return `Each additional unit of \`${coef.feature}\` nudges the odds of ${target}=true slightly upward (odds ratio ${or.toFixed(2)}).`
  }
  if (or >= 1 / OR_NOTABLE) {
    return `Each additional unit of \`${coef.feature}\` nudges the odds of ${target}=true slightly downward (odds ratio ${or.toFixed(2)}).`
  }
  if (or >= 1 / OR_STRONG) {
    const inverseOr = 1 / or
    return `Each additional unit of \`${coef.feature}\` lowers the odds of ${target}=true. A one-unit increase makes "true" about ${formatNumber(inverseOr)}x less likely.`
  }
  const inverseOr = 1 / or
  return `Each additional unit of \`${coef.feature}\` strongly lowers the odds of ${target}=true. A one-unit increase makes "true" about ${formatNumber(inverseOr)}x less likely.`
}

function formatPValue(p: number): string {
  if (p < 0.001) return '< 0.001'
  if (p < 0.01) return `= ${p.toFixed(3)}`
  return `= ${p.toFixed(2)}`
}
