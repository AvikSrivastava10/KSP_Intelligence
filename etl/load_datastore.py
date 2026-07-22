"""Catalyst Data Store loader — STUB (Phase 1 implements the real load).

Phase 0 only *defines* the schema (see schema.md) and produces the tables in etl/out/.
This stub inventories those outputs and prints the load plan (a dry run), so Phase 1 can
wire it to Catalyst (`zcatalyst-sdk` bulk insert / ZCQL) without guesswork. It intentionally
does NOT connect to Catalyst.

Run:  python etl/load_datastore.py            (dry-run inventory)
"""
from __future__ import annotations

import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import paths

# etl/out file -> target Catalyst Data Store table name (see schema.md §A)
TABLE_MAP = {
    "dim_district.csv": "dim_district",
    "dim_crime_head.csv": "dim_crime_head",
    "dim_crime_subhead.csv": "dim_crime_subhead",
    "dim_case_status.csv": "dim_case_status",
    "dim_gravity.csv": "dim_gravity",
    "dim_complaint_mode.csv": "dim_complaint_mode",
    "dim_act.csv": "dim_act",
    "dim_section.csv": "dim_section",
    "dim_rank.csv": "dim_rank",
    "agg_district_month.csv": "agg_district_month",
    "agg_hotspots.csv": "agg_hotspots",
    "agg_unit.csv": "agg_unit",
    "agg_outcomes.csv": "agg_outcomes",
    "agg_case_status.csv": "agg_case_status",
    "agg_socioeconomic.csv": "agg_socioeconomic",
    "agg_timeofday.csv": "agg_timeofday",  # data_class = modeled
}


def _infer_type(values):
    """Cheap Catalyst-type inference from a column's sampled values."""
    seen_int = seen_float = False
    for v in values:
        if v == "" or v is None:
            continue
        try:
            int(v); seen_int = True; continue
        except ValueError:
            pass
        try:
            float(v); seen_float = True
        except ValueError:
            return "varchar"
    if seen_float:
        return "double"
    if seen_int:
        return "int"
    return "varchar"


def inventory():
    out = paths.OUT_DIR
    if not os.path.isdir(out):
        print(f"!! {out} not found — run ingest_fir.py first.")
        return 1
    print(f"Catalyst Data Store load plan (dry run) — source: {out}\n")
    total_rows = 0
    for fn, table in TABLE_MAP.items():
        p = os.path.join(out, fn)
        if not os.path.exists(p):
            print(f"  [MISSING] {fn} -> {table}")
            continue
        with open(p, encoding="utf-8", newline="") as f:
            r = csv.reader(f)
            header = next(r, [])
            sample, n = [], 0
            for row in r:
                n += 1
                if len(sample) < 200:
                    sample.append(row)
        cols = []
        for i, h in enumerate(header):
            cols.append(f"{h}:{_infer_type([s[i] for s in sample if i < len(s)])}")
        total_rows += n
        tag = "  (data_class=modeled)" if table == "agg_timeofday" else ""
        print(f"  {table:22} {n:>8,} rows{tag}")
        print(f"      cols: {', '.join(cols)}")
    print(f"\nTotal rows across serving tables: {total_rows:,}")
    print("\nNote: case-level `case_master` (normalized, ~1.67M rows) is materialized in "
          "Phase 1 from ingest_fir.py; see schema.md §A.3. CSV fallback bundling also Phase 1.")
    return 0


if __name__ == "__main__":
    raise SystemExit(inventory())
