"""
NiftyStats descriptive engine.

Runs inside Pyodide. The JS side hands us a JSON string of rows (PapaParse
output) plus a JSON string of column metadata (name + type from our
TypeScript type sniffer). We return a JSON string matching the
`DescriptiveResult` TypeScript interface defined in src/types/stats.ts.

Design principles:

1. Best-in-class statistics, not the bare minimum. We compute both classical
   (mean, std, IQR-fence outliers) and robust (median, MAD, MAD-based
   modified Z-score outliers, Shapiro-Wilk normality test) alongside
   distribution-shape and inequality measures (skew, excess kurtosis, Gini).
   Real users care which of these their data resembles, and the narrative
   layer keys off them.

2. Per-column try/except. A single column with weird data should not blank
   the whole result. We isolate failures and surface them as 'unknown'
   summaries with a `reason` field the UI can show.

3. Coerce strictly using pandas. The TS-side type sniff is a hint, not a
   guarantee. Numeric columns get `to_numeric(errors='coerce')` which turns
   non-numeric stragglers into NaN; same pattern for datetime. We compute
   stats on the post-coercion non-null series.

4. JSON in, JSON out. The boundary is plain text both ways. Avoids PyProxy
   lifetime issues and lets us version the schema independently of Pyodide
   internals.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from time import perf_counter
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

# How many percentile cuts we compute per numeric column. p50 == median.
PERCENTILES = [0.01, 0.05, 0.25, 0.50, 0.75, 0.95, 0.99]

# Threshold for the modified Z-score outlier test. 3.5 is the Iglewicz-Hoaglin
# (1993) recommendation, more robust than the classical 3 sigma rule on
# skewed or heavy-tailed data because it builds on MAD instead of std.
MODIFIED_Z_THRESHOLD = 3.5

# Cap for Shapiro-Wilk. The test loses meaningfulness on huge samples (it
# rejects normality for any tiny deviation), so we fall back to
# Anderson-Darling above this size.
SHAPIRO_MAX_N = 5000

# How many top categorical values we report. Five is the sweet spot for
# narratives: enough to communicate the long-tail shape, not so many that
# the UI gets cluttered.
TOP_CATEGORICAL_VALUES = 5

# Histogram bin cap. Freedman-Diaconis can suggest hundreds of bins for
# wide-ranging data, which produces hair-thin bars no one can read.
MAX_HISTOGRAM_BINS = 40

# How many outlier values we ship back to the UI for plotting. Past 50
# the strip chart turns into a black bar and the user learns nothing new.
MAX_OUTLIER_VALUES = 50


def run_descriptive(rows_json: str, columns_meta_json: str) -> str:
    """
    Top-level dispatch. Called from JS via pyodide.runPython.

    Args:
        rows_json: JSON string of rows, each row is {column_name: string_value}.
        columns_meta_json: JSON string of [{name, type}] entries from the
            TypeScript type sniffer.

    Returns:
        JSON string matching the DescriptiveResult interface.
    """
    started_at = perf_counter()

    rows = json.loads(rows_json)
    columns_meta = json.loads(columns_meta_json)

    df = pd.DataFrame(rows)
    total_rows = len(df)

    summaries: list[dict[str, Any]] = []
    for meta in columns_meta:
        try:
            summary = _summarize_column(df, meta, total_rows)
        except Exception as exc:
            # One bad column shouldn't kill the whole report. Capture the
            # reason in an 'unknown' summary so the UI can show what went
            # wrong without users seeing a blank dashboard.
            summary = _unknown_summary(
                name=meta["name"],
                total_rows=total_rows,
                missing=int(df[meta["name"]].isna().sum() + (df[meta["name"]] == "").sum())
                if meta["name"] in df.columns
                else total_rows,
                reason=f"{type(exc).__name__}: {exc}",
            )
        summaries.append(summary)

    compute_ms = int((perf_counter() - started_at) * 1000)
    result = {
        "rowCount": total_rows,
        "columnCount": len(columns_meta),
        "columns": summaries,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "computeMs": compute_ms,
    }
    # Recursively scrub NaN and Infinity from the entire payload before
    # serializing. JSON has no representation for either, and `json.dumps`
    # would otherwise emit literal "NaN" / "Infinity" tokens that the JS
    # side cannot parse. allow_nan=False below would *raise* on NaN, which
    # is useful while developing but bad UX in production; the sanitizer
    # + allow_nan=False combination gives us both: defense in depth.
    sanitized = _sanitize_for_json(result)
    return json.dumps(sanitized, default=_json_default, allow_nan=False)


def _summarize_column(
    df: pd.DataFrame, meta: dict[str, Any], total_rows: int
) -> dict[str, Any]:
    """Route a single column to the type-specific summary function."""
    name = meta["name"]
    ctype = meta["type"]
    raw = df[name] if name in df.columns else pd.Series(dtype=object)

    # Empty strings count as missing alongside NaN. The CSV parser keeps
    # empties as "" rather than null, so we have to normalize here.
    is_blank = raw.isna() | (raw.astype(str).str.strip() == "")
    missing = int(is_blank.sum())

    if ctype == "numeric":
        return _summarize_numeric(name, raw, total_rows, missing)
    if ctype == "categorical":
        return _summarize_categorical(name, raw, total_rows, missing)
    if ctype == "datetime":
        return _summarize_datetime(name, raw, total_rows, missing)
    if ctype == "boolean":
        return _summarize_boolean(name, raw, total_rows, missing)

    return _unknown_summary(
        name=name,
        total_rows=total_rows,
        missing=missing,
        reason=f"Type '{ctype}' is not supported in this version.",
    )


def _looks_like_year_column(name: str, series: pd.Series) -> bool:
    """
    Heuristic: a column is "year-like" if its name suggests so and its
    values fit the range of plausible calendar years. Saves the UI from
    formatting "2024" as "2.02k".
    """
    name_lower = name.lower()
    name_hits = any(
        token in name_lower
        for token in ("year", "yr", "fiscal_year", "fy")
    )
    if not name_hits:
        return False
    if series.empty:
        return False
    # All integer values within a typical calendar-year window.
    try:
        as_int = series.dropna().astype(float)
    except Exception:
        return False
    if as_int.empty:
        return False
    if not (as_int == as_int.astype(int)).all():
        return False
    return bool((as_int.min() >= 1800) and (as_int.max() <= 2200))


def _summarize_numeric(
    name: str, raw: pd.Series, total_rows: int, missing: int
) -> dict[str, Any]:
    """
    Numeric column summary. Coerce, drop NaN, compute the full classical +
    robust stat panel.
    """
    # Strip thousands-separator commas before coercion. Mirrors what our TS
    # sniffer accepts so the post-coerce row count matches what the user saw
    # in the preview.
    cleaned = raw.astype(str).str.replace(",", "", regex=False)
    series = pd.to_numeric(cleaned, errors="coerce").dropna()
    count = int(series.size)

    if count == 0:
        return _unknown_summary(
            name=name,
            total_rows=total_rows,
            missing=missing,
            reason="No numeric values after coercion.",
        )

    mean = float(series.mean())
    std = float(series.std(ddof=1)) if count > 1 else 0.0
    median = float(series.median())
    # Median Absolute Deviation. The 1.4826 factor scales MAD so it's
    # comparable to std under a normal distribution, which makes the
    # mean-vs-median and std-vs-MAD comparisons more intuitive in narratives.
    mad = float(stats.median_abs_deviation(series, scale=1.4826)) if count > 1 else 0.0
    p_values = series.quantile(PERCENTILES)
    p1 = float(p_values.loc[0.01])
    p5 = float(p_values.loc[0.05])
    p25 = float(p_values.loc[0.25])
    p50 = float(p_values.loc[0.50])
    p75 = float(p_values.loc[0.75])
    p95 = float(p_values.loc[0.95])
    p99 = float(p_values.loc[0.99])
    iqr = p75 - p25

    # Coefficient of variation. We use absolute mean in the denominator so
    # the metric stays meaningful for columns centered near zero in either
    # direction (rare but happens with returns / deltas).
    cv = float(std / abs(mean)) if mean != 0 else float("nan")

    skew = float(series.skew()) if count > 2 else 0.0
    # pandas .kurt() already returns EXCESS kurtosis (subtracts 3 implicitly),
    # which is what we want. Documenting this here because the convention
    # varies across stats packages and is easy to get wrong.
    kurtosis_excess = float(series.kurt()) if count > 3 else 0.0

    normality_p = _normality_p_value(series)
    outlier_iqr = int(_tukey_outlier_count(series, p25, p75, iqr))
    outlier_robust = int(_modified_z_outlier_count(series, median, mad))
    gini_value = float(_gini_coefficient(series))
    zeros = int((series == 0).sum())

    # Histogram + outlier values for the chart layer. We compute these
    # alongside the stats so the JS side never has to ship raw rows back
    # to Plotly; payload stays bounded regardless of input size.
    hist_bins, hist_counts = _compute_histogram(series)
    outlier_values = _collect_outlier_values(series, median, mad)

    # Format hint: year-like columns get a special label so the UI
    # displays "2024" rather than "2.02k".
    format_hint = "year" if _looks_like_year_column(name, series) else "standard"

    return {
        "kind": "numeric",
        "name": name,
        "totalRows": total_rows,
        "missing": missing,
        "missingPct": missing / total_rows if total_rows else 0.0,
        "count": count,
        "mean": _clean(mean),
        "std": _clean(std),
        "cv": _clean(cv),
        "median": _clean(median),
        "mad": _clean(mad),
        "iqr": _clean(iqr),
        "min": _clean(float(series.min())),
        "max": _clean(float(series.max())),
        "p1": _clean(p1),
        "p5": _clean(p5),
        "p25": _clean(p25),
        "p50": _clean(p50),
        "p75": _clean(p75),
        "p95": _clean(p95),
        "p99": _clean(p99),
        "skew": _clean(skew),
        "kurtosisExcess": _clean(kurtosis_excess),
        "normalityP": _clean(normality_p),
        "outlierIqrCount": outlier_iqr,
        "outlierRobustCount": outlier_robust,
        "gini": _clean(gini_value),
        "zerosCount": zeros,
        "histogramBins": hist_bins,
        "histogramCounts": hist_counts,
        "outlierValues": outlier_values,
        "formatHint": format_hint,
    }


def _summarize_categorical(
    name: str, raw: pd.Series, total_rows: int, missing: int
) -> dict[str, Any]:
    """Categorical column summary. Trim, count, compute entropy + top values."""
    series = raw.astype(str).str.strip()
    series = series[series != ""]
    count = int(series.size)

    if count == 0:
        return _unknown_summary(
            name=name,
            total_rows=total_rows,
            missing=missing,
            reason="No non-empty categorical values.",
        )

    value_counts = series.value_counts()
    unique_count = int(value_counts.size)
    mode_value = str(value_counts.index[0])
    mode_frequency = int(value_counts.iloc[0])

    top_n = value_counts.head(TOP_CATEGORICAL_VALUES)
    top_values = [
        {
            "value": str(idx),
            "count": int(top_n.loc[idx]),
            "pct": float(top_n.loc[idx]) / count,
        }
        for idx in top_n.index
    ]

    entropy_normalized = _normalized_entropy(value_counts.values, unique_count)

    return {
        "kind": "categorical",
        "name": name,
        "totalRows": total_rows,
        "missing": missing,
        "missingPct": missing / total_rows if total_rows else 0.0,
        "count": count,
        "uniqueCount": unique_count,
        "mode": mode_value,
        "modeFrequency": mode_frequency,
        "topValues": top_values,
        "entropyNormalized": _clean(entropy_normalized),
    }


def _summarize_datetime(
    name: str, raw: pd.Series, total_rows: int, missing: int
) -> dict[str, Any]:
    """Datetime summary. Range, granularity inference, gap detection."""
    parsed = pd.to_datetime(raw, errors="coerce", utc=False)
    parsed = parsed.dropna()
    count = int(parsed.size)

    if count == 0:
        return _unknown_summary(
            name=name,
            total_rows=total_rows,
            missing=missing,
            reason="No parseable dates after coercion.",
        )

    sorted_dates = parsed.sort_values().reset_index(drop=True)
    min_date = sorted_dates.iloc[0]
    max_date = sorted_dates.iloc[-1]
    range_days = int((max_date - min_date).days)

    granularity, gap_count = _infer_temporal_granularity(sorted_dates)

    return {
        "kind": "datetime",
        "name": name,
        "totalRows": total_rows,
        "missing": missing,
        "missingPct": missing / total_rows if total_rows else 0.0,
        "count": count,
        "minDate": min_date.isoformat(),
        "maxDate": max_date.isoformat(),
        "rangeDays": range_days,
        "granularity": granularity,
        "gapCount": gap_count,
    }


def _summarize_boolean(
    name: str, raw: pd.Series, total_rows: int, missing: int
) -> dict[str, Any]:
    """Boolean summary. Match common true/false strings, count."""
    true_set = {"true", "yes", "y", "1", "t"}
    false_set = {"false", "no", "n", "0", "f"}

    lower = raw.astype(str).str.strip().str.lower()
    truthy = lower.isin(true_set)
    falsy = lower.isin(false_set)
    true_count = int(truthy.sum())
    false_count = int(falsy.sum())
    count = true_count + false_count

    if count == 0:
        return _unknown_summary(
            name=name,
            total_rows=total_rows,
            missing=missing,
            reason="No recognized boolean values.",
        )

    return {
        "kind": "boolean",
        "name": name,
        "totalRows": total_rows,
        "missing": missing,
        "missingPct": missing / total_rows if total_rows else 0.0,
        "count": count,
        "trueCount": true_count,
        "falseCount": false_count,
        "truePct": true_count / count if count else 0.0,
    }


def _unknown_summary(
    name: str, total_rows: int, missing: int, reason: str
) -> dict[str, Any]:
    """Fallback for columns we couldn't analyze. Always JSON-safe."""
    return {
        "kind": "unknown",
        "name": name,
        "totalRows": total_rows,
        "missing": missing,
        "missingPct": missing / total_rows if total_rows else 0.0,
        "reason": reason,
    }


