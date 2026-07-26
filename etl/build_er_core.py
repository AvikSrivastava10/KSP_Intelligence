"""Materialise the ER contract's transactional core (offline, one streaming pass).

WHY THIS EXISTS
`schema.md` claimed two things that were never actually built:

  1. "`case_master` ... materialized case-level in Phase 1" — there was no case_master table
     anywhere, in the Data Store schema or on disk. The case grain existed only as
     case_features.parquet, which is an ML feature table (15 model-safe columns, ER names nowhere).
  2. "Surrogate `case_id` — a deterministic surrogate is assigned so `CaseMaster` has a primary
     key" — no such identifier existed in any ETL script. `grep case_id etl/**/*.py` returned
     nothing, and build_modeling_table.py states outright that no surrogate is needed for its
     purposes. So the primary key the entire ER mapping depends on was documentation only.

It also fixes a mapping error: schema.md mapped ActSectionAssociation to `dim_section`, but
dim_section is the ER's `Section` reference list (distinct act-section pairs with counts). The
ER's ActSectionAssociation is PER CASE and one-to-many. That link had been collapsed to a single
first_act/first_section, so a case citing three acts kept one. This emits the true grain.

OUTPUTS (ER-faithful column names, from etl/common/er_schema.py)
  etl/out/case_master.parquet              1 row per FIR
  etl/out/act_section_association.parquet  1 row per (case, act, section)
  etl/out/er_core_stats.json               row counts + provenance, for the schema emitter

Both are gitignored regenerable intermediates and are NOT bundled with the function: at ~1.67M and
~3M rows they are far too large for the CSV-fallback pattern, and the API is aggregate-only by
design. They exist so the ER contract is genuinely loadable into a Data Store, and so the claim
"we materialise CaseMaster" is true rather than aspirational.

THE SURROGATE KEY, AND WHAT IT DELIBERATELY IS NOT
CaseMasterID is `CM-` + a 9-digit positional ordinal over the source file. Deterministic for a
fixed input, and obviously artificial.

CrimeNo and CaseNo are left NULL on purpose. The ER documents their exact composition (category +
district + unit + year + serial), so conforming values could be generated — and would be
indistinguishable from real KSP crime numbers by anyone reading the table. A fabricated identifier
that looks official is a worse outcome than an honest null.

Run:  python etl/build_er_core.py
      python etl/build_er_core.py --limit 1     (first chunk, smoke test)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from common import paths
from common.districts import DISTRICT_MAP, resolve as resolve_district
from common.textutils import (
    build_rename_map, clean_cat, normalize_status, normalize_gravity,
    parse_act_section, CLEAN_COLUMNS,
)

EXPECTED_ROWS = 1_674_734
CHUNK = 200_000
PARTIAL_YEAR = 2024

# Same KA bbox validation as Phase 0 (inlined to avoid pulling in rapidfuzz).
KA_LON, KA_LAT = (73.8, 78.9), (11.4, 18.7)


def valid_coord(lat, lon):
    try:
        lat = float(lat); lon = float(lon)
    except (TypeError, ValueError):
        return None
    if lat == 0 and lon == 0:
        return None
    if KA_LAT[0] <= lat <= KA_LAT[1] and KA_LON[0] <= lon <= KA_LON[1]:
        return (lat, lon)
    if KA_LAT[0] <= lon <= KA_LAT[1] and KA_LON[0] <= lat <= KA_LON[1]:
        return (lon, lat)
    return None


# ER-faithful schemas. Names match etl/er_schema.py exactly — that is the whole point.
CASE_MASTER_SCHEMA = pa.schema([
    ("CaseMasterID", pa.string()),
    ("CrimeNo", pa.string()),                 # deliberately null — see module docstring
    ("CaseNo", pa.string()),                  # deliberately null
    ("CrimeRegisteredDate", pa.string()),     # ISO date; no time in the extract
    ("PolicePersonID", pa.string()),          # IO name+rank string, not an Employee FK
    ("PoliceStationID", pa.string()),         # unit name
    ("CaseCategoryID", pa.string()),          # null — FIR-only extract
    ("GravityOffenceID", pa.string()),
    ("CrimeMajorHeadID", pa.string()),
    ("CrimeMinorHeadID", pa.string()),
    ("CaseStatusID", pa.string()),
    ("CourtID", pa.string()),                 # null
    ("IncidentFromDate", pa.string()),        # null — the key absence
    ("IncidentToDate", pa.string()),          # null
    ("InfoReceivedPSDate", pa.string()),      # null
    ("latitude", pa.float64()),
    ("longitude", pa.float64()),
    ("BriefFacts", pa.string()),              # null — no narrative text
    # reconstructed additions, declared in er_schema.ER_ENTITIES["CaseMaster"]["extra_columns"]
    ("canonical_name", pa.string()),
    ("parent_district", pa.string()),
    ("geo_precision", pa.string()),
    ("is_2024_partial", pa.int8()),
])

ASSOC_SCHEMA = pa.schema([
    ("CaseMasterID", pa.string()),
    ("ActID", pa.string()),          # act name (no codes in the extract)
    ("SectionID", pa.string()),      # section code
    ("ActOrderID", pa.int16()),
    ("SectionOrderID", pa.int16()),
])


def surrogate_ids(start, n):
    """Deterministic positional surrogates. Obviously artificial, never mistaken for a CrimeNo."""
    return [f"CM-{i:09d}" for i in range(start, start + n)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="process only N chunks (smoke test)")
    args = ap.parse_args()
    partial = bool(args.limit)

    t0 = time.time()
    out_dir = paths.ensure_out()
    cm_path = os.path.join(out_dir, "case_master.smoke.parquet" if partial else "case_master.parquet")
    as_path = os.path.join(out_dir, "act_section_association.smoke.parquet" if partial
                           else "act_section_association.parquet")

    dist_attrs = {raw: resolve_district(raw) for raw in DISTRICT_MAP}
    act_cache = {}
    cm_writer = pq.ParquetWriter(cm_path, CASE_MASTER_SCHEMA, compression="zstd")
    as_writer = pq.ParquetWriter(as_path, ASSOC_SCHEMA, compression="zstd")

    total = 0
    assoc_rows = 0
    real_coords = 0
    cases_with_multi_act = 0
    rename = None

    reader = pd.read_csv(paths.FIR_CSV, dtype=str, keep_default_na=False, na_filter=False,
                         encoding="utf-8-sig", chunksize=CHUNK)
    try:
        for ci, chunk in enumerate(reader):
            if rename is None:
                rename = build_rename_map(list(chunk.columns))
                missing = set(CLEAN_COLUMNS) - set(rename.values())
                if missing:
                    raise ValueError(f"Missing expected columns after rename: {missing}")
            chunk = chunk.rename(columns=rename)
            ids = surrogate_ids(total, len(chunk))

            # ---- district resolution (same canonical map as every other screen) ----
            da = chunk["district_name"].map(lambda d: dist_attrs.get((d or "").strip()))
            canon = da.map(lambda a: a["canonical_name"] if a else "UNKNOWN")
            parent = da.map(lambda a: (a["parent_district"] or a["canonical_name"]) if a else "UNKNOWN")

            # ---- registration date (date only; the extract carries no time) ----
            y = pd.to_numeric(chunk["year"], errors="coerce")
            m = pd.to_numeric(chunk["month"], errors="coerce")
            d = pd.to_numeric(chunk["day"], errors="coerce")
            dt = pd.to_datetime(dict(year=y, month=m, day=d), errors="coerce")
            reg = dt.dt.strftime("%Y-%m-%d").fillna("")

            # ---- coordinates + honest precision tag ----
            coords = [valid_coord(la, lo) for la, lo in zip(chunk["latitude"], chunk["longitude"])]
            real_coords += sum(1 for c in coords if c)
            lat = [c[0] if c else None for c in coords]
            lon = [c[1] if c else None for c in coords]
            prec = ["point" if c else "unresolved" for c in coords]

            cm = pd.DataFrame({
                "CaseMasterID": ids,
                "CrimeNo": None, "CaseNo": None,
                "CrimeRegisteredDate": reg.to_numpy(),
                "PolicePersonID": chunk["io_name"].map(clean_cat).to_numpy(),
                "PoliceStationID": chunk["unit_name"].map(clean_cat).to_numpy(),
                "CaseCategoryID": None,
                "GravityOffenceID": chunk["gravity_raw"].map(normalize_gravity).to_numpy(),
                "CrimeMajorHeadID": chunk["major_head"].map(clean_cat).to_numpy(),
                "CrimeMinorHeadID": chunk["sub_head"].map(clean_cat).to_numpy(),
                "CaseStatusID": chunk["status_raw"].map(normalize_status).to_numpy(),
                "CourtID": None,
                "IncidentFromDate": None, "IncidentToDate": None, "InfoReceivedPSDate": None,
                "latitude": lat, "longitude": lon,
                "BriefFacts": None,
                "canonical_name": canon.to_numpy(),
                "parent_district": parent.where(parent.astype(bool), canon).to_numpy(),
                "geo_precision": prec,
                "is_2024_partial": (y == PARTIAL_YEAR).fillna(False).astype("int8").to_numpy(),
            })
            cm_writer.write_table(pa.Table.from_pandas(cm, schema=CASE_MASTER_SCHEMA,
                                                       preserve_index=False))

            # ---- ActSectionAssociation at TRUE one-to-many grain ----
            def parse(s):
                v = act_cache.get(s)
                if v is None:
                    _fa, _fs, _acts, pairs = parse_act_section(s)
                    v = pairs
                    act_cache[s] = v
                return v

            rows = []
            for cid, raw in zip(ids, chunk["act_section"]):
                pairs = parse(raw)
                if not pairs:
                    continue
                # Per-case counters. An earlier version derived SectionOrderID by re-scanning the
                # accumulated `rows` list, which is O(n^2) over ~400k rows per chunk — it would
                # never have finished. Counters make it a single pass.
                act_order, sec_count = {}, {}
                for a, sec in pairs:
                    if a not in act_order:
                        act_order[a] = len(act_order) + 1
                    sec_count[a] = sec_count.get(a, 0) + 1
                    rows.append((cid, a, sec, act_order[a], sec_count[a]))
                if len(act_order) > 1:
                    cases_with_multi_act += 1
            if rows:
                adf = pd.DataFrame(rows, columns=["CaseMasterID", "ActID", "SectionID",
                                                  "ActOrderID", "SectionOrderID"])
                adf["ActOrderID"] = adf["ActOrderID"].astype("int16")
                adf["SectionOrderID"] = adf["SectionOrderID"].astype("int16")
                as_writer.write_table(pa.Table.from_pandas(adf, schema=ASSOC_SCHEMA,
                                                           preserve_index=False))
                assoc_rows += len(adf)

            total += len(chunk)
            if (ci + 1) % 3 == 0 or partial:
                print(f"  chunk {ci+1}: {total:,} cases, {assoc_rows:,} act-sections "
                      f"({time.time()-t0:.0f}s)")
            if partial and (ci + 1) >= args.limit:
                print(f"[er-core] --limit {args.limit} reached, stopping early.")
                break
    finally:
        cm_writer.close()
        as_writer.close()

    stats = {
        "generated_at_utc": pd.Timestamp.utcnow().isoformat(),
        "partial_run": partial,
        "CaseMaster": {
            "rows": total,
            "reconciles_to_source": (total == EXPECTED_ROWS) if not partial else None,
            "expected_rows": EXPECTED_ROWS,
            "file": os.path.basename(cm_path),
            "size_kb": os.path.getsize(cm_path) // 1024,
        },
        "ActSectionAssociation": {
            "rows": assoc_rows,
            "cases_citing_multiple_acts": cases_with_multi_act,
            "avg_sections_per_case": round(assoc_rows / total, 3) if total else 0,
            "file": os.path.basename(as_path),
            "size_kb": os.path.getsize(as_path) // 1024,
        },
        "notes": {
            "surrogate_key": "CaseMasterID = CM-<9-digit positional ordinal>. Deterministic for a "
                             "fixed source file, and obviously artificial.",
            "null_by_design": ["CrimeNo", "CaseNo", "CourtID", "CaseCategoryID",
                               "IncidentFromDate", "IncidentToDate", "InfoReceivedPSDate",
                               "BriefFacts"],
            "why_crimeno_null": "The ER documents the exact CrimeNo format, so conforming values "
                                "could be synthesised — and would be indistinguishable from real "
                                "KSP crime numbers. A fabricated official-looking identifier is "
                                "worse than an honest null.",
            "not_bundled": "Too large for the function's CSV-fallback bundle, and the API is "
                           "aggregate-only by design. These exist so the ER contract is genuinely "
                           "loadable, not to be served per-case.",
        },
    }
    if not partial:
        with open(os.path.join(out_dir, "er_core_stats.json"), "w", encoding="utf-8") as f:
            json.dump(stats, f, indent=2)

    print("\n" + "=" * 70)
    print("ER TRANSACTIONAL CORE" + ("  (PARTIAL/SMOKE)" if partial else ""))
    print("=" * 70)
    print(f"CaseMaster              : {total:,} rows ({stats['CaseMaster']['size_kb']:,} KB)")
    if not partial:
        ok = "OK" if total == EXPECTED_ROWS else "!! MISMATCH"
        print(f"  reconciles to source  : {EXPECTED_ROWS:,}  [{ok}]")
    print(f"  real GPS coordinates  : {real_coords:,} ({100*real_coords/total:.1f}%)")
    print(f"ActSectionAssociation   : {assoc_rows:,} rows "
          f"({stats['ActSectionAssociation']['size_kb']:,} KB)")
    print(f"  avg sections per case : {stats['ActSectionAssociation']['avg_sections_per_case']}")
    print(f"  cases citing 2+ acts  : {cases_with_multi_act:,} "
          f"<- previously collapsed to one act by first_act/first_section")
    print(f"[er-core] done in {time.time()-t0:.0f}s")
    if not total == EXPECTED_ROWS and not partial:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
