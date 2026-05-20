"""
NiftyStats clustering engine.

Runs inside Pyodide alongside descriptive.py and relational.py. Finds
natural groupings in numeric data using k-means, picks the best k via
silhouette score, and projects the result to 2D via PCA for visualization.

Design intent:

1. Auto-pick k. We don't ask the user how many groups they want. We try
   k from K_MIN to K_MAX and pick the k with the highest silhouette
   score. If the best score is below SILHOUETTE_WEAK_THRESHOLD, the
   narrative layer will say "we couldn't find clean groups" rather than
   pretending the clusters are meaningful.

2. Standardize features. Columns with bigger units (body_mass_g around
   4000) would otherwise dominate the distance metric over columns with
   smaller units (bill_depth_mm around 17). StandardScaler puts every
   feature on the same z-score scale before clustering.

3. PCA for visualization, not for clustering. We cluster in the original
   (standardized) feature space, then project the result to 2D for the
   scatter plot. This is the standard pattern: clustering quality stays
   tied to all dimensions, the visualization is just a flat shadow.

4. Distinguishing features per cluster. The cluster's centroid is at
   some position in the standardized space. We report the centroid's
   coordinates in ORIGINAL units (for the card) plus the deviation from
   the overall mean in standard-deviation units (for the narrative).

5. Same JSON-in / JSON-out boundary as the other engines. Same sanitizer
   for NaN / Inf. Same per-pass try/except so a sklearn failure produces
   a `skippedReason` rather than blowing up the whole analyze pass.
"""

from __future__ import annotations

import json
import math
import string
from time import perf_counter
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

# Range of k values we evaluate. 2 to 8 is the practical window for the
# "natural groups in business data" use case. Below 2 is no grouping; above
# 8 the clusters get too small to interpret.
K_MIN = 2
K_MAX = 8

# Minimum sample size to attempt clustering. Below this, silhouette
# scores are too noisy to trust and clusters are too small to be useful.
# Set permissively (20) so sample-sized demo datasets cluster; the
# narrative layer flags low silhouette scores as weak signal anyway.
MIN_ROWS_FOR_CLUSTERING = 20

# Minimum number of numeric features. With only one numeric column,
# clustering reduces to univariate binning, which is better expressed as
# a histogram. With two, it's a 2D scatter which works fine.
MIN_FEATURES_FOR_CLUSTERING = 2

# How many scatter points we ship back to JS for plotting. Above 2000 the
# scatter gets visually saturated and the PDF payload grows uncomfortable.
PROJECTION_SAMPLE_LIMIT = 2000

# How many distinguishing features we surface per cluster. 3 is the
# sweet spot: enough to characterize the group, few enough to keep the
# narrative tight.
TOP_DISTINGUISHING_FEATURES = 3

# A cluster solution with silhouette below this is reported but flagged
# as weak in the narrative. Above this we describe it as "real groups."
SILHOUETTE_WEAK_THRESHOLD = 0.25

# Cluster labels we hand out: Group A, Group B, ... (loops to A1, A2 if
# we ever exceed 26, which we won't because K_MAX is 8).
CLUSTER_LABELS = list(string.ascii_uppercase)


def run_clustering(rows_json: str, columns_meta_json: str) -> str:
    """
    Top-level dispatch. Same shape as run_descriptive / run_relational.

    Returns a JSON string matching either ClusteringResult or
    ClusteringSkipped from src/types/stats.ts.
    """
    started_at = perf_counter()

    rows = json.loads(rows_json)
    columns_meta = json.loads(columns_meta_json)

    numeric_meta = [m for m in columns_meta if m["type"] == "numeric"]
    numeric_names = [m["name"] for m in numeric_meta]

    if len(rows) < MIN_ROWS_FOR_CLUSTERING:
        return _skip(
            f"Need at least {MIN_ROWS_FOR_CLUSTERING} rows to find meaningful clusters; "
            f"this dataset has {len(rows)}."
        )

    if len(numeric_names) < MIN_FEATURES_FOR_CLUSTERING:
        return _skip(
            f"Need at least {MIN_FEATURES_FOR_CLUSTERING} numeric columns to cluster; "
            f"this dataset has {len(numeric_names)}."
        )

    df = pd.DataFrame(rows)
    feature_df = _build_numeric_dataframe(df, numeric_names).dropna()
    if len(feature_df) < MIN_ROWS_FOR_CLUSTERING:
        return _skip(
            f"After dropping rows with any missing numeric value, only {len(feature_df)} "
            f"rows remain. Need at least {MIN_ROWS_FOR_CLUSTERING}."
        )

    try:
        result = _run_kmeans_pipeline(feature_df, numeric_names)
    except Exception as exc:
        return _skip(f"Clustering failed: {type(exc).__name__}: {exc}")

    result["computeMs"] = int((perf_counter() - started_at) * 1000)
    sanitized = _sanitize_for_json(result)
    return json.dumps(sanitized, allow_nan=False, default=_json_default)


