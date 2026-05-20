"""
NiftyStats time-series engine.

Runs inside Pyodide alongside the other engines. Detects time-series
shapes in the data (one row per datetime, ordered by a datetime column)
and produces a linear trend + forecast for each numeric column.

Design intent:

1. No new Pyodide packages. We rely on numpy, pandas, and scipy (all
   already loaded). statsmodels (the natural home for seasonal_decompose,
   Holt-Winters, ARIMA) is intentionally avoided to keep cold-load size
   manageable. Trend + forecast covers the "where is this going" demo
   question; richer decomposition is a v5 item if real users ask for it.

2. Conservative detection. Only analyze a (datetime, value) pair when:
   - The dataset has a datetime column.
   - Each row has a unique datetime (one observation per time point).
   - At least 10 valid points after dropping missing.
   - The series has variation to fit a trend (non-constant values).

3. Linear regression for trend. We use scipy.stats.linregress to fit
   value ~ day_index, which gives us slope, intercept, R², and a usable
   p-value. The R² doubles as a confidence indicator: high R² means the
   forecast band is tight; low R² widens the band.

4. Forecast with 95% prediction interval. We extrapolate the linear fit
   forward by 25% of historical length (capped at 12 periods) and
   widen the interval using the residual standard error. Plain OLS
   prediction-interval math, no fancy structures.
"""

from __future__ import annotations

import json
import math
from datetime import timedelta
from time import perf_counter
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

# Minimum points required for a trustworthy trend fit. Fewer and the slope
# becomes wildly sensitive to individual points.
MIN_TS_POINTS = 10

# Forecast horizon is min(MAX_FORECAST_POINTS, 25% of historical length).
# Hard cap keeps the visual readable on wide CSVs.
MAX_FORECAST_POINTS = 12
FORECAST_PCT = 0.25

# Z-score for a 95% prediction interval under the normal-residuals
# assumption. We use the standard 1.96 multiplier; for small samples this
# slightly under-estimates the interval, but the resulting band is still
# directionally honest about the level of forecast uncertainty.
Z_95 = 1.96

# Cadence-detection bands. Median gap in days falls into one of these
# buckets; the label feeds the narrative ("weekly cadence" reads cleaner
# than "median gap of 7.0 days").
CADENCE_BUCKETS = [
    (1.5, "daily"),
    (9.0, "weekly"),
    (45.0, "monthly"),
    (130.0, "quarterly"),
    (400.0, "yearly"),
]


def run_timeseries(rows_json: str, columns_meta_json: str) -> str:
    """
    Top-level dispatch. Same JSON-in / JSON-out contract as the other
    engines. Returns TimeSeriesResult shape from src/types/stats.ts.
    """
    started_at = perf_counter()

    rows = json.loads(rows_json)
    columns_meta = json.loads(columns_meta_json)

    df = pd.DataFrame(rows)
    datetime_cols = [m["name"] for m in columns_meta if m["type"] == "datetime"]
    numeric_cols = [m["name"] for m in columns_meta if m["type"] == "numeric"]

    if not datetime_cols:
        return _skip("No datetime column detected; need one to track values over time.")
    if not numeric_cols:
        return _skip("No numeric columns to track over time.")

    serieses: list[dict[str, Any]] = []
    for dt_col in datetime_cols:
        # Parse the datetime column once per datetime candidate.
        parsed_dt = pd.to_datetime(df[dt_col], errors="coerce")
        if parsed_dt.isna().all():
            continue
        if parsed_dt.dropna().nunique() < MIN_TS_POINTS:
            continue
        # Skip if the same datetime appears multiple times: that's a
        # cross-section by date, not a time-series. (Future: aggregate
        # rows per period before fitting; deferring as v5 territory.)
        non_null_dt = parsed_dt.dropna()
        if non_null_dt.nunique() < len(non_null_dt) * 0.95:
            continue

        for value_col in numeric_cols:
            try:
                analysis = _analyze_pair(df, dt_col, value_col, parsed_dt)
                if analysis is not None:
                    serieses.append(analysis)
            except Exception:
                # Per-pair try/except so one bad column doesn't kill all
                # the time-series analyses. Silent skip is fine here; the
                # column will still appear in the descriptive section.
                continue

    compute_ms = int((perf_counter() - started_at) * 1000)
    payload: dict[str, Any] = {
        "serieses": serieses,
        "skippedReason": None if serieses else "No analyzable time-series found in this dataset.",
        "computeMs": compute_ms,
    }
    sanitized = _sanitize_for_json(payload)
    return json.dumps(sanitized, allow_nan=False, default=_json_default)


