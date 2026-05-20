/**
 * Statistical result shapes returned by the Python engine.
 *
 * These types are the contract between Python and JS. Every field defined
 * here must be produced by `src/python/descriptive.py` and consumed by the
 * dashboard components. When adding a stat, add it here first, then to the
 * Python side, then to the narrative builder, then to the UI.
 *
 * Discriminated unions on `kind` let TypeScript narrow the type so each
 * dashboard card knows exactly which fields it has access to.
 */

export type ColumnType =
  | 'numeric'
  | 'categorical'
  | 'datetime'
  | 'boolean'
  | 'unknown'

/**
 * Common fields every column summary carries regardless of type.
 * Pulled into a base interface so we can write narrative helpers that
 * accept "any column" for missing-value commentary, etc.
 */
interface ColumnSummaryBase {
  name: string
  /** Original row count in the source CSV (same across all columns). */
  totalRows: number
  /** How many rows had a null/empty value in this column. */
  missing: number
  /** missing / totalRows, 0 to 1. Pre-computed for narratives. */
  missingPct: number
}

export interface NumericSummary extends ColumnSummaryBase {
  kind: 'numeric'
  /** How many rows had a usable number after coercion + NaN drop. */
  count: number
  mean: number
  std: number
  /** Coefficient of variation: std / |mean|. NaN if mean is zero. */
  cv: number
  median: number
  /** Median absolute deviation, the robust analog of std. */
  mad: number
  /** Interquartile range, p75 - p25. */
  iqr: number
  min: number
  max: number
  /** Five percentiles + median, useful for box plots and a fuller picture than just min/max. */
  p1: number
  p5: number
  p25: number
  p50: number // === median, included for symmetry
  p75: number
  p95: number
  p99: number
  /** Fisher-Pearson standardized moment. 0 = symmetric, > 0 = right tail, < 0 = left tail. */
  skew: number
  /** Excess kurtosis (kurtosis - 3). 0 = normal-like, > 0 = heavy tails, < 0 = light tails. */
  kurtosisExcess: number
  /**
   * p-value from a normality test (Shapiro-Wilk for n <= 5000, Anderson-Darling
   * fallback above that). Low p-value (< 0.05) means we can reject the null
   * hypothesis that the data is normally distributed. We use this as a hint
   * for the narrative, not a binary gate.
   */
  normalityP: number
  /** Count of values flagged as outliers by Tukey's 1.5 * IQR fence. Classical, sensitive to skew. */
  outlierIqrCount: number
  /** Count of values with |modified Z-score| > 3.5, using MAD. Robust, recommended for skewed data. */
  outlierRobustCount: number
  /**
   * Gini coefficient over absolute values. 0 = perfectly equal, 1 = all
   * concentrated in one observation. Useful for revenue-style columns
   * where "the top customers drive most of the value" is the real story.
   */
  gini: number
  /** Number of exact zeros. Matters for sparse columns and ratio interpretation. */
  zerosCount: number
  /**
   * Histogram bins for plotting. `bins` is the array of edges (length n+1),
   * `counts` is the array of bin frequencies (length n). Computed with the
   * Freedman-Diaconis rule on the Python side, capped at 40 bins so wide
   * datasets don't produce hair-thin bars.
   */
  histogramBins: number[]
  histogramCounts: number[]
  /**
   * The values flagged as outliers by the modified Z-score test, capped at
   * 50 to keep the payload bounded. Used to render outlier markers on the
   * distribution chart.
   */
  outlierValues: number[]
}

export interface CategoricalSummary extends ColumnSummaryBase {
  kind: 'categorical'
  count: number
  /** Distinct value count after trimming and case-folding wasn't applied (we keep raw). */
  uniqueCount: number
  /** Most-frequent value. */
  mode: string
  /** Frequency of the mode, as count. */
  modeFrequency: number
  /** Top 5 values by frequency. */
  topValues: Array<{ value: string; count: number; pct: number }>
  /**
   * Shannon entropy normalized by log2(uniqueCount). Range 0 to 1.
   * 0 = all rows share one value (no diversity).
   * 1 = rows spread evenly across all unique values (maximum diversity).
   */
  entropyNormalized: number
}

export interface DatetimeSummary extends ColumnSummaryBase {
  kind: 'datetime'
  count: number
  /** ISO 8601 date string. */
  minDate: string
  /** ISO 8601 date string. */
  maxDate: string
  /** maxDate - minDate, in days. */
  rangeDays: number
  /**
   * Inferred temporal granularity. Best guess based on the median gap
   * between consecutive observations.
   */
  granularity: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'irregular'
  /**
   * If granularity is regular (daily, weekly, monthly, etc.), how many
   * expected periods in the range are missing observations.
   */
  gapCount: number
}

export interface BooleanSummary extends ColumnSummaryBase {
  kind: 'boolean'
  count: number
  trueCount: number
  falseCount: number
  /** trueCount / count, 0 to 1. */
  truePct: number
}

/** A column that couldn't be analyzed (empty, all-missing, unrecognized type). */
export interface UnknownSummary extends ColumnSummaryBase {
  kind: 'unknown'
  /** Why we couldn't produce richer output. */
  reason: string
}

export type ColumnSummary =
  | NumericSummary
  | CategoricalSummary
  | DatetimeSummary
  | BooleanSummary
  | UnknownSummary

/**
 * Top-level descriptive result. The Pyodide client returns this when the
 * user clicks Analyze.
 */
export interface DescriptiveResult {
  /** Total rows in the source CSV. */
  rowCount: number
  /** Total columns. */
  columnCount: number
  /** One entry per column, in source order. */
  columns: ColumnSummary[]
  /** ISO 8601 timestamp from the Python side. Useful for cache busting later. */
  generatedAt: string
  /** How long the descriptive pass took, in milliseconds. */
  computeMs: number
}
