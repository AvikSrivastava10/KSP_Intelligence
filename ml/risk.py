"""Phase 3 - Area-level risk scoring (offline, LightGBM).

Predicts each parent-district's next-year crime volume from a district x year panel and
turns the prediction into a 0-100 risk score + tier for proactive deployment.

FAIRNESS GUARDRAIL (critical): features are crime dynamics + population ONLY -
  lag totals, 3-yr average, trend slope, YoY growth, seasonal volatility, crime-type mix
  (property/violent/traffic/cyber shares), population, prior per-capita rate.
  It NEVER uses caste (sc_share/st_share), religion, or sex (sex_ratio) as features -
  those live only in the Phase-5 correlation view. Documented in FEATURES below.

Panel: target year t in 2019-2023 (needs 3 prior years); train on 2019-2022, validate on
held-out 2023 (Spearman rank + RMSE). A final model on all labelled years predicts 2024 ->
risk score. Per-district drivers come from LightGBM SHAP contributions (pred_contrib).

2024 is a partial year -> used only as the prediction TARGET horizon, never as a feature.

Output -> ml/out/risk_scores.csv
  canonical_name, kgis_code, population, predicted_next, risk_score, risk_tier, top_drivers
data_class=real. Re-runnable.  Run: python ml/risk.py
"""
from __future__ import annotations

import os
import warnings

import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor
from scipy.stats import spearmanr

warnings.filterwarnings("ignore")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out")

FEATURES = ["lag1", "lag2", "avg3", "trend", "yoy", "cv_season",
            "share_property", "share_violent", "share_traffic", "share_cyber",
            "population", "percap_lag1"]
LABELS = {
    "lag1": "high recent volume", "lag2": "elevated prior-year volume",
    "avg3": "sustained high volume", "trend": "rising multi-year trend",
    "yoy": "sharp year-on-year growth", "cv_season": "seasonal volatility",
    "share_property": "property-crime concentration", "share_violent": "violent-crime concentration",
    "share_traffic": "traffic-incident load", "share_cyber": "rising cybercrime mix",
    "population": "large population base", "percap_lag1": "high per-capita crime rate",
}
GROUPS = {
    "property": {"THEFT", "BURGLARY - NIGHT", "BURGLARY - DAY", "ROBBERY", "DACOITY", "CHEATING", "CRIMINAL BREACH OF TRUST"},
    "violent": {"MURDER", "ATTEMPT TO MURDER", "CASES OF HURT", "RIOTS", "KIDNAPPING AND ABDUCTION", "CULPABLE HOMICIDE NOT AMOUNTING TO MURDER"},
    "traffic": {"MOTOR VEHICLE ACCIDENTS NON-FATAL", "MOTOR VEHICLE ACCIDENTS FATAL"},
    "cyber": {"CYBER CRIME"},
}
TARGET_YEARS = [2019, 2020, 2021, 2022, 2023]
PREDICT_YEAR = 2024


