"""Catalyst Data Store loader for the Phase-0 serving tables.

The app runs fully on the bundled CSV fallback, so this step is OPTIONAL — run it once
you want the deployed crime_api to read from the Catalyst Data Store (then set the function
env var USE_DATASTORE=true; it still falls back to CSV on any error).

Catalyst has **no public "create table" API** — tables are created in the Catalyst console.
So this tool:
  1. `--plan`   (default) inventories the CSVs + row counts. Always runnable, no creds.
  2. `--schema` writes etl/out/datastore_schema.json — the exact table/column/type spec to
                create the tables in the console (or via console CSV-import).
  3. `--load`   idempotently loads the CSV rows into EXISTING Data Store tables via the
                Catalyst Data Store REST API (needs the user's OAuth creds — see below).

Prerequisites for --load (set as environment variables):
  CATALYST_PROJECT_ID     your Catalyst project id
  CATALYST_API_DOMAIN     e.g. https://api.catalyst.zoho.com  (or .zoho.in / .zoho.eu)
  CATALYST_ENVIRONMENT    Development | Production   (default Development)
  ZOHO_ACCOUNTS_URL       e.g. https://accounts.zoho.com     (region-matched)
  ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN   (self-client OAuth;
                          scope: ZohoCatalyst.tables.rows.CREATE, .DELETE, ZohoCatalyst.tables.READ)

Run:
  python etl/load_datastore.py                 # plan (dry run)
  python etl/load_datastore.py --schema        # emit datastore_schema.json
  python etl/load_datastore.py --load          # load all tables (idempotent: truncate+insert)
  python etl/load_datastore.py --load --only agg_outcomes dim_district
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.request
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import paths

# Authoritative Data Store schema (from schema.md §A). Catalyst column types:
# varchar (needs max length), bigint, double, boolean. Reserved-ish names (count, year,
# month, rank) are fine as user columns; the API reads via SELECT * so never references them.
V, B, D, BOOL = "varchar", "bigint", "double", "boolean"
SCHEMA = {
    "dim_district": [("canonical_name", V), ("kgis_code", V), ("lgd_code", V),
                     ("census_code_2011", V), ("is_geographic", V), ("parent_district", V)],
    "dim_crime_head": [("major_head", V), ("count", B)],
    "dim_crime_subhead": [("major_head", V), ("sub_head", V), ("count", B)],
    "dim_case_status": [("status", V), ("count", B)],
    "dim_gravity": [("gravity", V), ("count", B)],
    "dim_complaint_mode": [("complaint_mode", V), ("count", B)],
    "dim_act": [("act", V), ("count", B)],
    "dim_section": [("act", V), ("section", V), ("count", B)],
    "dim_rank": [("rank", V), ("count", B)],
    "agg_district_month": [("canonical_name", V), ("year", B), ("month", B),
                           ("major_head", V), ("count", B)],
    "agg_hotspots": [("lat", D), ("lng", D), ("geo_precision", V), ("year", B), ("count", B)],
    "agg_unit": [("unit_name", V), ("canonical_name", V), ("parent_district", V),
                 ("kgis_code", V), ("count", B), ("n_with_coord", B),
                 ("mean_lat", D), ("mean_lng", D)],
    "agg_outcomes": [("canonical_name", V), ("total_cases", B), ("heinous_cases", B),
                     ("victims", B), ("accused", B), ("arrested", B), ("chargesheeted", B),
                     ("convicted", B), ("arrest_rate", D), ("chargesheet_rate", D),
                     ("conviction_rate", D), ("detection_rate", D)],
    "agg_case_status": [("canonical_name", V), ("status", V), ("count", B)],
    "agg_socioeconomic": [("census_code_2011", V), ("district_2011_name", V),
                          ("population_2011", B), ("total_crimes_all_years", B),
                          ("crimes_per_100k", D), ("literacy_rate", D), ("sc_share", D),
                          ("st_share", D), ("sex_ratio_f_per_1000m", D)],
    "agg_timeofday": [("canonical_name", V), ("major_head", V), ("modeled_time_of_day", V),
                      ("method", V), ("count", B)],  # data_class = modeled
    "entity_edges": [("src_type", V), ("src", V), ("dst_type", V), ("dst", V), ("weight", B)],
    # Phase 2 — geospatial hotspots (real; district-centroid points excluded upstream)
    "hotspot_cells": [("lat", D), ("lng", D), ("count", B), ("density", D),
                      ("cluster_id", B), ("geo_precision", V), ("year", B)],
    "hotspot_clusters": [("cluster_id", B), ("centroid_lat", D), ("centroid_lng", D),
                         ("n_points", B), ("total_count", B), ("canonical_name", V),
                         ("radius_km", D), ("top_category", V), ("deployment_note", V)],
}
VARCHAR_MAX = 255  # every string column here is well under 255 chars
MODELED = {"agg_timeofday"}


def csv_path(table):
    p = os.path.join(paths.OUT_DIR, f"{table}.csv")
    if os.path.exists(p):
        return p
    ml = os.path.join(paths.REPO_ROOT, "ml", "out", f"{table}.csv")  # Phase 2 model outputs
    return ml if os.path.exists(ml) else p


def read_rows(table):
    with open(csv_path(table), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def coerce(row, cols):
    """Coerce CSV strings to the target types for JSON insert (blank -> None)."""
    out = {}
    for name, typ in cols:
        raw = row.get(name, "")
        if raw is None or raw == "":
            out[name] = None
        elif typ == B:
            try: out[name] = int(float(raw))
            except ValueError: out[name] = None
        elif typ == D:
            try: out[name] = float(raw)
            except ValueError: out[name] = None
        else:
            out[name] = str(raw)
    return out


# ----------------------------- actions --------------------------------------
def emit_schema():
    tables = []
    for table, cols in SCHEMA.items():
        n = sum(1 for _ in open(csv_path(table), encoding="utf-8")) - 1 if os.path.exists(csv_path(table)) else None
        tables.append({
            "table_name": table,
            "data_class": "modeled" if table in MODELED else "real",
            "row_count": n,
            "columns": [
                {"column_name": c, "data_type": t, **({"max_length": VARCHAR_MAX} if t == V else {})}
                for c, t in cols
            ],
        })
    doc = {
        "note": "Create these tables in the Catalyst console (Data Store) or via CSV-import, "
                "then run `python etl/load_datastore.py --load`. Column types per schema.md \u00a7A.",
        "reserved_name_caveat": "Columns count/year/month/rank are valid user columns; the API "
                                "reads via SELECT * and never references them directly.",
        "tables": tables,
    }
    out = os.path.join(paths.OUT_DIR, "datastore_schema.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
    print(f"[schema] wrote {out} ({len(tables)} tables)")
    return 0


def plan(only=None):
    print(f"Catalyst Data Store load plan (dry run) — source: {paths.OUT_DIR}\n")
    total = 0
    for table, cols in SCHEMA.items():
        if only and table not in only:
            continue
        p = csv_path(table)
        if not os.path.exists(p):
            print(f"  [MISSING] {table}")
            continue
        n = sum(1 for _ in open(p, encoding="utf-8")) - 1
        total += n
        tag = "  (data_class=modeled)" if table in MODELED else ""
        print(f"  {table:22} {n:>8,} rows  [{len(cols)} cols]{tag}")
    print(f"\nTotal rows across serving tables: {total:,}")
    print("Run --schema to emit datastore_schema.json, then --load (with Catalyst creds) to populate.")
    return 0


# ----------------------------- REST loader -----------------------------------
def _http(method, url, token=None, body=None, form=False):
    data = None
    headers = {}
    if body is not None:
        if form:
            data = urllib.parse.urlencode(body).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Zoho-oauthtoken {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode() or "{}")


def _access_token():
    acc = os.environ["ZOHO_ACCOUNTS_URL"].rstrip("/")
    tok = _http("POST", f"{acc}/oauth/v2/token", form=True, body={
        "grant_type": "refresh_token",
        "client_id": os.environ["ZOHO_CLIENT_ID"],
        "client_secret": os.environ["ZOHO_CLIENT_SECRET"],
        "refresh_token": os.environ["ZOHO_REFRESH_TOKEN"],
    })
    if "access_token" not in tok:
        raise RuntimeError(f"OAuth refresh failed: {tok}")
    return tok["access_token"]


def load(only=None, batch=100):
    missing = [k for k in ("CATALYST_PROJECT_ID", "CATALYST_API_DOMAIN", "ZOHO_ACCOUNTS_URL",
                           "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN")
               if not os.environ.get(k)]
    if missing:
        print("!! --load needs Catalyst/Zoho credentials. Missing env vars:")
        for m in missing:
            print(f"     {m}")
        print("\n   See the module docstring. The app still works on the bundled CSV fallback.")
        return 2

    pid = os.environ["CATALYST_PROJECT_ID"]
    domain = os.environ["CATALYST_API_DOMAIN"].rstrip("/")
    env = os.environ.get("CATALYST_ENVIRONMENT", "Development")
    base = f"{domain}/baas/v1/project/{pid}"
    token = _access_token()
    print(f"[load] project={pid} env={env} domain={domain}")

    tables = [t for t in SCHEMA if not only or t in only]
    for table in tables:
        cols = SCHEMA[table]
        rows = read_rows(table)
        # idempotent: clear existing rows first (ZCQL DELETE), then bulk-insert.
        try:
            _http("POST", f"{base}/query?environment={env}", token=token,
                  body={"query": f"DELETE FROM {table}"})
        except Exception as e:  # table may be empty/new — continue
            print(f"   ({table}) truncate note: {e}")
        inserted = 0
        for i in range(0, len(rows), batch):
            chunk = [coerce(r, cols) for r in rows[i:i + batch]]
            _http("POST", f"{base}/table/{table}/row?environment={env}", token=token, body=chunk)
            inserted += len(chunk)
        print(f"   {table:22} loaded {inserted:,} rows")
        time.sleep(0.05)
    print("[load] done. Set the crime_api env var USE_DATASTORE=true to read from Data Store.")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Catalyst Data Store loader for etl/out serving tables")
    ap.add_argument("--schema", action="store_true", help="emit datastore_schema.json for console table creation")
    ap.add_argument("--load", action="store_true", help="load rows into existing Data Store tables (needs creds)")
    ap.add_argument("--only", nargs="*", help="restrict to specific table names")
    args = ap.parse_args()
    only = set(args.only) if args.only else None
    if args.schema:
        return emit_schema()
    if args.load:
        return load(only=only)
    return plan(only=only)


if __name__ == "__main__":
    raise SystemExit(main())