# ---------- Stat helpers ----------


def _normality_p_value(series: pd.Series) -> float:
    """
    Run a normality test and return the p-value.

    Shapiro-Wilk is the most powerful test for small/moderate samples but
    becomes too sensitive above ~5000 rows (the slightest non-normality
    yields p ~= 0). We swap to Anderson-Darling's standard implementation
    for large samples, converting the test statistic into an approximate
    p-value via the published critical-value table.

    Returns NaN if the test cannot run (less than 3 unique values, etc.).
    """
    n = int(series.size)
    if n < 3 or series.nunique() < 3:
        return float("nan")

    if n <= SHAPIRO_MAX_N:
        try:
            stat_value, p_value = stats.shapiro(series.values)
            return float(p_value)
        except Exception:
            return float("nan")

    # Anderson-Darling fallback. The test returns a statistic plus critical
    # values at fixed significance levels (15%, 10%, 5%, 2.5%, 1%). We map
    # the statistic to an approximate p-value using those bands.
    try:
        result = stats.anderson(series.values, dist="norm")
        stat_value = float(result.statistic)
        critical_values = list(result.critical_values)
        significance_levels = [0.15, 0.10, 0.05, 0.025, 0.01]
        for level, crit in zip(significance_levels, critical_values):
            if stat_value < crit:
                return float(level)
        return 0.01
    except Exception:
        return float("nan")


