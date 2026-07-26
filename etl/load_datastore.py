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
import er_schema

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
    # Phase 3 — predictive (forecasts/alerts/risk/anomalies; predictions derived from real data)
    "forecasts": [("level", V), ("key", V), ("category", V), ("year", B), ("month", B),
                  ("y_actual", D), ("yhat", D), ("yhat_lower", D), ("yhat_upper", D),
                  ("is_forecast", B), ("method", V)],
    "alerts": [("canonical_name", V), ("kgis_code", V), ("category", V), ("period", V),
               ("actual", B), ("baseline", D), ("deviation_pct", D), ("severity", V), ("reason", V)],
    "risk_scores": [("canonical_name", V), ("kgis_code", V), ("population", B),
                    ("predicted_next", B), ("risk_score", D), ("risk_tier", V), ("top_drivers", V)],
    "anomalies": [("canonical_name", V), ("kgis_code", V), ("year", B), ("month", B),
                  ("category", V), ("count", B), ("expected", D), ("anomaly_score", D), ("reason", V)],
    # Phase 4 — patterns / MO clustering + case-outcome (models derived from real data)
    "mo_clusters": [("cluster_id", B), ("size", B), ("share_pct", D), ("top_crime_head", V),
                    ("head_purity", D), ("top_crime_subhead", V), ("top_section", V),
                    ("top_districts", V), ("heinous_share", D), ("season_profile", V),
                    ("time_profile", V), ("mo_description", V)],
    "mo_assignments": [("crime_subhead", V), ("cluster_id", B), ("n", B)],
    "agg_temporal": [("district", V), ("dow", B), ("month", B), ("season", V), ("count", B)],
    "outcomes_by_district": [("district", V), ("kgis_code", V), ("cases", B), ("detected", B),
                             ("undetected", B), ("detection_rate", D), ("convicted", B),
                             ("conviction_rate", D)],
    "outcome_drivers": [("feature", V), ("importance_detection_pct", D),
                        ("importance_multiclass_pct", D)],
    # Phase 5 — entity network (Module A) + socio-economic correlation (Module B)
    "network_nodes": [("node", V), ("node_type", V), ("degree", B), ("weighted_degree", B),
                      ("cases", B), ("community_id", B), ("pagerank", D), ("betweenness", D),
                      ("is_hub", V), ("top_districts", V)],
    "network_edges": [("src", V), ("src_type", V), ("dst", V), ("dst_type", V),
                      ("weight", B), ("log_weight", D), ("src_community", B), ("dst_community", B)],
    "network_communities": [("community_id", B), ("size", B), ("n_crime_heads", B), ("n_acts", B),
                            ("total_cases", B), ("top_entity", V), ("members", V),
                            ("top_districts", V), ("theme", V), ("description", V)],
    "association_rules": [("rule_type", V), ("antecedent_type", V), ("antecedent", V),
                          ("consequent_type", V), ("consequent", V), ("cases", B), ("support", D),
                          ("confidence", D), ("lift", D), ("reading", V)],
    "socio_correlations": [("indicator", V), ("label", V), ("group", V), ("is_protected", V),
                           ("n", B), ("pearson_r", D), ("p_value", D), ("spearman_r", D),
                           ("spearman_p", D), ("significant", V), ("strength", V),
                           ("direction", V), ("partial_r_ctrl_literacy", D), ("note", V),
                           ("caveat", V)],
    "agg_hotspots_timed": [("lat", D), ("lng", D), ("time_bucket", V), ("major_head", V),
                           ("year", B), ("count", B)],
    "validation_results": [("test", V), ("what_it_proves", V), ("metric", V), ("value", D),
                           ("unit", V), ("baseline_name", V), ("baseline_value", D),
                           ("verdict", V), ("extra", V), ("n", B)],
    "socio_districts": [("census_code_2011", V), ("district", V), ("district_2011_name", V),
                        ("population_2011", B),
                        ("crimes_per_100k", D), ("total_crimes_all_years", B),
                        ("literacy_rate", D), ("urban_share", D), ("sc_share", D),
                        ("st_share", D), ("sex_ratio_f_per_1000m", D)],
    # Person network — SYNTHETIC demo plane (syn_*) + the PPRL linkage engine's output.
    # Kept in the same store but namespaced, and every API payload built from these is
    # data_class="synthetic". They must never be joined to a real table.
    "syn_persons": [("person_id", V), ("name", V), ("father_name", V), ("gender", V),
                    ("age", B), ("home_district", V), ("is_repeat_offender", V), ("n_cases", B)],
    "syn_cases": [("case_id", V), ("district", V), ("year", B), ("crime_head", V)],
    "syn_person_case": [("case_id", V), ("person_id", V), ("role", V), ("name_as_recorded", V),
                        ("father_name_as_recorded", V), ("age_as_recorded", B), ("gender", V),
                        ("district", V), ("year", B)],
    "syn_network_edges": [("src", V), ("dst", V), ("edge_type", V), ("case_id", V)],
    "syn_offender_profiles": [("person_id", V), ("name", V), ("gender", V), ("age", B),
                              ("n_cases", B), ("districts", V), ("n_districts", B),
                              ("mo_summary", V), ("case_ids", V), ("years", V)],
    "syn_linked_persons": [("case_id", V), ("person_token", V), ("role", V), ("district", V),
                           ("year", B)],
}
VARCHAR_MIN = 255      # floor: never declare a column narrower than this
VARCHAR_BUCKETS = (255, 500, 1000, 2000)   # round the measured max up to one of these
VARCHAR_HEADROOM = 1.5  # allow for the text growing when a model is re-run
MODELED = {"agg_timeofday"}


