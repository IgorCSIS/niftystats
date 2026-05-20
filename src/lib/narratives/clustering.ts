/**
 * Narrative builders for the clustering result.
 *
 * Two flavors of narrative:
 *
 *   - Section-level: how many groups we found, how clean the separation
 *     is (silhouette score), whether to trust the result. Goes at the
 *     top of the ClusteringSection above the scatter.
 *
 *   - Per-cluster: what makes this group distinctive. Reads like "Group A
 *     contains 152 rows (44% of the data), distinguished by larger
 *     bill_length_mm (+1.2 SD above average) and shorter flipper_length_mm
 *     (-0.8 SD)." We translate the SD deviations into "noticeably higher /
 *     noticeably lower" in plain English.
 */

import type { ClusterSummary, ClusteringResult, DistinguishingFeature } from '@/types/stats'
import type { Narrative } from './descriptive'
import { formatCount, formatNumber, formatPct } from './format'

/** Silhouette score thresholds for clean-vs-weak group separation. */
const SILHOUETTE_STRONG = 0.5
const SILHOUETTE_OK = 0.35
const SILHOUETTE_WEAK = 0.25

/** Magnitude of an SD deviation that counts as "distinctive" in a feature. */
const DEVIATION_NOTABLE = 0.5
const DEVIATION_STRONG = 1.0

/**
 * Builds the headline narrative for the whole clustering section. Lives
 * above the scatter plot to set expectations before the user looks at
 * the colors.
 */
export function buildClusteringSummaryNarrative(
  result: ClusteringResult,
): Narrative {
  const k = result.k
  const score = result.silhouetteScore

  if (score >= SILHOUETTE_STRONG) {
    return {
      headline: `${k} clearly separated groups in your data.`,
      body: `K-means found ${k} natural groups with strong separation (silhouette score ${score.toFixed(2)}). The colored regions in the scatter below represent meaningful, distinct populations rather than arbitrary slices.`,
      severity: 'info',
    }
  }

  if (score >= SILHOUETTE_OK) {
    return {
      headline: `${k} groups with reasonable separation.`,
      body: `K-means split the data into ${k} groups; the separation is decent but not crisp (silhouette score ${score.toFixed(2)}). The groups make sense but there's overlap at the boundaries, so a few rows could plausibly belong to a neighboring group.`,
      severity: 'info',
    }
  }

  if (score >= SILHOUETTE_WEAK) {
    return {
      headline: `${k} groups, but the boundaries are fuzzy.`,
      body: `K-means split the data into ${k} groups, but the silhouette score (${score.toFixed(2)}) suggests the boundaries between groups aren't crisp. Treat these as rough buckets rather than hard categories.`,
      severity: 'note',
    }
  }

  return {
    headline: `Weak clustering signal in this data.`,
    body: `K-means produced ${k} groups but the silhouette score (${score.toFixed(2)}) is low, which means there isn't a clear "natural shape" of distinct groups here. Your data is closer to a single continuous spread than to separate populations. Treat the groupings below as a starting point, not a conclusion.`,
    severity: 'warning',
  }
}

/**
 * Narrative for one cluster. Combines size and distinguishing features
 * into a human-readable summary.
 */
export function buildClusterNarrative(cluster: ClusterSummary): Narrative {
  const sizeText = `${formatCount(cluster.size)} rows (${formatPct(cluster.sizePct)} of the data)`

  const notableFeatures = cluster.distinguishingFeatures.filter(
    (f) => Math.abs(f.deviationFromMeanStd) >= DEVIATION_NOTABLE,
  )

  if (notableFeatures.length === 0) {
    return {
      headline: `${cluster.label}: ${sizeText}.`,
      body: `This group sits close to the overall average across all features; nothing stands out as distinctive. Possibly a "typical case" group.`,
      severity: 'info',
    }
  }

  const featureDescriptions = notableFeatures.map((f) => describeFeature(f))
  const distinctiveLine =
    featureDescriptions.length === 1
      ? `Distinguished by ${featureDescriptions[0]}.`
      : `Distinguished by ${joinList(featureDescriptions)}.`

  return {
    headline: `${cluster.label}: ${sizeText}.`,
    body: distinctiveLine,
    severity: 'info',
  }
}

/**
 * Returns a small Narrative explaining how to read the PCA projection.
 * Shown beneath the scatter so a curious reader understands the abstract
 * coordinates.
 */
export function buildProjectionExplanation(
  result: ClusteringResult,
): Narrative {
  const totalVariance =
    (result.pcaVarianceExplained[0] + result.pcaVarianceExplained[1]) * 100
  return {
    headline: `Reading the scatter.`,
    body: `Each point is one row, plotted on the two directions that capture the most variation across your ${result.featureColumns.length} numeric columns. The view captures ${totalVariance.toFixed(0)}% of the total variation, so it's a faithful but compressed picture. Points of the same color belong to the same group; tight clusters of one color confirm the grouping is real.`,
    severity: 'note',
  }
}

/** Convert a distinguishing feature into a phrase like "noticeably high body_mass_g (+1.2 SD)". */
function describeFeature(f: DistinguishingFeature): string {
  const abs = Math.abs(f.deviationFromMeanStd)
  const direction = f.deviationFromMeanStd > 0 ? 'higher' : 'lower'
  const magnitudeWord =
    abs >= DEVIATION_STRONG ? 'noticeably' : abs >= DEVIATION_NOTABLE ? 'somewhat' : 'slightly'

  return `${magnitudeWord} ${direction} \`${f.feature}\` (around ${formatNumber(f.centerValue)})`
}

/** Join a list of phrases with commas and "and" before the last. */
function joinList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}