def _tukey_outlier_count(
    series: pd.Series, p25: float, p75: float, iqr: float
) -> int:
    """Count values outside the classic 1.5 * IQR fence."""
    if iqr <= 0:
        return 0
    lower_fence = p25 - 1.5 * iqr
    upper_fence = p75 + 1.5 * iqr
    return int(((series < lower_fence) | (series > upper_fence)).sum())


def _modified_z_outlier_count(
    series: pd.Series, median: float, mad: float
) -> int:
    """
    Count values with modified Z-score > MODIFIED_Z_THRESHOLD.

    The modified Z-score uses MAD instead of std, which makes it robust to
    the very outliers we're trying to detect (std is itself inflated by
    outliers, which masks them; MAD isn't).

    Formula: |0.6745 * (x - median) / MAD|
    The 0.6745 constant comes from the inverse normal CDF at 0.75; it
    scales MAD so the modified Z-score matches the classical Z-score under
    a normal distribution.
    """
    if mad <= 0:
        # MAD of zero means most values are identical; no spread to flag.
        return 0
    modified_z = 0.6745 * (series - median) / mad
    return int((modified_z.abs() > MODIFIED_Z_THRESHOLD).sum())


def _compute_histogram(series: pd.Series) -> tuple[list[float], list[int]]:
    """
    Compute histogram bin edges and counts for plotting.

    We prefer the Freedman-Diaconis rule (numpy's 'fd' bin string) because
    it adapts well to skewed distributions, but it can suggest absurd bin
    counts for data with extreme outliers. We cap at MAX_HISTOGRAM_BINS and
    fall back to the Sturges rule (good for normal-ish data) if FD goes
    too aggressive.
    """
    values = series.values
    if values.size < 2:
        return [], []

    try:
        # Get FD-suggested bin count; numpy returns edges, we derive count.
        fd_edges = np.histogram_bin_edges(values, bins="fd")
        fd_count = len(fd_edges) - 1
    except Exception:
        fd_count = 0

    if fd_count <= 0 or fd_count > MAX_HISTOGRAM_BINS:
        # Either FD failed (constant column, etc.) or it suggested too many
        # bins. Use a sensible cap.
        bin_count = min(MAX_HISTOGRAM_BINS, max(10, int(math.sqrt(values.size))))
    else:
        bin_count = fd_count

    counts, edges = np.histogram(values, bins=bin_count)
    return [float(e) for e in edges], [int(c) for c in counts]


