"""Phase 4 - Supervised case-outcome model (offline, LightGBM).

Reads etl/out/case_features.parquet (one row per FIR) and trains two models on the
disposition label ``fir_stage``:

  1. MULTI-CLASS  - predict the full FIR_Stage (13 classes). Headline: accuracy + macro-F1,
     beaten against the majority-class baseline.
  2. BINARY       - detected vs undetected (the actionable "will this case be solved?"
     headline). Reported as ROC-AUC (threshold-free, honest under class imbalance) +
     accuracy vs the majority baseline, with 3-fold stratified CV.

TWO CORRECTNESS GUARDS (asserted, not just claimed):
  * LEAKAGE: features are the filing-time attributes only. Every outcome-derived column
    (Arrested*/ChargeSheeted/Conviction counts) was already dropped upstream in
    build_modeling_table.py and is re-asserted absent here. Any >95% headline is treated
    as leakage and investigated (see accused_count proxy check in the log).
  * FAIRNESS: no protected attribute/proxy - victims is a TOTAL (never sex-split), no
    caste/religion, and the modeled time-of-day is NOT used (it is a function of crime type).

Binary label mapping (documented):
  undetected(0) = {Undetected, Un Traced}         -- offender never identified
  detected(1)   = {Pending Trial, Convicted, Dis/Acq, BoundOver, Traced, Compounded,
                   Other Disposal, Abated}          -- offender identified / case progressed
  excluded from the binary model (ambiguous label, not a detection outcome):
                  {Under Investigation (still open), False Case (no crime), Transferred}

Outputs -> ml/out/
  outcome_drivers.csv     feature importances (framed as ASSOCIATIONS, not causation)
  outcome_metrics.json    model cards (metrics, baselines beaten, holdout, leakage+fairness)
  outcomes_by_district.csv per-district detection/conviction analytics (model's clean defn)

Run:  python ml/outcomes.py            (full)
      python ml/outcomes.py --frac 0.1 (debug on a 10% sample)
"""
from __future__ import annotations

import argparse
import json
import os
import time
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split

warnings.filterwarnings("ignore")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out")

LABEL = "fir_stage"
LEAKAGE_COLS = {"arrested_count", "arrested_male", "arrested_female",
                "chargesheeted_count", "conviction_count"}
SEX_COLS = {"v_male", "v_female", "v_boy", "v_girl"}
CAT_COLS = ["season", "district", "crime_head", "crime_subhead", "gravity",
            "complaint_mode", "first_act", "first_section"]
NUM_COLS = ["year", "month", "dow", "victims", "accused_count", "has_coord"]
FEATURES = CAT_COLS + NUM_COLS

# high-cardinality categoricals -> bucket to top-N, rest = OTHER (control overfit + speed)
TOPN = {"crime_subhead": 60, "first_act": 40, "first_section": 60}

UNDETECTED = {"Undetected", "Un Traced"}
DETECTED = {"Pending Trial", "Convicted", "Dis/Acq", "BoundOver", "Traced",
            "Compounded", "Other Disposal", "Abated"}
BINARY_EXCLUDED = {"Under Investigation", "False Case", "Transferred"}

LEAK_THRESHOLD = 0.95  # any headline above this on filing-time features => suspect leakage


def bucket_topn(s: pd.Series, n: int) -> pd.Series:
    keep = set(s.value_counts().nlargest(n).index)
    return s.where(s.isin(keep), "OTHER")


