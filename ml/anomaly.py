"""Phase 3 - Anomaly detection on district x category monthly counts (offline).

Flags unusual month/district/category observations vs a seasonal expectation, using an
IsolationForest on scale-free features (standardised residual z + log ratio) combined with
a statistical z-score rule. Scale-free features keep big districts from dominating.

Baseline "expected" = mean of the same calendar month across 2016-2023 for that
district x category. 2024 is excluded (partial year -> false "low" anomalies).

Validation: inject synthetic spikes into a copy of the data, re-run detection, report
recall (fraction of injected spikes recovered).

Output -> ml/out/anomalies.csv
  canonical_name, kgis_code, year, month, category, count, expected, anomaly_score, reason
data_class=real. Re-runnable.  Run: python ml/anomaly.py
"""
from __future__ import annotations

import calendar
import os
import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

warnings.filterwarnings("ignore")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out")

MAX_YEAR = 2023            # exclude partial 2024
TOP_CATS_PER_DISTRICT = 10
MIN_EXPECTED = 5.0         # ignore near-zero-volume points (noise)
Z_RULE = 3.5               # statistical flag threshold
CONTAM = 0.01              # IsolationForest contamination


def build_points(dm, districts):
    rows = []
    for d in districts:
        sub = dm[dm["district"] == d]
        top = sub.groupby("major_head")["count"].sum().nlargest(TOP_CATS_PER_DISTRICT).index
        rows.append(sub[sub["major_head"].isin(top)])
    pts = pd.concat(rows, ignore_index=True)
    pts = (pts.groupby(["district", "major_head", "year", "month"], as_index=False)["count"].sum())
    return pts


def featurize(pts):
    pts = pts.copy()
    pts["expected"] = pts.groupby(["district", "major_head", "month"])["count"].transform("mean")
    pts["resid"] = pts["count"] - pts["expected"]
    std = pts.groupby(["district", "major_head"])["resid"].transform("std").fillna(0.0)
    pts["z"] = pts["resid"] / (std + 1e-6)
    pts["logratio"] = np.log((pts["count"] + 1.0) / (pts["expected"] + 1.0))
    return pts


def detect(pts):
    """Return a boolean 'flagged' Series + normalised anomaly_score (0..1)."""
    feats = featurize(pts)
    X = feats[["z", "logratio"]].to_numpy()
    iso = IsolationForest(contamination=CONTAM, random_state=0, n_estimators=200)
    iso.fit(X)
    raw = -iso.score_samples(X)  # higher = more anomalous
    score = (raw - raw.min()) / (raw.max() - raw.min() + 1e-9)
    iso_flag = iso.predict(X) == -1
    eligible = feats["expected"] >= MIN_EXPECTED
    # Spike-focused: unusual INCREASES are the actionable call-outs. Low-side outliers are
    # dominated by data gaps / COVID-period dips, so they are excluded to keep signals clean.
    flagged = eligible & (feats["resid"] > 0) & (iso_flag | (feats["z"] >= Z_RULE))
    return feats.assign(anomaly_score=np.round(score, 4)), flagged


def recall_test(pts, k=120, seed=1):
    rng = np.random.default_rng(seed)
    inj = pts.copy().reset_index(drop=True)
    pool = inj.index[inj["count"] >= 20].to_numpy()
    if len(pool) < k:
        k = len(pool)
    picks = rng.choice(pool, size=k, replace=False)
    factors = rng.uniform(3.0, 6.0, size=k)
    inj.loc[picks, "count"] = (inj.loc[picks, "count"].to_numpy() * factors).round()
    _, flagged = detect(inj)
    recovered = int(flagged.to_numpy()[picks].sum())
    return recovered / k, k


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    dm = pd.read_csv(os.path.join(IN_DIR, "agg_district_month.csv"))
    dim = pd.read_csv(os.path.join(IN_DIR, "dim_district.csv"), dtype=str)
    geo = dim[dim["is_geographic"].astype(str).str.lower() == "true"].copy()
    parent_of = dict(zip(geo["canonical_name"], geo["parent_district"].fillna(geo["canonical_name"])))
    kgis_of = {}
    for _, r in geo.iterrows():
        p = r["parent_district"] or r["canonical_name"]
        if p not in kgis_of and isinstance(r["kgis_code"], str) and r["kgis_code"]:
            kgis_of[p] = r["kgis_code"]

    dm = dm[(dm["canonical_name"].isin(parent_of)) & (dm["year"] <= MAX_YEAR)].copy()
    dm["district"] = dm["canonical_name"].map(parent_of)
    districts = sorted(dm["district"].dropna().unique().tolist())

    pts = build_points(dm, districts)
    feats, flagged = detect(pts)
    hits = feats[flagged].copy()

    def reason(r):
        ratio = r["count"] / r["expected"] if r["expected"] else float("inf")
        direction = "spike" if r["resid"] > 0 else "unusually low"
        mon = calendar.month_abbr[int(r["month"])]
        return (f"{mon} {int(r['year'])}: {int(r['count']):,} {r['major_head'].title()} in "
                f"{r['district']} vs ~{r['expected']:.0f} expected ({ratio:.1f}x, z={r['z']:.1f}) - {direction}.")

    hits["reason"] = hits.apply(reason, axis=1)
    out = pd.DataFrame({
        "canonical_name": hits["district"],
        "kgis_code": hits["district"].map(kgis_of).fillna(""),
        "year": hits["year"].astype(int),
        "month": hits["month"].astype(int),
        "category": hits["major_head"],
        "count": hits["count"].astype(int),
        "expected": hits["expected"].round(1),
        "anomaly_score": hits["anomaly_score"],
        "reason": hits["reason"],
    }).sort_values("anomaly_score", ascending=False).reset_index(drop=True)
    out.to_csv(os.path.join(OUT_DIR, "anomalies.csv"), index=False)

    recall, k = recall_test(pts)
    print(f"[anomaly] {len(pts):,} district x category x month points; flagged {len(out)} spike anomalies")
    print(f"[anomaly] injected-spike recall: {recall*100:.0f}% (recovered on {k} synthetic spikes)")
    if len(out):
        print(f"[anomaly] top: {out.iloc[0]['reason']}")
    print(f"[anomaly] wrote anomalies.csv ({len(out)} rows)")


if __name__ == "__main__":
    main()
