"""Phase 5 Module B - Socio-economic correlation (offline): the "why behind the where".

Correlates district-level crime rates against 2011 Census indicators to explain WHY some
districts carry more recorded crime. Strictly AREA-LEVEL and descriptive.

=====================  ETHICS / FAIRNESS - READ BEFORE EXTENDING  =====================
1. AREA-LEVEL ONLY. These are ecological correlations between district aggregates. They say
   NOTHING about individuals. Inferring anything about a person from a district statistic is
   the ecological fallacy and is expressly out of scope.
2. NOT MODEL FEATURES. Nothing here feeds any predictive model. `ml/risk.py` deliberately
   excludes sc_share / st_share / sex_ratio; this module is the ONLY place they are examined,
   and only as descriptive context.
3. PROTECTED ATTRIBUTES ARE SEGREGATED. Caste share and sex ratio are emitted in a separate
   `sensitive` group, flagged `is_protected=true`, and carry a mandatory caveat. They are
   reported for transparency/audit (e.g. to detect enforcement disparity), NEVER as a
   targeting signal. The API/UI must keep them labelled and must not rank districts by them.
4. FIRs MEASURE REPORTING, NOT CRIME. Literate, urban, better-policed districts report more.
   A positive literacy-crime correlation most likely reflects reporting propensity and police
   accessibility - not more offending. This caveat ships with every coefficient.
=======================================================================================

Method: Pearson (linear) + Spearman (monotonic, outlier-robust) with two-sided p-values,
n = 30 districts (2011 Census vintage; Vijayanagara folded into Ballari upstream). With n=30
only moderate+ effects are detectable, so p-values and CI-free honesty matter: we report
significance at 0.05 and label everything below |r| 0.3 as negligible.

Confounder check: urbanisation/literacy correlate with each other AND with reporting, so the
headline for each sensitive indicator is also reported as a PARTIAL correlation controlling
for literacy - if the association vanishes, that is stated plainly.

Outputs -> ml/out/
  socio_correlations.csv   indicator, group, is_protected, pearson_r, spearman_r, p_value,
                           significant, strength, direction, partial_r_ctrl_literacy, caveat
  socio_districts.csv      per-district joined view (crime rate + indicators) for the scatter
  socio_metrics.json       model card + the ethics block above

data_class=real. Re-runnable.  Run: python ml/socioeconomic.py
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy import stats

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out")

ALPHA = 0.05
# indicator -> (label, group, is_protected, why it matters / how to read it)
INDICATORS = {
    "literacy_rate": ("Literacy rate", "socioeconomic", False,
                      "Higher literacy tracks urbanisation and willingness/ability to report."),
    "population_2011": ("Population", "socioeconomic", False,
                        "Absolute population base; larger districts have more incidents."),
    "urban_share": ("Urbanisation (urban % of population)", "socioeconomic", False,
                    "Computed from the 2011 Census PCA rural/urban split. Urbanisation is the "
                    "classic structural correlate of recorded crime (density, anonymity, "
                    "reporting access)."),
    "sc_share": ("Scheduled Caste share", "sensitive", True,
                 "PROTECTED ATTRIBUTE. Area-level only. Any association is confounded by "
                 "poverty, urbanisation and reporting/enforcement patterns - it is NOT evidence "
                 "about any community and must never drive deployment."),
    "st_share": ("Scheduled Tribe share", "sensitive", True,
                 "PROTECTED ATTRIBUTE. Same caveat as SC share; ST-majority districts are also "
                 "the most rural, where reporting access is lowest."),
    "sex_ratio_f_per_1000m": ("Sex ratio (F per 1000 M)", "sensitive", True,
                              "PROTECTED ATTRIBUTE. Reported for audit/transparency only."),
}
TARGET = "crimes_per_100k"
REPORTING_CAVEAT = ("FIR counts measure REPORTED crime, not true offending. Districts with better "
                    "police access and higher literacy report more, which inflates their rate.")


def strength(r):
    a = abs(r)
    return "strong" if a >= 0.7 else "moderate" if a >= 0.5 else "weak" if a >= 0.3 else "negligible"


def partial_corr(x, y, z):
    """Correlation of x,y after linearly removing z from both (controls a confounder)."""
    x, y, z = np.asarray(x, float), np.asarray(y, float), np.asarray(z, float)
    rx = x - np.polyval(np.polyfit(z, x, 1), z)
    ry = y - np.polyval(np.polyfit(z, y, 1), z)
    if np.std(rx) == 0 or np.std(ry) == 0:
        return float("nan")
    return float(np.corrcoef(rx, ry)[0, 1])


def load_urban_share():
    """district census code -> urban population share, from the 2011 Census PCA (TRU split)."""
    import csv as _csv
    path = os.path.join(ROOT, "datasets", "external", "census",
                        "DDW_PCA0000_2011_Indiastatedist.csv")
    if not os.path.exists(path):
        return {}
    tot, urb = {}, {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in _csv.DictReader(f):
            if r.get("State", "").strip() != "29" or r.get("Level") != "DISTRICT":
                continue
            code = r["District"].strip()
            try:
                pop = int(r["TOT_P"])
            except (ValueError, KeyError):
                continue
            if r.get("TRU") == "Total":
                tot[code] = pop
            elif r.get("TRU") == "Urban":
                urb[code] = pop
    return {c: round(urb.get(c, 0) / t, 4) for c, t in tot.items() if t}


def load_canonical_names():
    """2011 census code -> the platform's canonical district name.

    agg_socioeconomic carries 2011 Census spellings (Bangalore, Shimoga, Chikmagalur); every
    other screen uses the canonical modern names (Bengaluru Urban, Shivamogga, Chikkamagaluru).
    Mapping here keeps district naming consistent across the whole app.
    """
    dim = pd.read_csv(os.path.join(IN_DIR, "dim_district.csv"), dtype=str).fillna("")
    geo = dim[dim["is_geographic"].astype(str).str.lower() == "true"]
    out = {}
    for _, r in geo.iterrows():
        code = str(r["census_code_2011"]).strip()
        if not code:            # Vijayanagara has no 2011 code (folded into Ballari upstream)
            continue
        out.setdefault(code, (str(r["parent_district"]).strip()
                              or str(r["canonical_name"]).strip()))
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    df = pd.read_csv(os.path.join(IN_DIR, "agg_socioeconomic.csv"))
    df = df[(df["population_2011"] > 0) & (df[TARGET] > 0)].copy()
    ushare = load_urban_share()
    df["urban_share"] = df["census_code_2011"].astype(str).map(ushare)
    canon = load_canonical_names()
    df["district"] = (df["census_code_2011"].astype(str).map(canon)
                      .fillna(df["district_2011_name"]))
    if df["urban_share"].isna().any():
        miss = int(df["urban_share"].isna().sum())
        print(f"[socio] WARNING: urban_share missing for {miss} district(s); dropped from that test")
    n = len(df)
    print(f"[socio] {n} districts joined (2011 Census) | target = {TARGET}")

    rows = []
    for col, (label, group, protected, note) in INDICATORS.items():
        if col not in df.columns:
            continue
        # dict.fromkeys de-dupes when the indicator IS literacy_rate/the target
        sub = df[list(dict.fromkeys([col, TARGET, "literacy_rate"]))].dropna()
        if len(sub) < 5:
            continue
        x, y = sub[col].to_numpy(float), sub[TARGET].to_numpy(float)
        pr, pp = stats.pearsonr(x, y)
        sr, sp = stats.spearmanr(x, y)
        sig = bool(pp < ALPHA)
        pc = (partial_corr(x, y, sub["literacy_rate"].to_numpy(float))
              if col != "literacy_rate" else float("nan"))
        caveat = REPORTING_CAVEAT if not protected else f"{note} {REPORTING_CAVEAT}"
        rows.append({
            "indicator": col, "label": label, "group": group, "is_protected": protected,
            "n": len(sub),
            "pearson_r": round(float(pr), 4), "p_value": round(float(pp), 5),
            "spearman_r": round(float(sr), 4), "spearman_p": round(float(sp), 5),
            "significant": sig,
            "strength": strength(pr), "direction": "positive" if pr > 0 else "negative",
            "partial_r_ctrl_literacy": (round(pc, 4) if np.isfinite(pc) else ""),
            "note": note, "caveat": caveat,
        })

    res = pd.DataFrame(rows)
    res["abs_r"] = res["pearson_r"].abs()
    res = res.sort_values(["is_protected", "abs_r"], ascending=[True, False]).drop(columns="abs_r")
    res.to_csv(os.path.join(OUT_DIR, "socio_correlations.csv"), index=False)

    # per-district view for the scatter plot
    keep = ["census_code_2011", "district", "district_2011_name", "population_2011", TARGET,
            "total_crimes_all_years", "literacy_rate", "urban_share", "sc_share", "st_share",
            "sex_ratio_f_per_1000m"]
    df[keep].sort_values(TARGET, ascending=False).to_csv(
        os.path.join(OUT_DIR, "socio_districts.csv"), index=False)

    sigs = res[res["significant"] & (res["strength"] != "negligible")]
    card = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "data_class": "real",
        "method": "Pearson + Spearman correlation, two-sided p-values; partial correlation "
                  "controlling for literacy as a confounder check.",
        "n_districts": n,
        "target": TARGET,
        "census_vintage": "2011 (crime 2016-2024) — population base is dated; rates are indicative",
        "alpha": ALPHA,
        "significant_findings": int(len(sigs)),
        "ethics": {
            "area_level_only": "Ecological correlations between district aggregates. They say "
                               "nothing about individuals (ecological fallacy).",
            "not_model_features": "No indicator here feeds any predictive model; ml/risk.py "
                                  "explicitly excludes caste/sex indicators.",
            "protected_attributes_segregated": "sc_share / st_share / sex_ratio are grouped as "
                                               "'sensitive', flagged is_protected, and carry a "
                                               "mandatory caveat. Reported for transparency and "
                                               "disparity audit, never as a targeting signal.",
            "reporting_caveat": REPORTING_CAVEAT,
        },
        "interpretation": "Correlation is not causation. With n=30 only moderate+ effects are "
                          "detectable; |r| < 0.3 is reported as negligible.",
    }
    with open(os.path.join(OUT_DIR, "socio_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(card, f, indent=2)

    print("\n--- MODEL CARD: socio-economic correlation (Module B) ---")
    print(f"  n={n} districts | Pearson+Spearman, alpha={ALPHA} | {len(sigs)} significant non-negligible")
    for _, r in res.iterrows():
        tag = " [PROTECTED]" if r["is_protected"] else ""
        star = "*" if r["significant"] else " "
        pc = f" | partial(ctrl literacy) r={r['partial_r_ctrl_literacy']}" if r["partial_r_ctrl_literacy"] != "" else ""
        print(f"   {star} {r['label']:38} r={r['pearson_r']:+.3f} (p={r['p_value']:.4f}) "
              f"rho={r['spearman_r']:+.3f} {r['strength']}{pc}{tag}")
    print(f"  CAVEAT: {REPORTING_CAVEAT}")
    print(f"[socio] wrote socio_correlations.csv ({len(res)} indicators), socio_districts.csv "
          f"({n} districts), socio_metrics.json")


if __name__ == "__main__":
    main()