def _collect_outlier_values(
    series: pd.Series, median: float, mad: float
) -> list[float]:
    """
    Return the actual values flagged as outliers (capped at MAX_OUTLIER_VALUES).
    The UI renders these as dots on a strip chart beneath the histogram so
    the user can see where the extremes sit relative to the bulk.

    Bug history: an earlier version reindexed `flagged` by the full sorted
    index of modified_z, which padded the result with NaN entries for the
    non-flagged rows. The chart legend then reported the padded length
    (capped at 50) instead of the actual flagged count, so a single
    outlier showed as "50 outliers" in the legend. Fix: build the sort
    index from ONLY the flagged subset.
    """
    if mad <= 0:
        return []
    modified_z = 0.6745 * (series - median) / mad
    mask = modified_z.abs() > MODIFIED_Z_THRESHOLD
    if not mask.any():
        return []
    flagged_z = modified_z[mask]
    # Sort the flagged Z-scores by magnitude (descending) so the most
    # extreme outliers always survive the cap.
    sorted_idx = flagged_z.abs().sort_values(ascending=False).index
    sorted_flagged_values = series.loc[sorted_idx].head(MAX_OUTLIER_VALUES)
    return [float(v) for v in sorted_flagged_values.values]


def _gini_coefficient(series: pd.Series) -> float:
    """
    Gini coefficient over absolute values, 0 to 1.

    Standard formula: G = (sum_i sum_j |x_i - x_j|) / (2 * n^2 * mean(|x|)).
    We compute it via the sorted-array shortcut which avoids the O(n^2)
    double loop. Returns 0 if the series is empty or all zeros.
    """
    values = np.abs(series.values)
    n = values.size
    if n == 0:
        return 0.0
    total = values.sum()
    if total == 0:
        return 0.0
    sorted_vals = np.sort(values)
    # Lorenz-curve-style cumulative form. See Wikipedia: "Gini coefficient,
    # alternative definitions" for the derivation.
    index = np.arange(1, n + 1)
    return float((2.0 * (index * sorted_vals).sum() / (n * total)) - (n + 1) / n)