def build_features(dm, pop_by_district, districts):
    annual = dm.groupby(["district", "year"])["count"].sum().unstack(fill_value=0.0)
    # per district-year seasonal CV + group shares
    md = dm.groupby(["district", "year", "month"])["count"].sum().reset_index()
    cv = (md.groupby(["district", "year"])["count"].agg(lambda s: s.std(ddof=0) / s.mean() if s.mean() else 0.0)
          .rename("cv").reset_index())
    cv_map = {(r.district, int(r.year)): float(r.cv) for r in cv.itertuples()}
    gd = dm.copy()
    gd["grp"] = gd["major_head"].map({c: g for g, cs in GROUPS.items() for c in cs})
    grp = gd.dropna(subset=["grp"]).groupby(["district", "year", "grp"])["count"].sum().unstack(fill_value=0.0)

    def share(district, yr, g):
        tot = annual.loc[district, yr] if (yr in annual.columns and district in annual.index) else 0.0
        if not tot or district not in grp.index or yr not in grp.index.get_level_values(1):
            return 0.0
        try:
            v = grp.loc[(district, yr), g]
        except KeyError:
            return 0.0
        return float(v) / float(tot) if tot else 0.0

    rows = []
    for d in districts:
        pop = pop_by_district.get(d, np.nan)
        for t in TARGET_YEARS + [PREDICT_YEAR]:
            cols = annual.columns
            if (t - 1) not in cols or (t - 3) not in cols:
                continue
            lag1 = float(annual.loc[d, t - 1]) if d in annual.index else 0.0
            lag2 = float(annual.loc[d, t - 2]) if (t - 2) in cols else 0.0
            lag3 = float(annual.loc[d, t - 3]) if (t - 3) in cols else 0.0
            avg3 = np.mean([lag1, lag2, lag3])
            trend = float(np.polyfit([0, 1, 2], [lag3, lag2, lag1], 1)[0])
            yoy = (lag1 - lag2) / lag2 if lag2 else 0.0
            percap = (lag1 / pop * 1e5) if pop and np.isfinite(pop) else np.nan
            target = float(annual.loc[d, t]) if (t in cols and d in annual.index) else np.nan
            rows.append({
                "district": d, "year": t,
                "lag1": lag1, "lag2": lag2, "avg3": avg3, "trend": trend, "yoy": yoy,
                "cv_season": cv_map.get((d, t - 1), 0.0),
                "share_property": share(d, t - 1, "property"),
                "share_violent": share(d, t - 1, "violent"),
                "share_traffic": share(d, t - 1, "traffic"),
                "share_cyber": share(d, t - 1, "cyber"),
                "population": pop, "percap_lag1": percap,
                "target": target,
            })
    return pd.DataFrame(rows)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    dm = pd.read_csv(os.path.join(IN_DIR, "agg_district_month.csv"))
    dim = pd.read_csv(os.path.join(IN_DIR, "dim_district.csv"), dtype=str)
    socio = pd.read_csv(os.path.join(IN_DIR, "agg_socioeconomic.csv"))

    geo = dim[dim["is_geographic"].astype(str).str.lower() == "true"].copy()
    parent_of = dict(zip(geo["canonical_name"], geo["parent_district"].fillna(geo["canonical_name"])))
    kgis_of, census_of = {}, {}
    for _, r in geo.iterrows():
        p = r["parent_district"] or r["canonical_name"]
        if p not in kgis_of and isinstance(r["kgis_code"], str) and r["kgis_code"]:
            kgis_of[p] = r["kgis_code"]
        if p not in census_of and isinstance(r["census_code_2011"], str) and r["census_code_2011"]:
            census_of[p] = r["census_code_2011"]
    pop_by_census = {str(int(r.census_code_2011)): float(r.population_2011) for r in socio.itertuples()}
    pop_by_district = {p: pop_by_census.get(str(c)) for p, c in census_of.items()}

    dm = dm[dm["canonical_name"].isin(parent_of)].copy()
    dm["district"] = dm["canonical_name"].map(parent_of)
    districts = sorted(dm["district"].dropna().unique().tolist())

    panel = build_features(dm, pop_by_district, districts)
    labelled = panel[panel["target"].notna()].copy()
    predict_rows = panel[panel["year"] == PREDICT_YEAR].copy()

    # ---- validation: train 2019-2022, test 2023 (ranking + RMSE) ----
    tr = labelled[labelled["year"] < 2023]
    te = labelled[labelled["year"] == 2023]
    params = dict(n_estimators=400, learning_rate=0.03, num_leaves=15, min_child_samples=5,
                  subsample=0.9, colsample_bytree=0.9, random_state=0, verbosity=-1)
    m_val = LGBMRegressor(**params).fit(tr[FEATURES], tr["target"])
    pred_te = np.clip(m_val.predict(te[FEATURES]), 0, None)
    rho = spearmanr(te["target"], pred_te).correlation
    rmse = float(np.sqrt(np.mean((te["target"].to_numpy() - pred_te) ** 2)))
    mae = float(np.mean(np.abs(te["target"].to_numpy() - pred_te)))
    denom = te["target"].mean()
    print(f"[risk] validation (held-out 2023, n={len(te)}): Spearman rank rho={rho:.3f} | "
          f"RMSE={rmse:.0f} | MAE={mae:.0f} | mean actual={denom:.0f} (MAE {100*mae/denom:.1f}% of mean)")

    # ---- final model on all labelled years -> predict 2024 ----
    m = LGBMRegressor(**params).fit(labelled[FEATURES], labelled["target"])
    X24 = predict_rows[FEATURES]
    pred24 = np.clip(m.predict(X24), 0, None)
    contrib = m.booster_.predict(X24, pred_contrib=True)  # (n, n_feat+1) SHAP-like

    lo, hi = np.log1p(pred24.min()), np.log1p(pred24.max())
    score = 100 * (np.log1p(pred24) - lo) / (hi - lo) if hi > lo else np.full(len(pred24), 50.0)

    out = []
    for i, (_, r) in enumerate(predict_rows.iterrows()):
        c = contrib[i][:-1]
        top_idx = np.argsort(c)[::-1][:3]
        drivers = [LABELS[FEATURES[j]] for j in top_idx if c[j] > 0][:3]
        d = r["district"]
        out.append({
            "canonical_name": d, "kgis_code": kgis_of.get(d, ""),
            "population": int(pop_by_district[d]) if pop_by_district.get(d) and np.isfinite(pop_by_district[d]) else "",
            "predicted_next": int(round(pred24[i])),
            "risk_score": round(float(score[i]), 1),
            "top_drivers": "; ".join(drivers) if drivers else "mixed factors",
        })
    res = pd.DataFrame(out).sort_values("risk_score", ascending=False).reset_index(drop=True)
    res["risk_tier"] = pd.qcut(res["risk_score"], [0, .35, .6, .8, 1.0],
                               labels=["Low", "Moderate", "High", "Critical"], duplicates="drop").astype(str)
    res = res[["canonical_name", "kgis_code", "population", "predicted_next",
               "risk_score", "risk_tier", "top_drivers"]]
    res.to_csv(os.path.join(OUT_DIR, "risk_scores.csv"), index=False)

    tiers = res["risk_tier"].value_counts().to_dict()
    print(f"[risk] scored {len(res)} districts for {PREDICT_YEAR}; tiers={tiers}")
    print(f"[risk] highest: {res.iloc[0]['canonical_name']} (score {res.iloc[0]['risk_score']}, "
          f"drivers: {res.iloc[0]['top_drivers']})")
    print(f"[risk] features (fairness-safe, no caste/religion/sex): {', '.join(FEATURES)}")
    print(f"[risk] wrote risk_scores.csv ({len(res)} rows)")


if __name__ == "__main__":
    main()
