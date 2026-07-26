"""Print a console-ready Data Store table spec.

Creating tables in the Catalyst console means typing column names and types by hand, and a single
mismatch makes `load_datastore.py --load` fail on that table. This prints exactly what to enter.

  python etl/print_table_spec.py            # the 15 core tables (enough to go live)
  python etl/print_table_spec.py --all      # all 42 serving tables
  python etl/print_table_spec.py --er       # the 28 KSP ER contract tables
  python etl/print_table_spec.py --only dim_district agg_outcomes
"""
from __future__ import annotations

import argparse
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCHEMA = os.path.join(ROOT, "etl", "out", "datastore_schema.json")

# The tables the live screens read. `store.js` falls back per table, so these 15 are enough for
# /health to report catalyst_datastore; the rest keep serving from the bundle until loaded.
CORE = [
    "dim_district", "agg_outcomes", "agg_case_status", "agg_socioeconomic", "agg_unit",
    "agg_timeofday", "risk_scores", "alerts", "anomalies", "mo_clusters",
    "outcomes_by_district", "outcome_drivers", "network_nodes", "network_communities",
    "socio_correlations",
]
# Pinned CSV-only in code (paging 140k rows over ZCQL would be hundreds of queries per request).
NEVER_CREATE = ["hotspot_cells", "agg_hotspots", "agg_district_month", "forecasts"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--er", action="store_true")
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()

    doc = json.load(open(SCHEMA, encoding="utf-8"))
    if a.er:
        tables = doc["er_contract_tables"]
        key = "table_name"
    else:
        tables = doc["tables"]
        key = "table_name"
        if a.only:
            tables = [t for t in tables if t[key] in a.only]
        elif not a.all:
            order = {n: i for i, n in enumerate(CORE)}
            tables = sorted([t for t in tables if t[key] in order], key=lambda t: order[t[key]])

    total_rows = 0
    for i, t in enumerate(tables, 1):
        rows = t.get("row_count") or 0
        total_rows += rows
        hdr = f"{i}. {t[key]}"
        extra = []
        if rows:
            extra.append(f"{rows:,} rows")
        if t.get("reserved_word_risk"):
            extra.append(f"RESERVED WORD -> use {t['alt_name']} if the console refuses")
        if t.get("plane"):
            extra.append(t["plane"])
        print(f"\n{hdr}   [{' · '.join(extra)}]" if extra else f"\n{hdr}")
        print("   " + "-" * 62)
        for c in t["columns"]:
            typ = c["data_type"]
            if typ == "varchar":
                typ = f"varchar({c.get('max_length', 255)})"
            prov = c.get("provenance")
            note = f"   <- {prov}" if prov and prov != "populated" else ""
            print(f"   {c['column_name']:<34}{typ}{note}")

    print("\n" + "=" * 66)
    print(f"{len(tables)} table(s)" + (f", {total_rows:,} rows to load" if total_rows else ""))
    if not (a.all or a.er or a.only):
        print("\nDo NOT create these — pinned CSV-only in store.js by design:")
        print("   " + ", ".join(NEVER_CREATE))
    print("\nCatalyst adds ROWID / CREATORID / CREATEDTIME / MODIFIEDTIME itself — do not add them.")


if __name__ == "__main__":
    main()