def _run_kmeans_pipeline(
    feature_df: pd.DataFrame, feature_names: list[str]
) -> dict[str, Any]:
    """Standardize, sweep k, fit best k, project, build cluster summaries."""
    # Standardize features so the distance metric isn't dominated by columns
    # with larger units. We use the standardized data for clustering AND
    # the silhouette score; original values are kept for centroid reporting.
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(feature_df.values)

    # Per-feature overall mean and std in the original feature space.
    # Used later to compute "how far is this cluster's centroid from
    # everyone's average, in standard-deviation units."
    overall_mean = feature_df.mean(axis=0).values
    overall_std = feature_df.std(axis=0, ddof=1).values
    # Avoid divide-by-zero if a feature happens to be constant.
    safe_std = np.where(overall_std == 0, 1.0, overall_std)

    # Sweep k values. Silhouette needs at least 2 clusters AND fewer
    # clusters than samples, so we clamp K_MAX to (n_samples - 1) defensively.
    max_k = min(K_MAX, len(feature_df) - 1)
    k_candidates: list[dict[str, float]] = []
    best_k = K_MIN
    best_score = -float("inf")
    best_labels: np.ndarray | None = None
    best_centers_scaled: np.ndarray | None = None

    for k in range(K_MIN, max_k + 1):
        # n_init="auto" picks a sensible default per sklearn version
        # (10 for k <= 10, 1 otherwise). random_state=42 makes results
        # reproducible across re-runs on the same data.
        kmeans = KMeans(n_clusters=k, n_init="auto", random_state=42)
        labels = kmeans.fit_predict(X_scaled)

        try:
            score = float(silhouette_score(X_scaled, labels))
        except Exception:
            # Silhouette can fail on degenerate cluster assignments
            # (e.g., all points in one cluster). Skip those k's.
            continue

        k_candidates.append({"k": k, "score": score})
        if score > best_score:
            best_score = score
            best_k = k
            best_labels = labels
            best_centers_scaled = kmeans.cluster_centers_

    if best_labels is None or best_centers_scaled is None:
        raise RuntimeError("Could not fit any k between K_MIN and K_MAX.")

    # PCA to 2D for the scatter plot. Two components is the universal
    # "look at the data" projection; the variance-explained values tell
    # the user how much info is preserved.
    pca = PCA(n_components=2)
    projection = pca.fit_transform(X_scaled)
    pca_variance = pca.explained_variance_ratio_.tolist()

    # Build per-cluster summaries.
    clusters: list[dict[str, Any]] = []
    # Cluster centers in ORIGINAL feature units (un-standardize).
    centers_original = scaler.inverse_transform(best_centers_scaled)
    for cluster_id in range(best_k):
        mask = best_labels == cluster_id
        size = int(mask.sum())
        center_original = centers_original[cluster_id]

        # Distinguishing features: top 3 by |centroid - overall_mean| in
        # std units. Sign of the deviation tells direction.
        deviations = []
        for i, name in enumerate(feature_names):
            dev = (center_original[i] - overall_mean[i]) / safe_std[i]
            deviations.append(
                {
                    "feature": name,
                    "centerValue": float(center_original[i]),
                    "deviationFromMeanStd": float(dev),
                }
            )
        deviations.sort(key=lambda d: -abs(d["deviationFromMeanStd"]))
        distinguishing = deviations[:TOP_DISTINGUISHING_FEATURES]

        label_index = cluster_id % len(CLUSTER_LABELS)
        label = (
            f"Group {CLUSTER_LABELS[label_index]}"
            if cluster_id < len(CLUSTER_LABELS)
            else f"Group {cluster_id + 1}"
        )

        clusters.append(
            {
                "id": cluster_id,
                "label": label,
                "size": size,
                "sizePct": size / len(feature_df) if len(feature_df) else 0.0,
                "distinguishingFeatures": distinguishing,
            }
        )

    # Build the scatter projection. Down-sample if we exceed the cap so
    # the JSON payload and the rendered chart stay reasonable. Random
    # sampling with the same seed as KMeans so results are reproducible.
    if len(projection) > PROJECTION_SAMPLE_LIMIT:
        rng = np.random.default_rng(seed=42)
        sample_idx = rng.choice(
            len(projection), size=PROJECTION_SAMPLE_LIMIT, replace=False
        )
        sample_idx.sort()
    else:
        sample_idx = np.arange(len(projection))

    projection_points: list[dict[str, Any]] = []
    for i in sample_idx:
        projection_points.append(
            {
                "x": float(projection[i, 0]),
                "y": float(projection[i, 1]),
                "cluster": int(best_labels[i]),
            }
        )

    return {
        "k": int(best_k),
        "silhouetteScore": float(best_score),
        "kCandidates": k_candidates,
        "featureColumns": feature_names,
        "clusters": clusters,
        "pcaVarianceExplained": [float(pca_variance[0]), float(pca_variance[1])],
        "projection": projection_points,
        # computeMs is filled in by the caller.
        "computeMs": 0,
    }


def _build_numeric_dataframe(
    df: pd.DataFrame, column_names: list[str]
) -> pd.DataFrame:
    """Coerce the requested columns to numeric; mirrors descriptive/relational."""
    out: dict[str, pd.Series] = {}
    for name in column_names:
        if name not in df.columns:
            continue
        cleaned = df[name].astype(str).str.replace(",", "", regex=False)
        out[name] = pd.to_numeric(cleaned, errors="coerce")
    return pd.DataFrame(out)


def _skip(reason: str) -> str:
    payload = {"skippedReason": reason}
    return json.dumps(payload)


# ----- JSON sanitization (mirrors descriptive.py / relational.py) -----


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
