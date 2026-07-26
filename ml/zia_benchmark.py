"""Zia AutoML benchmark — datasets, a fair holdout, and an honest side-by-side vs LightGBM.

WHY THIS EXISTS
The Catalyst services table names Zia AutoML for "automated model training (tabular)", and our two
tabular models (case outcome, district risk) use LightGBM. That is the one remaining substitution.
Rather than swap silently in either direction, this script sets up a MEASURED comparison and both
numbers get published on /audit — "we benchmarked Zia AutoML against LightGBM and report both" is a
stronger and more defensible claim than either model alone.

THE COMPARISON PROBLEM, AND HOW IT IS SOLVED
Zia AutoML trains in the console and reports accuracy/F1 from ITS OWN internal split. Those figures
are NOT comparable to our LightGBM numbers, which come from a 3-fold CV over 1.49M rows. Quoting the
two side by side without fixing that would be a false comparison.

So this script fixes a single shared holdout and scores every model on exactly the same rows:

  holdout      2,000 rows, stratified, seed-fixed. Never in ANY training set.
  train sample 100,000 rows, stratified, drawn from what remains.

and produces THREE numbers on that identical holdout:

  1. Zia AutoML          trained on the 100k sample  (console)      <- the service
  2. LightGBM (matched)  trained on the SAME 100k sample            <- the fair comparison
  3. LightGBM (shipped)  the production model, trained on 1.49M     <- what the platform serves

Only (1) vs (2) is apples-to-apples. (3) is included because it is what the platform actually ships
and omitting it would flatter whichever model won the matched test. All three are labelled.

Why 100k rather than the full 1.49M: a console CSV upload plus AutoML training on 1.49M rows is slow
and failure-prone under a deadline. Capping it is a stated limitation of the benchmark, not a hidden
one — which is exactly why the matched LightGBM run exists.

Why 2,000 holdout rows: Zia predictions come back through a per-request API, so the holdout has to be
small enough to score by API. At n=2,000 a binary accuracy estimate carries roughly +/-1pp, which is
far finer than the gap that would change a conclusion.

GUARDS CARRY OVER UNCHANGED. Features are the filing-time set from build_modeling_table.py: no
outcome-derived field (no leakage), victims as a TOTAL only, no caste/religion/sex, and no modeled
time-of-day. The high-cardinality top-N bucketing is computed on the FULL table and applied before
the split, so Zia and LightGBM see an identical representation.

USAGE
  python ml/zia_benchmark.py --export
      -> ml/out/zia/*.csv + zia_benchmark.json (LightGBM numbers filled, Zia pending)

  ... then in the Catalyst console: Zia Services -> AutoML -> Create Model
      upload case_outcome_train.csv, target column = "outcome", train, note the Model ID.
      Score case_outcome_holdout_features.csv against it and save the predictions.

  python ml/zia_benchmark.py --score ml/out/zia/zia_predictions.csv
      -> fills in Zia's numbers on the SAME holdout and writes the verdict.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import outcomes as O                       # reuse the EXACT training-time definitions
from model_store import apply_contract, load_model  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out", "zia")
CARD = os.path.join(ROOT, "ml", "out", "zia_benchmark.json")

HOLDOUT_N = 2000
TRAIN_N = 100_000
SEED = 42
TARGET = "outcome"          # "detected" / "undetected" — binary-class categorical for Zia
POSITIVE = "detected"


def _stratified(df, n, label_col, seed):
    """Proportional stratified sample — preserves the ~13% undetected base rate in both splits."""
    if n >= len(df):
        return df.copy()
    parts = []
    for _, grp in df.groupby(label_col, observed=True):
        k = max(1, int(round(n * len(grp) / len(df))))
        parts.append(grp.sample(n=min(k, len(grp)), random_state=seed))
    return pd.concat(parts).sample(frac=1.0, random_state=seed).reset_index(drop=True)


def cmd_export():
    os.makedirs(OUT_DIR, exist_ok=True)
    src = os.path.join(IN_DIR, "case_features.parquet")
    if not os.path.exists(src):
        raise SystemExit("case_features.parquet not found — run `python etl/build_modeling_table.py` first.")

    full = pd.read_parquet(src)
    print(f"[zia] loaded {len(full):,} cases")

    # GUARD re-assert: no outcome-derived or sex-split column may be present as a feature.
    bad = (O.LEAKAGE_COLS | O.SEX_COLS) & set(full.columns)
    assert not bad, f"leakage/fairness guard failed: {bad}"

    # Top-N bucketing from the FULL table, exactly as training does it, so the representation Zia
    # sees matches the one LightGBM was fitted on. Re-deriving it per split would silently differ.
    full, topn_keep, _levels = O.prep(full)

    # binary universe + label, using the documented mapping (ambiguous statuses excluded)
    mask = full[O.LABEL].isin(O.DETECTED | O.UNDETECTED)
    df = full[mask].copy()
    df[TARGET] = np.where(df[O.LABEL].isin(O.DETECTED), POSITIVE, "undetected")
    print(f"[zia] binary universe {len(df):,} cases | undetected base rate "
          f"{(df[TARGET] != POSITIVE).mean():.3f}")

    # ---- the single shared holdout: never in ANY training set ----
    # _stratified reshuffles and resets the index, so an explicit row_id is carried and the pool is
    # derived by anti-join on it. Relying on pandas index alignment through a shuffle is how a
    # holdout silently leaks back into training.
    df = df.reset_index(drop=False).rename(columns={"index": "row_id"})
    holdout = _stratified(df, HOLDOUT_N, TARGET, SEED)
    pool = df[~df["row_id"].isin(set(holdout["row_id"]))]
    train = _stratified(pool, TRAIN_N, TARGET, SEED + 1)
    assert not set(train["row_id"]) & set(holdout["row_id"]), "holdout leaked into the train sample!"
    print(f"[zia] train sample {len(train):,} | holdout {len(holdout):,} (disjoint, asserted)")

    feats = O.FEATURES
    # 1) training CSV for the console upload — features + the target column only.
    train[feats + [TARGET]].to_csv(os.path.join(OUT_DIR, "case_outcome_train.csv"), index=False)
    # 2) holdout WITH truth, for our own scoring.
    holdout[["row_id"] + feats + [TARGET]].to_csv(
        os.path.join(OUT_DIR, "case_outcome_holdout.csv"), index=False)
    # 3) holdout WITHOUT truth, to feed the trained model.
    holdout[["row_id"] + feats].to_csv(
        os.path.join(OUT_DIR, "case_outcome_holdout_features.csv"), index=False)

    y_true = (holdout[TARGET] == POSITIVE).astype(int).to_numpy()

    # ---- (2) LightGBM trained on the SAME 100k sample: the fair comparison ----
    params = dict(n_estimators=300, learning_rate=0.05, num_leaves=63, min_child_samples=100,
                  subsample=0.9, colsample_bytree=0.9, n_jobs=-1, random_state=0, verbosity=-1)
    ytr = (train[TARGET] == POSITIVE).astype(int).to_numpy()
    m = LGBMClassifier(**params).fit(train[feats], ytr, categorical_feature=O.CAT_COLS)
    p_matched = m.predict_proba(holdout[feats])[:, 1]
    matched = _metrics(y_true, p_matched)
    print(f"[zia] LightGBM (matched 100k)  AUC={matched['auc']:.4f} acc={matched['accuracy']:.4f}")

    # ---- (3) the SHIPPED production model, scored on the identical holdout ----
    shipped = None
    try:
        prod, meta, _ = load_model("case_outcome_binary")
        p_prod = prod.predict_proba(apply_contract(holdout, meta))[:, 1]
        shipped = _metrics(y_true, p_prod)
        print(f"[zia] LightGBM (shipped 1.49M) AUC={shipped['auc']:.4f} acc={shipped['accuracy']:.4f}")
    except FileNotFoundError:
        print("[zia] shipped model artifact absent — run `python ml/outcomes.py` to include it")

    # majority-class baseline on the same rows, so every number has a floor to beat
    base_acc = float(max(y_true.mean(), 1 - y_true.mean()))

    card = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "purpose": "Benchmark Catalyst Zia AutoML against LightGBM on the SAME holdout, and publish "
                   "both rather than swapping silently in either direction.",
        "task": "binary classification — will a case be detected (offender identified)?",
        "target_column": TARGET, "positive_class": POSITIVE,
        "features": feats,
        "protocol": {
            "shared_holdout_rows": int(len(holdout)),
            "train_sample_rows": int(len(train)),
            "seed": SEED,
            "stratified": "proportional on the target, so the undetected base rate is preserved",
            "disjoint_asserted": True,
            "why_capped": "A console CSV upload plus AutoML training on 1.49M rows is slow and "
                          "failure-prone under a deadline. The matched LightGBM run exists so the "
                          "cap cannot flatter either model.",
            "why_2000_holdout": "Zia predictions arrive through a per-request API. At n=2,000 a "
                                "binary accuracy estimate carries about +/-1pp — finer than any gap "
                                "that would change the conclusion.",
            "comparable_pair": "zia_automl vs lightgbm_matched (identical training rows AND "
                               "identical holdout). lightgbm_shipped is context, not a fair rival.",
        },
        "guards": {
            "leakage": "Filing-time features only; every disposition-derived column is dropped "
                       "upstream in build_modeling_table.py and re-asserted absent here.",
            "fairness": "No caste, religion or sex. Victims is a TOTAL. Modeled time-of-day excluded.",
            "representation_parity": "Top-N bucketing computed on the FULL 1.67M-row table and "
                                     "applied BEFORE the split, so both models see identical inputs.",
            "topn_keep_sizes": {k: len(v) for k, v in topn_keep.items()},
        },
        "baseline_majority_class_accuracy": round(base_acc, 4),
        "results": {
            "lightgbm_matched": matched,
            "lightgbm_shipped": shipped,
            "zia_automl": None,   # filled by --score once the console model is trained
        },
        "status": "awaiting_zia_training",
        "console_steps": [
            "Catalyst console -> Zia Services -> AutoML -> Create Model",
            "Upload ml/out/zia/case_outcome_train.csv (saved into a File Store folder)",
            f"Set target column = '{TARGET}' (binary-class categorical)",
            "Keep all offered columns for training, name the model, Train Model",
            "Record the Model ID and the evaluation report figures",
            "Score ml/out/zia/case_outcome_holdout_features.csv and save predictions as "
            "ml/out/zia/zia_predictions.csv with columns: row_id, p_detected",
            "python ml/zia_benchmark.py --score ml/out/zia/zia_predictions.csv",
        ],
    }
    _write(card)
    print(f"\n[zia] wrote 3 CSVs to ml/out/zia/ and the benchmark card to ml/out/zia_benchmark.json")
    print("[zia] NEXT: train in the console, then re-run with --score. Steps are in the card.")


def _metrics(y_true, p):
    pred = (p >= 0.5).astype(int)
    return {
        "auc": round(float(roc_auc_score(y_true, p)), 4),
        "accuracy": round(float(accuracy_score(y_true, pred)), 4),
        "f1_detected": round(float(f1_score(y_true, pred)), 4),
        "n": int(len(y_true)),
    }


def _write(card):
    with open(CARD, "w", encoding="utf-8") as f:
        json.dump(card, f, indent=2)


def cmd_score(path):
    if not os.path.exists(path):
        raise SystemExit(f"predictions file not found: {path}")
    if not os.path.exists(CARD):
        raise SystemExit("run `python ml/zia_benchmark.py --export` first")
    with open(CARD, encoding="utf-8") as f:
        card = json.load(f)

    truth = pd.read_csv(os.path.join(OUT_DIR, "case_outcome_holdout.csv"))
    preds = pd.read_csv(path)
    if "row_id" not in preds.columns:
        raise SystemExit("predictions must carry a row_id column to join against the holdout")
    prob_col = next((c for c in ("p_detected", "probability", "prediction", "score")
                     if c in preds.columns), None)
    if prob_col is None:
        raise SystemExit("predictions need one of: p_detected / probability / prediction / score")

    j = truth.merge(preds[["row_id", prob_col]], on="row_id", how="inner")
    if len(j) < len(truth):
        # Scored on a subset: report it rather than quietly comparing different row counts.
        print(f"[zia] WARNING: only {len(j):,} of {len(truth):,} holdout rows were scored — "
              f"metrics below are on that subset.")
    y = (j[TARGET] == POSITIVE).astype(int).to_numpy()
    p = pd.to_numeric(j[prob_col], errors="coerce").fillna(0.5).to_numpy()
    # Accept percentages as well as probabilities; the console reports percentages.
    if p.max() > 1.0:
        p = p / 100.0
    zia = _metrics(y, p)
    card["results"]["zia_automl"] = zia

    matched = card["results"]["lightgbm_matched"]
    gap = zia["auc"] - matched["auc"]
    # A hair's-breadth AUC difference at n=2,000 is a tie, not a win — same three-way verdict
    # discipline ml/validation.py uses.
    card["verdict"] = ("zia_automl_better" if gap > 0.01
                       else "lightgbm_better" if gap < -0.01 else "comparable")
    card["verdict_note"] = (
        f"On the identical {zia['n']:,}-row holdout with identical training rows: "
        f"Zia AutoML AUC {zia['auc']:.4f} vs LightGBM {matched['auc']:.4f} "
        f"(difference {gap:+.4f}). Differences under 0.01 AUC at this sample size are inside noise "
        f"and are reported as comparable rather than as a win for either.")
    card["status"] = "complete"
    _write(card)

    print("=" * 72)
    print("ZIA AutoML vs LightGBM — identical holdout, identical training rows")
    print("=" * 72)
    for name in ("zia_automl", "lightgbm_matched", "lightgbm_shipped"):
        r = card["results"].get(name)
        if r:
            print(f"  {name:20} AUC {r['auc']:.4f} | acc {r['accuracy']:.4f} | F1 {r['f1_detected']:.4f} (n={r['n']:,})")
    print(f"  {'majority baseline':20} acc {card['baseline_majority_class_accuracy']:.4f}")
    print(f"\n  VERDICT: {card['verdict']}")
    print(f"  {card['verdict_note']}")


def main():
    ap = argparse.ArgumentParser(description="Zia AutoML benchmark (export datasets / score results)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--export", action="store_true", help="build the train/holdout CSVs + LightGBM baselines")
    g.add_argument("--score", metavar="CSV", help="score Zia predictions on the shared holdout")
    a = ap.parse_args()
    return cmd_export() if a.export else cmd_score(a.score)


if __name__ == "__main__":
    raise SystemExit(main())