def _normalized_entropy(counts: np.ndarray, unique_count: int) -> float:
    """
    Shannon entropy normalized to 0..1 by dividing by log2(unique_count).

    Returns 0 for a single unique value (no diversity), 1 for a perfectly
    uniform distribution across all unique values.
    """
    if unique_count <= 1:
        return 0.0
    total = counts.sum()
    if total == 0:
        return 0.0
    probabilities = counts / total
    # Mask zero-prob entries to avoid log(0). They don't contribute anyway.
    probabilities = probabilities[probabilities > 0]
    raw_entropy = -float((probabilities * np.log2(probabilities)).sum())
    return raw_entropy / math.log2(unique_count)


def _infer_temporal_granularity(sorted_dates: pd.Series) -> tuple[str, int]:
    """
    Look at the median gap between consecutive timestamps and pick the
    closest standard granularity bucket. Also count how many "expected"
    timestamps are missing given that granularity.
    """
    if sorted_dates.size < 2:
        return "irregular", 0

    diffs_days = sorted_dates.diff().dropna().dt.total_seconds() / 86400.0
    median_gap = float(diffs_days.median())

    # Bucket boundaries chosen so a real daily series (gap ~= 1) doesn't get
    # misclassified by a stray weekend gap, etc. Buckets are inclusive on
    # the low side.
    if median_gap <= 1.5:
        granularity = "daily"
        expected_gap = 1.0
    elif median_gap <= 9:
        granularity = "weekly"
        expected_gap = 7.0
    elif median_gap <= 45:
        granularity = "monthly"
        expected_gap = 30.4375  # average days per month
    elif median_gap <= 130:
        granularity = "quarterly"
        expected_gap = 91.3125
    elif median_gap <= 400:
        granularity = "yearly"
        expected_gap = 365.25
    else:
        return "irregular", 0

    # Count gaps that exceed 1.5x the expected granularity gap.
    gap_count = int((diffs_days > expected_gap * 1.5).sum())
    return granularity, gap_count


