"""
NiftyStats relational engine.

Runs inside Pyodide alongside descriptive.py. Computes pairwise
correlations between numeric columns and per-target OLS regression with
proper inferential statistics (p-values, R^2, adjusted R^2, multicollinearity).

Design intent:

1. No new Pyodide packages. scipy + numpy + pandas are already loaded.
   We do the regression math directly (closed-form OLS via the normal
   equations, t-tests for coefficients) rather than dragging statsmodels
   or scikit-learn into the cold-load path. That keeps the engine
   warm-up identical to v2.s3.

2. Same JSON-in / JSON-out boundary as the descriptive engine. Same
   sanitizer for NaN/Inf. Same per-target try/except so one failed
   regression doesn't kill the whole relational pass.

3. Numeric-only. Categorical and datetime columns are filtered out before
   any correlation or regression call. We let the descriptive engine speak
   for those types; mixing them into regression here would force decisions
   about one-hot encoding and dummy variables that belong in v4 territory.

The function `run_relational(rows_json, columns_meta_json)` mirrors the
shape of `run_descriptive` in descriptive.py. The Pyodide client calls
both per Analyze and merges the results into AnalysisResult.
"""

from __future__ import annotations

import json
import math
from time import perf_counter
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

# Cap on how many highlighted top correlations we ship per category.
TOP_CORRELATION_LIMIT = 3

# Minimum |r| a pair must clear to qualify for the move-together /
# move-opposite groups. Below this the relationship is too weak to be
# worth featuring as a "strongest" finding. Pairs that don't clear are
# still visible in the heatmap, just not in the highlight strip.
MIN_REPORTABLE_R = 0.15

# Correlations at or above this threshold get flagged as "essentially the
# same thing" so we can collapse 3 perfect-correlation findings into a
# single meta-observation (e.g., sales sample where marketing_spend,
# revenue, and customers all scale with campaign size).
SAME_THING_R = 0.95

# A pair gets flagged as "non-linear" when both:
#   1. |spearman - pearson| exceeds NON_LINEAR_GAP_THRESHOLD, AND
#   2. The relationship is at least moderate by one method
#      (max(|pearson|, |spearman|) >= NON_LINEAR_MIN_STRENGTH).
#
# The gap-only check is too generous on small samples: 28 rows of weak,
# noisy correlations frequently produce Pearson/Spearman gaps of 0.2-0.3
# from sampling variance alone, which would otherwise drown out the
# genuinely informative cases. Requiring at least one strong correlation
# keeps the bucket focused on actual non-linearity (curvature, thresholds,
# diminishing returns) rather than weak-and-noisy column pairs.
NON_LINEAR_GAP_THRESHOLD = 0.20
NON_LINEAR_MIN_STRENGTH = 0.4

# Variance Inflation Factor cutoff for "highly collinear." 10 is the
# conventional rule of thumb in regression diagnostics (Belsley/Kuh/Welsch).
VIF_HIGH_THRESHOLD = 10.0

# Significance level for marking coefficients as "significant" in the UI.
SIGNIFICANCE_ALPHA = 0.05

# Minimum sample size before we attempt regression. Below this, p-values
# are unreliable and the regression is more likely to mislead than help.
MIN_REGRESSION_N = 20


def run_relational(rows_json: str, columns_meta_json: str) -> str:
    """
    Top-level dispatch. Mirrors descriptive.run_descriptive's contract.

    Returns a JSON string matching the `RelationalResult` TypeScript
    interface defined in src/types/stats.ts.
    """
    started_at = perf_counter()

    rows = json.loads(rows_json)
    columns_meta = json.loads(columns_meta_json)

    df = pd.DataFrame(rows)
    numeric_meta = [m for m in columns_meta if m["type"] == "numeric"]

    if len(numeric_meta) < 2:
        # Fewer than two numeric columns means no pairwise relationships
        # to compute and no regression to run. Return an empty-but-valid
        # result so the UI can render a "no relational analysis available"
        # placeholder instead of crashing.
        empty = _empty_result(int((perf_counter() - started_at) * 1000))
        return json.dumps(empty, allow_nan=False, default=_json_default)

    # Coerce all numeric columns once. The result is a DataFrame of floats
    # with NaN where coercion failed. Every downstream step works on this
    # post-coercion frame so correlations and regressions agree on which
    # rows count as "valid."
    coerced = _build_numeric_dataframe(df, [m["name"] for m in numeric_meta])

    pearson_matrix = _compute_correlation(coerced, "pearson")
    spearman_matrix = _compute_correlation(coerced, "spearman")

    top_positive, top_negative, top_non_linear = _extract_top_correlations(
        pearson_matrix, spearman_matrix
    )

    regressions = []
    for target in coerced.columns:
        try:
            result = _run_linear_regression(coerced, target)
        except Exception as exc:
            result = _empty_regression(
                target=target,
                skipped_reason=f"{type(exc).__name__}: {exc}",
            )
        regressions.append(result)

    compute_ms = int((perf_counter() - started_at) * 1000)
    payload = {
        "pearson": pearson_matrix,
        "spearman": spearman_matrix,
        "topPositive": top_positive,
        "topNegative": top_negative,
        "topNonLinear": top_non_linear,
        "regressions": regressions,
        "computeMs": compute_ms,
    }
    sanitized = _sanitize_for_json(payload)
    return json.dumps(sanitized, allow_nan=False, default=_json_default)