def prep(df):
    for c, n in TOPN.items():
        df[c] = bucket_topn(df[c].astype(str), n)
    for c in CAT_COLS:
        df[c] = df[c].astype("category")
    for c in NUM_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frac", type=float, default=1.0, help="sample fraction for debug runs")
    args = ap.parse_args()
    t0 = time.time()
    os.makedirs(OUT_DIR, exist_ok=True)

    df = pd.read_parquet(os.path.join(IN_DIR, "case_features.parquet"))
    if args.frac < 1.0:
        df = df.sample(frac=args.frac, random_state=0).reset_index(drop=True)
    print(f"[outcomes] loaded {len(df):,} cases, {len(FEATURES)} features  ({time.time()-t0:.0f}s)")

    # --- GUARD: leakage/fairness columns must not be present as features ---
    present_bad = (LEAKAGE_COLS | SEX_COLS) & set(df.columns)
    assert not present_bad, f"LEAKAGE/FAIRNESS guard failed: {present_bad} present in features!"
    assert "modeled_time_of_day" not in FEATURES, "modeled time-of-day must not be a feature"
    df = prep(df)
    X = df[FEATURES]

    params = dict(n_estimators=300, learning_rate=0.05, num_leaves=63, min_child_samples=100,
                  subsample=0.9, colsample_bytree=0.9, n_jobs=-1, random_state=0, verbosity=-1)

    # =================== 1) MULTI-CLASS fir_stage ===================
    y = df[LABEL].astype("category")
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=0)
    mc = LGBMClassifier(**params).fit(Xtr, ytr, categorical_feature=CAT_COLS)
    pred = mc.predict(Xte)
    acc = accuracy_score(yte, pred)
    mf1 = f1_score(yte, pred, average="macro")
    # majority-class baseline
    maj = ytr.value_counts().idxmax()
    base_acc = accuracy_score(yte, np.full(len(yte), maj))
    base_mf1 = f1_score(yte, np.full(len(yte), maj), average="macro")
    print(f"[outcomes] MULTICLASS ({y.nunique()} classes): acc={acc:.3f} macroF1={mf1:.3f} "
          f"| baseline acc={base_acc:.3f} macroF1={base_mf1:.3f}")

    # =================== 2) BINARY detected vs undetected ===================
    mask = df[LABEL].isin(DETECTED | UNDETECTED)
    dfb = df[mask].copy()
    yb = dfb[LABEL].isin(DETECTED).astype(int).to_numpy()   # 1=detected, 0=undetected
    Xb = dfb[FEATURES]
    base_rate_undet = 1 - yb.mean()

    # accused_count proxy / leakage sanity: is accused_count near-deterministic of the label?
    accd = dfb.groupby(yb)["accused_count"].mean()
    coordd = dfb.groupby(yb)["has_coord"].mean()

    skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=0)
    aucs, accs = [], []
    for tr, te in skf.split(Xb, yb):
        m = LGBMClassifier(**params).fit(Xb.iloc[tr], yb[tr], categorical_feature=CAT_COLS)
        p = m.predict_proba(Xb.iloc[te])[:, 1]
        aucs.append(roc_auc_score(yb[te], p))
        accs.append(accuracy_score(yb[te], (p >= 0.5).astype(int)))
    auc_mean, auc_std = float(np.mean(aucs)), float(np.std(aucs))
    acc_mean = float(np.mean(accs))
    base_acc_bin = max(yb.mean(), 1 - yb.mean())   # predict majority (detected)
    print(f"[outcomes] BINARY detected/undetected: AUC={auc_mean:.3f}+/-{auc_std:.3f} "
          f"acc={acc_mean:.3f} | baseline acc={base_acc_bin:.3f} "
          f"(undetected base rate {base_rate_undet:.3f})")
    print(f"[outcomes] proxy check -> mean accused_count: undetected={accd.get(0,float('nan')):.2f} "
          f"detected={accd.get(1,float('nan')):.2f} | mean has_coord: "
          f"undetected={coordd.get(0,float('nan')):.2f} detected={coordd.get(1,float('nan')):.2f}")

    leakage_flag = (acc > LEAK_THRESHOLD) or (auc_mean > 0.99)
    print(f"[outcomes] LEAKAGE CHECK: multiclass acc {acc:.3f} / binary AUC {auc_mean:.3f} "
          f"-> {'!! SUSPECT' if leakage_flag else 'OK (no outcome-derived features)'}")

    # --- final full-data binary model for driver importances (gain) ---
    mb = LGBMClassifier(**params).fit(Xb, yb, categorical_feature=CAT_COLS)

    # =================== feature importances (ASSOCIATIONS) ===================
    def norm_gain(model):
        g = np.asarray(model.booster_.feature_importance(importance_type="gain"), float)
        g = g / g.sum() if g.sum() else g
        return dict(zip(FEATURES, g))
    gmc, gb = norm_gain(mc), norm_gain(mb)
    drivers = pd.DataFrame({
        "feature": FEATURES,
        "importance_detection_pct": [round(100 * gb[f], 2) for f in FEATURES],
        "importance_multiclass_pct": [round(100 * gmc[f], 2) for f in FEATURES],
    }).sort_values("importance_detection_pct", ascending=False).reset_index(drop=True)
    drivers.to_csv(os.path.join(OUT_DIR, "outcome_drivers.csv"), index=False)

    # =================== per-district outcome analytics ===================
    dim = pd.read_csv(os.path.join(IN_DIR, "dim_district.csv"), dtype=str)
    kgis_of = {}
    for _, r in dim[dim["is_geographic"].astype(str).str.lower() == "true"].iterrows():
        p = r["parent_district"] or r["canonical_name"]
        if p not in kgis_of and isinstance(r["kgis_code"], str) and r["kgis_code"]:
            kgis_of[p] = r["kgis_code"]
    rows = []
    for dist, sub in df.groupby("district", observed=True):
        n = len(sub)
        clean = sub[sub[LABEL].isin(DETECTED | UNDETECTED)]
        det = clean[LABEL].isin(DETECTED).sum()
        undet = clean[LABEL].isin(UNDETECTED).sum()
        convicted = (sub[LABEL] == "Convicted").sum()
        rows.append([dist, kgis_of.get(dist, ""), n, int(det), int(undet),
                     round(det / (det + undet), 4) if (det + undet) else 0.0,
                     int(convicted), round(convicted / n, 4) if n else 0.0])
    od = pd.DataFrame(rows, columns=["district", "kgis_code", "cases", "detected", "undetected",
                                     "detection_rate", "convicted", "conviction_rate"])
    od = od.sort_values("cases", ascending=False).reset_index(drop=True)
    od.to_csv(os.path.join(OUT_DIR, "outcomes_by_district.csv"), index=False)

    # =================== model cards ===================
    metrics = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "data_class": "real",
        "n_cases": int(len(df)),
        "features": FEATURES,
        "multiclass": {
            "target": "fir_stage", "classes": int(y.nunique()),
            "holdout": "stratified 80/20", "accuracy": round(acc, 4), "macro_f1": round(mf1, 4),
            "baseline_majority_class": maj,
            "baseline_accuracy": round(base_acc, 4), "baseline_macro_f1": round(base_mf1, 4),
            "beats_baseline": bool(mf1 > base_mf1 and acc > base_acc),
        },
        "binary_detection": {
            "mapping": {"undetected": sorted(UNDETECTED), "detected": sorted(DETECTED),
                        "excluded": sorted(BINARY_EXCLUDED)},
            "n": int(mask.sum()), "undetected_base_rate": round(float(base_rate_undet), 4),
            "cv": "3-fold stratified", "auc_mean": round(auc_mean, 4), "auc_std": round(auc_std, 4),
            "accuracy": round(acc_mean, 4), "baseline_accuracy": round(float(base_acc_bin), 4),
            "beats_baseline": bool(auc_mean > 0.5 and acc_mean >= base_acc_bin),
            "accused_count_proxy_check": {
                "mean_accused_undetected": round(float(accd.get(0, np.nan)), 3),
                "mean_accused_detected": round(float(accd.get(1, np.nan)), 3),
            },
        },
        "leakage_check": {
            "excluded_features": sorted(LEAKAGE_COLS),
            "threshold": LEAK_THRESHOLD, "flagged": bool(leakage_flag),
            "note": "No outcome-derived field is a feature; accused_count/victims are filing-time totals.",
        },
        "fairness": "No protected attributes/proxies: victims is a TOTAL (never sex-split); "
                    "no caste/religion; modeled time-of-day excluded (circular with crime type).",
        "interpretation": "Feature importances are ASSOCIATIONS with the outcome, not causal effects.",
    }
    with open(os.path.join(OUT_DIR, "outcome_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print("\n--- MODEL CARD: case-outcome ---")
    print(f"  multiclass  acc {acc:.3f} (base {base_acc:.3f}) | macroF1 {mf1:.3f} (base {base_mf1:.3f})")
    print(f"  binary      AUC {auc_mean:.3f}+/-{auc_std:.3f} (base acc {base_acc_bin:.3f})")
    print(f"  top drivers : {', '.join(drivers['feature'].head(5))}")
    print(f"  leakage flag: {leakage_flag} | fairness: sex/caste/religion excluded")
    print(f"[outcomes] wrote outcome_drivers.csv, outcome_metrics.json, outcomes_by_district.csv "
          f"({len(od)} districts)  [{time.time()-t0:.0f}s]")


if __name__ == "__main__":
    main()
