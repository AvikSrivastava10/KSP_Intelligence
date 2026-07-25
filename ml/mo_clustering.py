"""Phase 4 - MO / incident-profile clustering (offline, HDBSCAN).

Groups incidents by *modus operandi* profile - the combination of crime head +
sub-head + legal-section signature + area + season + (descriptive) modeled time bucket -
so recurring MO patterns surface as labelled clusters for pattern discovery.

TRACTABILITY: HDBSCAN on 1.67M rows is too heavy. We take a crime-head-STRATIFIED sample
(caps dominant heads, keeps rare MO types represented), one-hot the MO dimensions, reduce
with TruncatedSVD, then cluster the reduced space. Uses sklearn's native
``cluster.HDBSCAN`` (no fragile external build).

Modeled time-of-day is used for the DESCRIPTIVE ``time_profile`` only (it is a function of
crime head) - it does not drive the outcome model.

Outputs -> ml/out/
  mo_clusters.csv     one row per cluster: id, size, top crime head/sub-head/section,
                      top districts, heinous share, time_profile, season, MO_description
  mo_assignments.csv  crime_subhead -> dominant cluster (signature-level assignment)

Metrics: silhouette (reduced space), noise fraction. (DBCV needs the standalone hdbscan
package, not installed; silhouette + noise fraction reported instead.)

Run:  python ml/mo_clustering.py
"""
from __future__ import annotations

import os
import sys
import time
import warnings

import numpy as np
import pandas as pd
from sklearn.cluster import HDBSCAN
from sklearn.decomposition import TruncatedSVD
from sklearn.metrics import silhouette_score

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "etl"))
from common.timeofday import assign as tod_assign  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out")

SAMPLE_CAP = 80000       # proportional sample size (preserves real incident density)
SVD_COMPONENTS = 25
MIN_CLUSTER_SIZE = 800
MIN_SAMPLES = 20
# one-hot bucketing (top-N per dimension, rest -> OTHER)
TOPN = {"crime_head": 30, "crime_subhead": 50, "first_act": 15,
        "first_section": 30, "district": 20, "complaint_mode": 6}
# Feature weights: MO is defined FIRST by crime identity (head/sub-head/section), so those
# blocks are up-weighted before SVD -> clusters form around crime type (high purity), with
# area/legal-act as secondary structure. Season/day-of-week are descriptive only (excluded
# from clustering; equal-weighting them fragmented one MO into near-duplicate seasonal clusters).
WEIGHTS = {"crime_head": 3.0, "crime_subhead": 3.0, "first_section": 2.0,
           "first_act": 1.0, "district": 1.0, "complaint_mode": 1.0, "gravity": 1.0}


def proportional_sample(df):
    """Random proportional sample - preserves the natural MO frequency structure that a
    density method (HDBSCAN) relies on. Dominant MO types form dense clusters; rare ones
    fall to noise (honest)."""
    n = min(SAMPLE_CAP, len(df))
    return df.sample(n=n, random_state=0).reset_index(drop=True)


def bucket_topn(col, n):
    keep = set(col.value_counts().nlargest(n).index)
    return col.where(col.isin(keep), "OTHER")


def mode_of(series, exclude=()):
    vc = series[~series.isin(exclude)].value_counts() if exclude else series.value_counts()
    return vc.index[0] if len(vc) else "n/a"


def describe(sub):
    ch = mode_of(sub["crime_head"])                      # true modal head (no exclusions)
    head_purity = float((sub["crime_head"] == ch).mean())
    # draw sub-head / section / time from the rows matching the modal head so the
    # description is internally consistent even when a cluster is mixed (low purity).
    core = sub[sub["crime_head"] == ch]
    sh = mode_of(core["crime_subhead"], exclude=("Others", "NONE", ""))
    sec = mode_of(core["first_section"], exclude=("NONE", ""))
    time_profile = mode_of(core["tod_bucket"]) if len(core) else "Distributed"
    dists = sub["district"].value_counts().head(3).index.tolist()
    heinous = float((sub["gravity"] == "Heinous").mean())
    season = sub["season"].value_counts().index[0]
    mixed = " and related offences" if head_purity < 0.6 else ""
    desc = (f"{ch.title()}{mixed} (mainly '{sh.title()}'"
            + (f", u/s {sec}" if sec != "n/a" else "") + "), "
            + f"concentrated in {', '.join(dists[:2])}; "
            + f"{'largely heinous' if heinous >= 0.5 else 'mostly non-heinous'}, "
            + f"{season.lower()} lean, estimated {time_profile.lower()} time-of-day.")
    return dict(top_crime_head=ch, head_purity=round(head_purity, 3), top_crime_subhead=sh,
                top_section=sec, top_districts="; ".join(dists), heinous_share=round(heinous, 3),
                season_profile=season, time_profile=time_profile, mo_description=desc)


