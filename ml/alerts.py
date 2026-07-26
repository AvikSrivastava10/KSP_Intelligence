"""Phase 3 - Emerging-trend / spike alerts ("red-zones"), offline.

Compares the most recent COMPLETE year (2023) against a RECENT baseline (the mean annual
volume over 2021-2022, see BASELINE_YEARS) for every parent-district x major-category, and
flags red/amber spikes. The baseline is deliberately recent rather than the full history:
including the COVID-suppressed 2020-21 years would depress the baseline and make almost
every 2023 comparison look like a spike. 2024 is excluded (partial year -> undercounted ->
false signals).

Output -> ml/out/alerts.csv
  canonical_name, kgis_code, category, period, actual, baseline, deviation_pct,
  severity, reason

data_class=real (derived from real counts). Re-runnable.  Run: python ml/alerts.py
"""
from __future__ import annotations

import os

import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out")

RECENT_YEAR = 2023
# Recent baseline (avoids COVID-depressed 2020-2021 inflating the comparison).
BASELINE_YEARS = [2021, 2022]
MIN_BASELINE = 80.0     # ignore tiny/noisy categories
MIN_ABS_INCREASE = 50   # require a meaningful absolute jump
AMBER_PCT = 20.0
RED_PCT = 40.0


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    dm = pd.read_csv(os.path.join(IN_DIR, "agg_district_month.csv"))
    dim = pd.read_csv(os.path.join(IN_DIR, "dim_district.csv"), dtype=str)
    geo = dim[dim["is_geographic"].astype(str).str.lower() == "true"].copy()
    parent_of = dict(zip(geo["canonical_name"], geo["parent_district"].fillna(geo["canonical_name"])))
    kgis_of = {}
    for _, r in geo.iterrows():
        parent = r["parent_district"] or r["canonical_name"]
        if parent not in kgis_of and isinstance(r["kgis_code"], str) and r["kgis_code"]:
            kgis_of[parent] = r["kgis_code"]

    dm = dm[dm["canonical_name"].isin(parent_of)].copy()
    dm["district"] = dm["canonical_name"].map(parent_of)

    # annual totals per district x category
    annual = dm.groupby(["district", "major_head", "year"], as_index=False)["count"].sum()
    recent = (annual[annual["year"] == RECENT_YEAR]
              .set_index(["district", "major_head"])["count"])
    base = (annual[annual["year"].isin(BASELINE_YEARS)]
            .groupby(["district", "major_head"])["count"].mean())

    rows = []
    for (district, cat), baseline in base.items():
        if baseline < MIN_BASELINE:
            continue
        actual = float(recent.get((district, cat), 0.0))
        increase = actual - baseline
        if increase < MIN_ABS_INCREASE:
            continue
        dev = 100.0 * increase / baseline
        if dev < AMBER_PCT:
            continue
        severity = "red" if dev >= RED_PCT else "amber"
        reason = (f"{cat.title()} in {district}: {int(round(actual)):,} FIRs in {RECENT_YEAR} "
                  f"vs {baseline:,.0f} avg over {BASELINE_YEARS[0]}-{BASELINE_YEARS[-1]} (+{dev:.0f}%).")
        rows.append([district, kgis_of.get(district, ""), cat, str(RECENT_YEAR),
                     int(round(actual)), round(baseline, 1), round(dev, 1), severity, reason])

    out = pd.DataFrame(rows, columns=["canonical_name", "kgis_code", "category", "period",
                                      "actual", "baseline", "deviation_pct", "severity", "reason"])
    out = out.sort_values(["severity", "deviation_pct"], ascending=[True, False]).reset_index(drop=True)
    out.to_csv(os.path.join(OUT_DIR, "alerts.csv"), index=False)

    n_red = int((out["severity"] == "red").sum())
    n_amber = int((out["severity"] == "amber").sum())
    print(f"[alerts] {RECENT_YEAR} vs {BASELINE_YEARS[0]}-{BASELINE_YEARS[-1]} baseline: "
          f"{len(out)} red-zones ({n_red} red, {n_amber} amber)")
    if len(out):
        top = out.iloc[0]
        print(f"[alerts] top: {top['reason']}")
    print(f"[alerts] wrote alerts.csv ({len(out)} rows)")


if __name__ == "__main__":
    main()
