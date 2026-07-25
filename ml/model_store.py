"""Serialized model registry — save/load trained estimators WITH their inference contract.

WHY THIS EXISTS
The live platform never runs ML at request time: `crime_api` is a Node service that reads
precomputed tables, so a Python pickle could not be loaded there even in principle. Result tables
remain the serving path. Serialized models exist for the three things tables cannot do:

  1. SCORE NEW, UNSEEN CASES — "an FIR was just filed; is it likely to be detected?" Without a
     saved model that answer costs a full 1.67M-row retrain (~2.7 min); with one it is instant.
  2. AUDIT / REPRODUCIBILITY — a reviewer can load the exact artifact behind a published metric.
  3. VERSIONING — compare a retrained model against the one that produced the shipped numbers.

WHY THE METADATA MATTERS AS MUCH AS THE ESTIMATOR
The classic serving-skew bug is saving only the estimator. These models depend on preprocessing
that MUST be reproduced byte-for-byte at inference:
  * `outcomes.py` buckets high-cardinality columns to the top-N values seen in TRAINING (the rest
    become "OTHER"). Re-deriving top-N from new data would silently shift the encoding.
  * LightGBM categorical features are encoded by pandas `category` dtype ORDER. New data with a
    different level order produces wrong predictions with no error raised.
So every bundle carries `features`, `categorical_features`, `category_levels` and `topn_keep`,
and `apply_contract()` re-applies them. Inference never re-derives anything from the new data.

Layout:  ml/models/<name>.joblib   +   ml/models/registry.json  (human-readable index)
Run:     imported by the model scripts; see ml/predict.py for the inference CLI.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import joblib
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODEL_DIR = os.path.join(ROOT, "ml", "models")
REGISTRY = os.path.join(MODEL_DIR, "registry.json")
FORMAT_VERSION = 1


def _lib_versions():
    v = {}
    for mod in ("sklearn", "lightgbm", "pandas", "numpy"):
        try:
            v[mod] = __import__(mod).__version__
        except Exception:
            pass
    return v


def save_model(name, estimator, *, features, categorical_features=None, category_levels=None,
               topn_keep=None, metrics=None, training_rows=None, task=None, notes=None,
               extra=None):
    """Persist an estimator plus everything needed to score new data identically.

    category_levels: {column: [ordered levels]} — the EXACT pandas category order used in training.
    topn_keep:       {column: [kept values]}    — training-time top-N sets; others map to "OTHER".
    extra:           any additional fitted objects (e.g. an SVD transformer, cluster centroids).
    """
    os.makedirs(MODEL_DIR, exist_ok=True)
    meta = {
        "name": name,
        "format_version": FORMAT_VERSION,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "task": task,
        "estimator_class": f"{type(estimator).__module__}.{type(estimator).__name__}",
        "library_versions": _lib_versions(),
        "features": list(features),
        "categorical_features": list(categorical_features or []),
        "category_levels": {k: list(v) for k, v in (category_levels or {}).items()},
        "topn_keep": {k: list(v) for k, v in (topn_keep or {}).items()},
        "metrics": metrics or {},
        "training_rows": training_rows,
        "notes": notes,
        "guards": {
            "leakage": "No outcome-derived field is a feature (arrested / chargesheeted / "
                       "conviction counts are dropped upstream in build_modeling_table.py).",
            "fairness": "No protected attributes or proxies: victims is a TOTAL (never sex-split); "
                        "no caste or religion; modeled time-of-day is excluded from supervised models.",
        },
    }
    path = os.path.join(MODEL_DIR, f"{name}.joblib")
    joblib.dump({"meta": meta, "model": estimator, "extra": extra or {}}, path, compress=3)
    _update_registry(name, meta, path)
    print(f"[model_store] saved {name} -> ml/models/{name}.joblib "
          f"({os.path.getsize(path)/1024:.0f} KB)")
    return path


def _update_registry(name, meta, path):
    reg = {}
    if os.path.exists(REGISTRY):
        try:
            with open(REGISTRY, encoding="utf-8") as f:
                reg = json.load(f)
        except ValueError:
            reg = {}
    reg.setdefault("note", "Serialized models for offline inference on NEW cases. The live API "
                           "(Node) never loads these — it serves precomputed tables.")
    reg.setdefault("models", {})
    reg["models"][name] = {
        "file": os.path.relpath(path, ROOT).replace("\\", "/"),
        "task": meta["task"],
        "estimator": meta["estimator_class"],
        "created_utc": meta["created_utc"],
        "features": len(meta["features"]),
        "training_rows": meta["training_rows"],
        "metrics": meta["metrics"],
        "size_kb": round(os.path.getsize(path) / 1024),
    }
    reg["updated_utc"] = datetime.now(timezone.utc).isoformat()
    with open(REGISTRY, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2)


def load_model(name):
    """Return (estimator, meta, extra). Raises a clear error if the artifact is absent."""
    path = os.path.join(MODEL_DIR, f"{name}.joblib")
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"No serialized model '{name}' at ml/models/. Train it first "
            f"(e.g. `python ml/outcomes.py`), which saves the artifact automatically.")
    b = joblib.load(path)
    return b["model"], b["meta"], b.get("extra", {})


def apply_contract(df, meta):
    """Re-apply the TRAINING preprocessing contract to new data.

    Order matters and mirrors training exactly: top-N bucketing first, then fixed category levels,
    then numeric coercion, then column selection. Values unseen in training become NaN inside the
    declared categories (LightGBM handles that natively) rather than silently inventing a new code.
    """
    out = df.copy()
    for col, keep in meta.get("topn_keep", {}).items():
        if col in out.columns:
            out[col] = out[col].astype(str).where(out[col].astype(str).isin(set(keep)), "OTHER")
    for col, levels in meta.get("category_levels", {}).items():
        if col in out.columns:
            out[col] = pd.Categorical(out[col].astype(str), categories=list(levels))
    for col in meta["features"]:
        if col not in out.columns:
            raise ValueError(f"new data is missing required feature '{col}'")
        if col not in meta.get("category_levels", {}):
            out[col] = pd.to_numeric(out[col], errors="coerce").fillna(0)
    return out[meta["features"]]


def list_models():
    if not os.path.exists(REGISTRY):
        return {}
    with open(REGISTRY, encoding="utf-8") as f:
        return json.load(f).get("models", {})