# ----- DataFrame setup -----


def _build_numeric_dataframe(
    df: pd.DataFrame, column_names: list[str]
) -> pd.DataFrame:
    """
    Coerce the requested columns to numeric (NaN on failure) and return a
    new DataFrame containing only those columns.

    Strips thousands-separator commas first so the post-coercion row count
    matches what the user saw in the preview. Mirrors the same convention
    used by the descriptive engine for consistency.
    """
    out: dict[str, pd.Series] = {}
    for name in column_names:
        if name not in df.columns:
            continue
        cleaned = df[name].astype(str).str.replace(",", "", regex=False)
        out[name] = pd.to_numeric(cleaned, errors="coerce")
    return pd.DataFrame(out)


# ----- Correlation -----


def _compute_correlation(df: pd.DataFrame, method: str) -> dict[str, Any]:
    """
    Compute a correlation matrix plus per-pair p-values.

    pandas' built-in `df.corr()` is fast but doesn't give p-values; we use
    scipy.stats.pearsonr / spearmanr per pair so we get both r and p.
    For a 50-column dataset that's 50*49/2 = 1225 calls, which finishes
    in well under a second in Pyodide.
    """
    columns = list(df.columns)
    n = len(columns)
    values: list[list[float | None]] = [
        [None for _ in range(n)] for _ in range(n)
    ]
    p_values: list[list[float | None]] = [
        [None for _ in range(n)] for _ in range(n)
    ]

    for i in range(n):
        # Diagonal: a column is perfectly correlated with itself.
        values[i][i] = 1.0
        p_values[i][i] = 0.0

        for j in range(i + 1, n):
            col_a = df[columns[i]]
            col_b = df[columns[j]]
            # Pair-wise complete cases. Each pair gets to use whatever rows
            # are valid for both columns, even if other columns in the
            # frame have NaN in those rows.
            mask = col_a.notna() & col_b.notna()
            paired_a = col_a[mask].values
            paired_b = col_b[mask].values

            if paired_a.size < 3:
                continue

            try:
                if method == "pearson":
                    r, p = scipy_stats.pearsonr(paired_a, paired_b)
                else:
                    r, p = scipy_stats.spearmanr(paired_a, paired_b)
            except Exception:
                continue

            if not math.isfinite(r):
                continue

            values[i][j] = float(r)
            values[j][i] = float(r)
            p_values[i][j] = float(p) if math.isfinite(p) else None
            p_values[j][i] = float(p) if math.isfinite(p) else None

    return {"columns": columns, "values": values, "pValues": p_values}