def catalystrc():
    """Read the project/env linked by `catalyst init` (repo-root .catalystrc), if present.

    Lets --load pick up CATALYST_PROJECT_ID / CATALYST_ENVIRONMENT automatically so only the
    OAuth secrets have to be supplied by the user. Never contains secrets itself.
    """
    p = os.path.join(paths.REPO_ROOT, ".catalystrc")
    if not os.path.exists(p):
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            rc = json.load(f)
        active = rc.get("actives", {}).get("project") or rc.get("defaults", {}).get("project")
        proj = next((x for x in rc.get("projects", []) if x.get("idx") == active), None)
        if not proj:
            return {}
        envs = proj.get("env", [])
        env_name = envs[0].get("name") if envs else None
        return {"project_id": str(proj.get("id") or ""), "project_name": proj.get("name"),
                "environment": env_name, "domain_hint": (proj.get("domain") or {}).get("name")}
    except (ValueError, KeyError, TypeError):
        return {}


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
def measure_varchar(table, cols):
    """Longest actual value per varchar column -> a right-sized max_length.

    Some generated text (plain-language rule readings, ethics caveats) exceeds 255 chars, which
    a flat varchar(255) would silently truncate on load. Measure, add headroom, round to a bucket.
    """
    widths = {}
    p = csv_path(table)
    if not os.path.exists(p):
        return {c: VARCHAR_MIN for c, t in cols if t == V}
    longest = {c: 0 for c, t in cols if t == V}
    if longest:
        with open(p, encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                for c in longest:
                    v = row.get(c) or ""
                    if len(v) > longest[c]:
                        longest[c] = len(v)
    for c, ln in longest.items():
        need = int(ln * VARCHAR_HEADROOM)
        widths[c] = next((b for b in VARCHAR_BUCKETS if b >= max(need, VARCHAR_MIN)),
                         VARCHAR_BUCKETS[-1])
    return widths


def er_row_counts():
    """Row counts for the ER contract entities, measured — never guessed.

    CaseMaster / ActSectionAssociation come from build_er_core.py's stats file; the reference
    entities from the CSV that backs them. Everything else is genuinely 0 (declared, unpopulated).
    """
    counts = {}
    stats_p = os.path.join(paths.OUT_DIR, "er_core_stats.json")
    if os.path.exists(stats_p):
        with open(stats_p, encoding="utf-8") as f:
            st = json.load(f)
        for ent in ("CaseMaster", "ActSectionAssociation"):
            if ent in st:
                counts[ent] = int(st[ent].get("rows") or 0)
    for ent, meta in er_schema.ER_ENTITIES.items():
        t = meta.get("our_table")
        if not t or ent in counts:
            continue
        p = csv_path(t)
        if os.path.exists(p):
            counts[ent] = sum(1 for _ in open(p, encoding="utf-8")) - 1
    return counts


def emit_er_conformance():
    """Standalone er_conformance.json — bundled into the function and served at /schema/er."""
    doc = er_schema.conformance(er_row_counts())
    out = os.path.join(paths.OUT_DIR, "er_conformance.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
    by = doc["by_status"]
    print(f"[schema] wrote {out} ({doc['entities_total']} ER entities: "
          + ", ".join(f"{k}={v}" for k, v in sorted(by.items())) + ")")
    return doc


def emit_schema():
    tables = []
    for table, cols in SCHEMA.items():
        n = sum(1 for _ in open(csv_path(table), encoding="utf-8")) - 1 if os.path.exists(csv_path(table)) else None
        widths = measure_varchar(table, cols)
        tables.append({
            "table_name": table,
            "data_class": "modeled" if table in MODELED else "real",
            "row_count": n,
            "columns": [
                {"column_name": c, "data_type": t,
                 **({"max_length": widths.get(c, VARCHAR_MIN)} if t == V else {})}
                for c, t in cols
            ],
        })
    counts = er_row_counts()
    doc = {
        "note": "Create these tables in the Catalyst console (Data Store) or via CSV-import, "
                "then run `python etl/load_datastore.py --load`. Column types per schema.md \u00a7A.",
        "reserved_name_caveat": "Columns count/year/month/rank are valid user columns; the API "
                                "reads via SELECT * and never references them directly.",
        # Two independent groups, deliberately NOT merged:
        #   serving_tables    - what the API reads. Analytical shape (dims + aggregates + model
        #                       outputs). This is what --load populates.
        #   er_contract_tables- the 28 KSP ER entities under their EXACT ER names and columns, so
        #                       real SCRB data could be loaded with no translation layer. Most are
        #                       intentionally empty; --load never touches them.
        # Keeping them separate is the point: it makes visible which is our analytics schema and
        # which is KSP's design, instead of blurring the two into one ambiguous list.
        "tables": tables,
        "er_contract_tables": er_schema.contract_tables(counts),
        "er_conformance_summary": {
            "source_document": "datasets/Police_FIR_ER_Diagram.pdf (KSP)",
            "entities_total": len(er_schema.ER_ENTITIES),
            "detail": "etl/out/er_conformance.json — also served at GET /schema/er",
        },
        "tables_count": len(tables),
        "er_contract_tables_count": len(er_schema.ER_ENTITIES),
    }
    out = os.path.join(paths.OUT_DIR, "datastore_schema.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
    print(f"[schema] wrote {out} ({len(tables)} serving tables "
          f"+ {len(er_schema.ER_ENTITIES)} ER contract tables)")
    emit_er_conformance()
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
    rc = catalystrc()
    if rc.get("project_id"):
        print(f"[load] .catalystrc: project '{rc.get('project_name')}' ({rc['project_id']}) "
              f"env={rc.get('environment')}")
    # project id + environment can come from .catalystrc; the SECRETS must come from the env.
    pid = os.environ.get("CATALYST_PROJECT_ID") or rc.get("project_id")
    env = os.environ.get("CATALYST_ENVIRONMENT") or rc.get("environment") or "Development"
    missing = [k for k in ("CATALYST_API_DOMAIN", "ZOHO_ACCOUNTS_URL", "ZOHO_CLIENT_ID",
                           "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN")
               if not os.environ.get(k)]
    if not pid:
        missing.insert(0, "CATALYST_PROJECT_ID (and no .catalystrc found)")
    if missing:
        print("!! --load needs Catalyst/Zoho credentials. Missing env vars:")
        for m in missing:
            print(f"     {m}")
        print("\n   Set them yourself (never paste secrets into shared logs/chats); see the module")
        print("   docstring. The app keeps serving the same REAL tables from the bundled CSVs meanwhile.")
        return 2

    domain = os.environ["CATALYST_API_DOMAIN"].rstrip("/")
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
