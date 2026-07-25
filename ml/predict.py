"""Offline inference CLI — score NEW cases with the serialized models.

This is what the saved artifacts unlock. The live platform serves precomputed tables (the Node
API cannot load a Python model), so this tool covers the thing tables cannot do: answering a
question about a case that did not exist when the tables were built.

    "An FIR was just filed in Belagavi — theft, 2 accused, GPS recorded.
     Is it likely to be detected?"

Commands
    python ml/predict.py --list                 what is in the registry
    python ml/predict.py --verify               serving-skew check (see below)
    python ml/predict.py --case "district=Belagavi,crime_head=THEFT,accused_count=2"
    python ml/predict.py --cases new_firs.csv   batch score a CSV -> predictions.csv

WHY --verify MATTERS
The dangerous failure mode for a saved model is silent: preprocessing at inference drifts from
preprocessing at training (different top-N buckets, different category order), and the model
returns confident nonsense with no error. `--verify` scores the same rows down BOTH paths -
the training-time preprocessing and the saved contract - and asserts the predictions are
identical. If that ever diverges, the artifact is unsafe to use.

All predictions inherit the training guards: no outcome-derived features (no leakage) and no
protected attributes (no caste/religion/sex). Outputs are PROBABILITIES, not verdicts - they
describe statistical patterns in historical FIRs, and must never be used to judge an individual.
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model_store import MODEL_DIR, apply_contract, list_models, load_model  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CASE_FEATURES = os.path.join(ROOT, "etl", "out", "case_features.parquet")

# A neutral, realistic default case; --case overrides only the fields you name.
DEFAULT_CASE = {
    "year": 2024, "month": 6, "dow": 2, "season": "Monsoon",
    "district": "Bengaluru Urban", "crime_head": "THEFT",
    "crime_subhead": "Other Items Not Included Above", "gravity": "Non-Heinous",
    "complaint_mode": "Written", "first_act": "IPC 1860", "first_section": "379",
    "victims": 1, "accused_count": 1, "has_coord": 1,
}
NUMERIC = {"year", "month", "dow", "victims", "accused_count", "has_coord"}


def cmd_list():
    models = list_models()
    if not models:
        print("No serialized models. Train them first:")
        print("   python ml/outcomes.py   python ml/risk.py   python ml/anomaly.py")
        return 1
    print(f"Serialized models in {os.path.relpath(MODEL_DIR, ROOT)}:\n")
    for name, m in models.items():
        print(f"  {name}")
        print(f"     task     : {m['task']}")
        print(f"     estimator: {m['estimator']}  ({m['size_kb']} KB, {m['features']} features)")
        print(f"     trained  : {m['training_rows']:,} rows @ {m['created_utc'][:19]}Z")
        print(f"     metrics  : {m['metrics']}")
    return 0


def cmd_verify(n=20000):
    """Serving-skew check: training-time preprocessing vs the saved contract must agree exactly.

    Path A must reproduce TRAINING preprocessing, which derived its top-N buckets and category
    order from the FULL 1.67M-row table. Running `prep()` on a small sample instead would
    re-derive different buckets and produce a false mismatch — so the full table is prepped and
    the sample rows are then selected from it.
    """
    if not os.path.exists(CASE_FEATURES):
        print("case_features.parquet not found — run `python etl/build_modeling_table.py` first.")
        return 1
    import outcomes as O   # reuse the exact training-time preprocessing

    full = pd.read_parquet(CASE_FEATURES)
    idx = full.sample(n=n, random_state=7).index
    raw = full.loc[idx].copy()               # untouched rows, as a caller would supply them

    model, meta, _ = load_model("case_outcome_binary")

    # Path A — training-time preprocessing (top-N from the FULL table, exactly as in training)
    prepped_full, _keep, _levels = O.prep(full.copy())
    pred_a = model.predict_proba(prepped_full.loc[idx, meta["features"]])[:, 1]

    # Path B — the saved contract alone, applied to the raw rows
    pred_b = model.predict_proba(apply_contract(raw, meta))[:, 1]

    same_label = float(np.mean((pred_a >= 0.5) == (pred_b >= 0.5)))
    max_gap = float(np.max(np.abs(pred_a - pred_b)))
    corr = float(np.corrcoef(pred_a, pred_b)[0, 1])

    print(f"Serving-skew check on {n:,} real rows")
    print(f"   identical decisions : {same_label*100:.2f}%")
    print(f"   max probability gap : {max_gap:.4f}")
    print(f"   correlation         : {corr:.6f}")
    if same_label == 1.0 and max_gap < 1e-9:
        print("   VERDICT: EXACT MATCH — the saved contract reproduces training preprocessing.")
        return 0
    if same_label >= 0.9999 and max_gap < 1e-6:
        print("   VERDICT: EQUIVALENT — differences are below float noise.")
        return 0
    print("   VERDICT: DIVERGENT — do NOT use this artifact until preprocessing is aligned.")
    return 2


def parse_case(spec):
    case = dict(DEFAULT_CASE)
    if spec:
        for part in spec.split(","):
            if "=" not in part:
                raise SystemExit(f"bad --case fragment '{part}' (expected key=value)")
            k, v = part.split("=", 1)
            k, v = k.strip(), v.strip()
            if k not in DEFAULT_CASE:
                raise SystemExit(f"unknown field '{k}'. Valid: {', '.join(DEFAULT_CASE)}")
            case[k] = int(v) if k in NUMERIC else v
    return case


def score_frame(df):
    """Score a frame of case-like rows with both outcome models."""
    mb, meta_b, _ = load_model("case_outcome_binary")
    mc, meta_c, _ = load_model("case_outcome_multiclass")
    p_det = mb.predict_proba(apply_contract(df, meta_b))[:, 1]
    stage = mc.predict(apply_contract(df, meta_c))
    out = df.copy()
    out["p_detected"] = np.round(p_det, 4)
    out["likely_stage"] = stage
    return out


def cmd_case(spec):
    case = parse_case(spec)
    row = score_frame(pd.DataFrame([case])).iloc[0]
    p = float(row["p_detected"])
    print("\nCASE")
    for k in ("district", "crime_head", "crime_subhead", "first_section", "gravity",
              "victims", "accused_count", "has_coord"):
        print(f"   {k:16} {case[k]}")
    band = "likely detected" if p >= 0.9 else "probably detected" if p >= 0.7 else \
           "uncertain" if p >= 0.5 else "at risk of going undetected"
    # never print 100% — a probability model is never certain, and rounding 0.9996 up to
    # "100.0%" would overstate it in exactly the place a reader is most likely to trust it.
    shown = ">99.9%" if p > 0.999 else f"{p:.1%}"
    print("\nPREDICTION")
    print(f"   P(detected)      {shown}  — {band}")
    print(f"   likely stage     {row['likely_stage']}")
    if case["accused_count"] > 0:
        print(f"   (an FIR naming {case['accused_count']} accused already implies the offender is "
              f"identified,\n    which is most of this signal — compare accused_count=0 for the "
              f"genuine cold-case view)")
    print("\n   Statistical pattern from historical FIRs (AUC 0.969). Describes case ATTRIBUTES —")
    print("   crime type, section, area — never a person. Not a judgement about anyone involved.")
    return 0


def cmd_cases(path):
    if not os.path.exists(path):
        print(f"file not found: {path}")
        return 1
    df = pd.read_csv(path)
    for k, v in DEFAULT_CASE.items():        # fill any columns the caller omitted
        if k not in df.columns:
            df[k] = v
    scored = score_frame(df)
    out = os.path.splitext(path)[0] + "_predictions.csv"
    scored.to_csv(out, index=False)
    print(f"scored {len(scored):,} cases -> {out}")
    print(f"   mean P(detected) {scored['p_detected'].mean():.3f} | "
          f"flagged at-risk (<0.5): {(scored['p_detected'] < 0.5).sum():,}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Score new cases with the serialized models")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--list", action="store_true", help="show the model registry")
    g.add_argument("--verify", action="store_true", help="serving-skew check on real rows")
    g.add_argument("--case", nargs="?", const="", help='e.g. "district=Belagavi,crime_head=THEFT"')
    g.add_argument("--cases", metavar="CSV", help="batch-score a CSV of case rows")
    a = ap.parse_args()
    if a.list:
        return cmd_list()
    if a.verify:
        return cmd_verify()
    if a.cases:
        return cmd_cases(a.cases)
    return cmd_case(a.case)


if __name__ == "__main__":
    raise SystemExit(main())