def _extract_top_correlations(
    pearson: dict[str, Any], spearman: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Pull out the most interesting column pairs across both methods.

    We compute one record per upper-triangle pair (i < j to avoid
    duplicates), then sort three different ways: most-positive Pearson,
    most-negative Pearson, biggest |Spearman - Pearson| (non-linear
    hint). Each list capped at TOP_CORRELATION_LIMIT.
    """
    columns = pearson["columns"]
    n = len(columns)
    records: list[dict[str, Any]] = []

    for i in range(n):
        for j in range(i + 1, n):
            p_r = pearson["values"][i][j]
            s_r = spearman["values"][i][j]
            if p_r is None or s_r is None:
                continue
            p_p = pearson["pValues"][i][j]
            s_p = spearman["pValues"][i][j]
            # Use the smaller (more conservative) p-value of the two.
            chosen_p = None
            if p_p is not None and s_p is not None:
                chosen_p = float(min(p_p, s_p))
            elif p_p is not None:
                chosen_p = float(p_p)
            elif s_p is not None:
                chosen_p = float(s_p)

            p_r_float = float(p_r)
            s_r_float = float(s_r)
            gap = abs(s_r_float - p_r_float)
            strongest = max(abs(p_r_float), abs(s_r_float))
            records.append(
                {
                    "columnA": columns[i],
                    "columnB": columns[j],
                    "pearson": p_r_float,
                    "spearman": s_r_float,
                    "pValue": chosen_p if chosen_p is not None else 1.0,
                    "nonLinearHint": (
                        gap >= NON_LINEAR_GAP_THRESHOLD
                        and strongest >= NON_LINEAR_MIN_STRENGTH
                    ),
                }
            )

    # Non-linear hints get top billing: any pair where Spearman and Pearson
    # disagree by more than the threshold is a "real" finding, not just a
    # weak linear correlation.
    top_non_linear = sorted(
        [r for r in records if r["nonLinearHint"]],
        key=lambda r: -abs(r["spearman"] - r["pearson"]),
    )[:TOP_CORRELATION_LIMIT]

    # Exclude pairs already shown as non-linear hints from the
    # positive/negative groups so the same pair doesn't appear in two
    # categories. We dedupe by an order-insensitive frozenset of column
    # names so the comparison is symmetric.
    non_linear_keys = {
        frozenset({r["columnA"], r["columnB"]}) for r in top_non_linear
    }

    def is_new(record: dict[str, Any]) -> bool:
        return frozenset({record["columnA"], record["columnB"]}) not in non_linear_keys

    # Filter to ACTUAL positive / negative correlations that clear the
    # minimum-strength bar. Sorting alone isn't enough: r=0.03 is
    # positive but featuring it as "Move together" oversells a coin flip.
    # Hard sign + strength filter keeps the bucket honest.
    top_positive = sorted(
        [
            r
            for r in records
            if r["pearson"] >= MIN_REPORTABLE_R and is_new(r)
        ],
        key=lambda r: -r["pearson"],
    )[:TOP_CORRELATION_LIMIT]
    top_negative = sorted(
        [
            r
            for r in records
            if r["pearson"] <= -MIN_REPORTABLE_R and is_new(r)
        ],
        key=lambda r: r["pearson"],
    )[:TOP_CORRELATION_LIMIT]

    return top_positive, top_negative, top_non_linear


# ----- Regression -----


def _run_linear_regression(df: pd.DataFrame, target: str) -> dict[str, Any]:
    """
    OLS regression of `target` on every other numeric column.

    We compute the closed-form solution directly:
        beta = (X'X)^-1 X' y
        residuals = y - X beta
        sigma^2 = sum(residuals^2) / (n - p)
        cov(beta) = sigma^2 (X'X)^-1
        SE(beta_i) = sqrt(diag(cov(beta))[i])
        t_i = beta_i / SE(beta_i)
        p_i = 2 * (1 - t_cdf(|t_i|, df = n - p))

    Where p is the number of estimated parameters (intercept + features),
    so degrees of freedom for the t-test is n - p.
    """
    features = [c for c in df.columns if c != target]
    if not features:
        return _empty_regression(target, "No feature columns to regress against.")

    # Listwise deletion: drop any row with NaN in target or any feature.
    # This is the standard OLS approach and ensures n is unambiguous.
    sub = df[[target, *features]].dropna()
    n = len(sub)
    if n < MIN_REGRESSION_N:
        return _empty_regression(
            target,
            f"Need at least {MIN_REGRESSION_N} rows with valid data; "
            f"this column has only {n}.",
        )

    y = sub[target].values
    X_raw = sub[features].values

    # Skip constant features (zero variance). Including them produces a
    # singular matrix and the regression blows up. The narrative will
    # surface this in a multicollinearity-flag-style note.
    feature_variances = X_raw.var(axis=0, ddof=1)
    nonconstant_mask = feature_variances > 0
    if not nonconstant_mask.any():
        return _empty_regression(
            target, "All feature columns are constant; no variation to model."
        )
    active_features = [
        f for f, keep in zip(features, nonconstant_mask) if keep
    ]
    X_active = X_raw[:, nonconstant_mask]

    # Standardize features for the standardized-coefficient computation.
    # Critical for comparing predictors measured in different units.
    feature_means = X_active.mean(axis=0)
    feature_stds = X_active.std(axis=0, ddof=1)
    # Avoid divide-by-zero: any zero std slipped through the mask above
    # would suggest a bug; defensive fix is to skip standardization there.
    safe_stds = np.where(feature_stds == 0, 1.0, feature_stds)

    # Add intercept column to design matrix.
    X = np.column_stack([np.ones(n), X_active])
    p = X.shape[1]  # parameters including intercept
    dof = n - p

    if dof < 1:
        return _empty_regression(
            target, "Too many features for the available sample size."
        )

    try:
        xtx_inv = np.linalg.inv(X.T @ X)
    except np.linalg.LinAlgError:
        return _empty_regression(
            target,
            "Feature columns are too collinear to invert. Try removing duplicates.",
        )

    beta = xtx_inv @ X.T @ y
    predictions = X @ beta
    residuals = y - predictions
    rss = float(np.sum(residuals**2))
    tss = float(np.sum((y - y.mean()) ** 2))
    r_squared = 1.0 - (rss / tss) if tss > 0 else 0.0
    adjusted = 1.0 - (1.0 - r_squared) * (n - 1) / dof if dof > 0 else r_squared

    sigma_sq = rss / dof if dof > 0 else float("nan")
    var_beta = sigma_sq * np.diag(xtx_inv)
    se_beta = np.sqrt(np.maximum(var_beta, 0))
    # Safe t-stat: if SE is exactly zero (constant column slipped through),
    # treat as t = 0 to avoid division warning.
    t_stats = np.divide(
        beta,
        se_beta,
        out=np.zeros_like(beta),
        where=se_beta > 0,
    )
    p_values = 2 * (1 - scipy_stats.t.cdf(np.abs(t_stats), dof))

    # Standardized coefficients on the FEATURE coefficients only (skip the
    # intercept). Formula: beta_std_i = beta_i * (std_xi / std_y)
    y_std = float(np.std(y, ddof=1))
    feature_betas = beta[1:]  # drop intercept
    standardized = (
        feature_betas * (feature_stds / y_std)
        if y_std > 0
        else np.zeros_like(feature_betas)
    )

    # VIF for each active feature. VIF_i = 1 / (1 - R^2 of feature_i on the
    # other features). We compute via the trick: VIF_i = diag((X_features.T X_features)^-1)
    # scaled appropriately, but the closed-form via the correlation matrix
    # inverse is simpler and numerically equivalent when features are
    # centered/scaled. Here we compute manually using the standardized X.
    multicollinear: list[str] = []
    if len(active_features) > 1:
        try:
            # Use centered+standardized X for VIF; equivalent to the
            # standard regression-against-other-features definition.
            X_std = (X_active - feature_means) / safe_stds
            corr_x = (X_std.T @ X_std) / (n - 1)
            inv_corr = np.linalg.inv(corr_x)
            vifs = np.diag(inv_corr)
            for feat, vif in zip(active_features, vifs):
                if math.isfinite(vif) and vif > VIF_HIGH_THRESHOLD:
                    multicollinear.append(feat)
        except np.linalg.LinAlgError:
            pass

    coefficients = []
    for i, feat in enumerate(active_features):
        # i+1 because index 0 is the intercept in beta/p_values arrays.
        coefficients.append(
            {
                "feature": feat,
                "estimate": float(feature_betas[i]),
                "standardizedEstimate": float(standardized[i]),
                "standardError": float(se_beta[i + 1]),
                "tStatistic": float(t_stats[i + 1]),
                "pValue": float(p_values[i + 1]),
                "isSignificant": bool(p_values[i + 1] < SIGNIFICANCE_ALPHA),
            }
        )

    # Sort by absolute standardized coefficient so the most influential
    # predictors render first in the UI.
    coefficients.sort(key=lambda c: -abs(c["standardizedEstimate"]))

    return {
        "target": target,
        "kind": "linear",
        "rSquared": float(r_squared),
        "adjustedRSquared": float(adjusted),
        "nObservations": int(n),
        "coefficients": coefficients,
        "multicollinearFeatures": multicollinear,
        "skippedReason": None,
    }


def _empty_regression(target: str, skipped_reason: str) -> dict[str, Any]:
    """A placeholder regression result used when we can't run the math."""
    return {
        "target": target,
        "kind": "linear",
        "rSquared": 0.0,
        "adjustedRSquared": 0.0,
        "nObservations": 0,
        "coefficients": [],
        "multicollinearFeatures": [],
        "skippedReason": skipped_reason,
    }


def _empty_result(compute_ms: int) -> dict[str, Any]:
    """A valid-but-empty result for CSVs without enough numeric columns."""
    empty_matrix: dict[str, Any] = {
        "columns": [],
        "values": [],
        "pValues": [],
    }
    return {
        "pearson": empty_matrix,
        "spearman": empty_matrix,
        "topPositive": [],
        "topNegative": [],
        "topNonLinear": [],
        "regressions": [],
        "computeMs": compute_ms,
    }


# ----- JSON sanitization (mirrors descriptive.py) -----


def _sanitize_for_json(obj: Any) -> Any:
    if isinstance(obj, (float, np.floating)):
        value = float(obj)
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, dict):
        return {key: _sanitize_for_json(val) for key, val in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(item) for item in obj]
    if isinstance(obj, np.ndarray):
        return [_sanitize_for_json(item) for item in obj.tolist()]
    return obj


def _json_default(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        val = float(value)
        if math.isnan(val) or math.isinf(val):
            return None
        return val
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")