def _clean(value: float) -> float | None:
    """
    JSON.dumps chokes on NaN and Infinity (they're not valid JSON). Convert
    them to None so the JS side receives proper nulls and the type system
    knows to handle them.
    """
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return float(value)


def _sanitize_for_json(obj: Any) -> Any:
    """
    Recursively walk the result and replace any NaN / Infinity floats with
    None. Lists and dicts are traversed; everything else passes through.

    Handles both plain Python floats AND numpy scalar floats (np.float64,
    np.float32, etc.) which can leak out of pandas operations. We cast to
    a plain float before the isnan/isinf check so numpy's own NaN sentinel
    is detected reliably.
    """
    if isinstance(obj, (float, np.floating)):
        value = float(obj)
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, dict):
        return {key: _sanitize_for_json(val) for key, val in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(item) for item in obj]
    if isinstance(obj, np.ndarray):
        return [_sanitize_for_json(item) for item in obj.tolist()]
    return obj


def _json_default(value: Any) -> Any:
    """
    Last-line-of-defense JSON encoder for numpy/pandas scalars that snuck
    through. Most of the time everything is already coerced to Python
    floats/ints, but a stray np.int64 would break json.dumps without this.
    """
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        if math.isnan(float(value)) or math.isinf(float(value)):
            return None
        return float(value)
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")