def _analyze_pair(
    df: pd.DataFrame,
    dt_col: str,
    value_col: str,
    parsed_dt: pd.Series,
) -> dict[str, Any] | None:
    """Fit trend + forecast for one (datetime, value) pair."""
    # Coerce the value column to numeric, mirroring the descriptive engine.
    cleaned_value = df[value_col].astype(str).str.replace(",", "", regex=False)
    parsed_value = pd.to_numeric(cleaned_value, errors="coerce")

    # Build a clean two-column frame, drop rows with missing in either.
    paired = pd.DataFrame({"dt": parsed_dt, "value": parsed_value}).dropna()
    if len(paired) < MIN_TS_POINTS:
        return None
    if paired["value"].nunique() < 2:
        # Constant series: nothing to fit.
        return None

    # Sort by datetime so the index represents time progression.
    paired = paired.sort_values("dt").reset_index(drop=True)
    # Convert dates to integer day offsets from the first date. This makes
    # the slope interpretable as "value change per day" and avoids the
    # numerical instability of fitting against raw timestamps.
    first_date = paired["dt"].iloc[0]
    day_index = (paired["dt"] - first_date).dt.total_seconds() / 86400.0

    x = day_index.values.astype(float)
    y = paired["value"].values.astype(float)

    fit = scipy_stats.linregress(x, y)
    slope = float(fit.slope)
    intercept = float(fit.intercept)
    r_squared = float(fit.rvalue ** 2)

    predicted = slope * x + intercept
    residuals = y - predicted
    # Degrees of freedom = n - 2 (two parameters: slope, intercept).
    dof = max(len(y) - 2, 1)
    residual_std = float(np.sqrt(np.sum(residuals ** 2) / dof))

    # Cadence detection from median gap between consecutive observations.
    diffs_days = paired["dt"].diff().dropna().dt.total_seconds() / 86400.0
    median_gap = float(diffs_days.median()) if not diffs_days.empty else float("nan")
    cadence_label = _cadence_label(median_gap)

    # Forecast horizon: 25% of history, capped.
    horizon = min(MAX_FORECAST_POINTS, max(1, int(len(y) * FORECAST_PCT)))

    last_day = float(x[-1])
    forecast_x = np.array(
        [last_day + median_gap * (i + 1) for i in range(horizon)],
        dtype=float,
    )
    forecast_values = slope * forecast_x + intercept

    # 95% prediction interval. The width grows slightly with distance from
    # the mean of x (textbook OLS interval), but for short horizons the
    # variation is small enough that we use a constant Z*SE for clarity.
    interval_half = Z_95 * residual_std
    forecast_lower = forecast_values - interval_half
    forecast_upper = forecast_values + interval_half

    # Build ISO date strings for both historical and forecast points.
    historical_dates = [d.isoformat() for d in paired["dt"]]
    if math.isnan(median_gap) or median_gap <= 0:
        # Defensive: shouldn't happen given the upstream checks, but if it
        # does, fall back to one-day spacing for the forecast dates.
        median_gap = 1.0
    forecast_dates = [
        (paired["dt"].iloc[-1] + timedelta(days=median_gap * (i + 1))).isoformat()
        for i in range(horizon)
    ]

    return {
        "datetimeColumn": dt_col,
        "valueColumn": value_col,
        "nObservations": int(len(y)),
        "historicalDates": historical_dates,
        "historicalValues": [float(v) for v in y],
        "trendSlope": slope,
        "trendIntercept": intercept,
        "trendRSquared": r_squared,
        "residualStd": residual_std,
        "medianGapDays": median_gap,
        "cadenceLabel": cadence_label,
        "forecastDates": forecast_dates,
        "forecastValues": [float(v) for v in forecast_values],
        "forecastLower95": [float(v) for v in forecast_lower],
        "forecastUpper95": [float(v) for v in forecast_upper],
    }


def _cadence_label(median_gap_days: float) -> str:
    """Bucket the median gap into a human-friendly cadence label."""
    if math.isnan(median_gap_days) or median_gap_days <= 0:
        return "irregular"
    for threshold, label in CADENCE_BUCKETS:
        if median_gap_days <= threshold:
            return label
    return "irregular"


def _skip(reason: str) -> str:
    payload = {
        "serieses": [],
        "skippedReason": reason,
        "computeMs": 0,
    }
    return json.dumps(payload)


# ----- JSON sanitization (mirrors the other engines) -----


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