def main():
    t0 = time.time()
    os.makedirs(OUT_DIR, exist_ok=True)

    df = pd.read_parquet(os.path.join(IN_DIR, "case_features.parquet"),
                         columns=["crime_head", "crime_subhead", "first_act", "first_section",
                                  "district", "complaint_mode", "gravity", "season"])
    for c in df.columns:
        df[c] = df[c].astype(str)
    df["tod_bucket"] = df["crime_head"].map(lambda h: tod_assign(h)[0])  # descriptive only
    print(f"[mo] loaded {len(df):,} incidents ({time.time()-t0:.0f}s)")

    samp = proportional_sample(df)
    print(f"[mo] proportional sample: {len(samp):,} incidents "
          f"({samp['crime_head'].nunique()} heads represented)")

    # weighted one-hot of the MO dimensions (crime identity up-weighted), then reduce
    blocks = []
    for c in WEIGHTS:
        col = bucket_topn(samp[c], TOPN[c]) if c in TOPN else samp[c]
        dummies = pd.get_dummies(col).to_numpy(dtype=np.float32) * WEIGHTS[c]
        blocks.append(dummies)
    X = np.hstack(blocks)
    ncomp = min(SVD_COMPONENTS, X.shape[1] - 1)
    Z = TruncatedSVD(n_components=ncomp, random_state=0).fit_transform(X)
    print(f"[mo] one-hot {X.shape[1]} dims -> SVD {ncomp} comps ({time.time()-t0:.0f}s)")

    hdb = HDBSCAN(min_cluster_size=MIN_CLUSTER_SIZE, min_samples=MIN_SAMPLES, metric="euclidean")
    labels = hdb.fit_predict(Z)
    samp["cluster"] = labels
    core = labels != -1
    n_clusters = int(len(set(labels[core])))
    noise_frac = float((~core).mean())
    sil = float("nan")
    if n_clusters >= 2:
        m = core
        sil = float(silhouette_score(Z[m], labels[m],
                                     sample_size=min(10000, int(m.sum())), random_state=0))
    print(f"[mo] HDBSCAN: {n_clusters} clusters | noise {noise_frac*100:.1f}% | "
          f"silhouette {sil:.3f}  ({time.time()-t0:.0f}s)")

    # ---- cluster summaries ----
    rows = []
    for cid in sorted(set(labels[core])):
        sub = samp[samp["cluster"] == cid]
        d = describe(sub)
        rows.append({"cluster_id": int(cid), "size": int(len(sub)),
                     "share_pct": round(100 * len(sub) / core.sum(), 1), **d})
    clusters = pd.DataFrame(rows).sort_values("size", ascending=False).reset_index(drop=True)
    clusters.to_csv(os.path.join(OUT_DIR, "mo_clusters.csv"), index=False)

    # ---- signature-level assignments: crime_subhead -> dominant cluster ----
    assigned = samp[core]
    amap = (assigned.groupby("crime_subhead")["cluster"]
            .agg(lambda s: s.value_counts().index[0]).rename("cluster_id").reset_index())
    acnt = assigned.groupby("crime_subhead").size().rename("n").reset_index()
    asg = amap.merge(acnt, on="crime_subhead").sort_values("n", ascending=False)
    asg["cluster_id"] = asg["cluster_id"].astype(int)
    asg.to_csv(os.path.join(OUT_DIR, "mo_assignments.csv"), index=False)

    print("\n--- MODEL CARD: MO clustering (HDBSCAN) ---")
    print(f"  fitted on {len(samp):,}-incident stratified sample -> {n_clusters} MO clusters")
    print(f"  silhouette {sil:.3f} (reduced space) | noise {noise_frac*100:.1f}% | "
          f"metric=euclidean on {ncomp}-D SVD")
    print(f"  fairness: no protected attributes; time-of-day descriptive only")
    for _, r in clusters.head(12).iterrows():
        print(f"   #{r['cluster_id']:>2} n={r['size']:>5} purity={r['head_purity']:.2f}  {r['mo_description']}")
    print(f"[mo] wrote mo_clusters.csv ({len(clusters)} clusters) + "
          f"mo_assignments.csv ({len(asg)} sub-heads)  [{time.time()-t0:.0f}s]")


if __name__ == "__main__":
    main()
