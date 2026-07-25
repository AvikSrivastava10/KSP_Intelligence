"""Phase 4 - Modeling-table builder (offline, single streaming pass).

Streams the raw FIR extract once and emits the inputs the Phase-4 models need:

  * case_features.parquet  - one row per case (= one FIR), feature columns + the
                             label ``fir_stage``. Gitignored (regenerable intermediate).
  * agg_temporal.csv       - day-of-week x month (x district) counts for the heatmap.

Each FIR row is one case, so no surrogate case_id / join is needed here.

TWO CORRECTNESS GUARDS baked in (see CASE_FEATURE_COLS + EXCLUDED below):
  * LEAKAGE: the label is FIR_Stage. No outcome-derived field is emitted as a feature -
    Arrested*/Accused_ChargeSheeted/Conviction counts are dropped entirely. accused_count
    (persons named in the FIR, known at filing) and victims TOTAL are kept per spec.
  * FAIRNESS: victims is a TOTAL only (Male+Female+Boy+Girl summed); the sex split is never
    emitted. No caste/religion (absent from the data anyway). Modeled time-of-day is NOT
    emitted here (it is derived from crime type -> circular for the outcome model).

geo_precision is captured as a lightweight ``has_coord`` flag (real KA-valid GPS present or
not) rather than the full Phase-0 5-tier resolve, to keep this a fast single pass. Documented
as a simplification.

Run:  python etl/build_modeling_table.py            (full)
      python etl/build_modeling_table.py --limit 1  (first chunk, smoke test)
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from collections import defaultdict

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

# Inlined from common.geo (importing it pulls in rapidfuzz, which we don't need here).
# Same KA bbox + auto-unswap logic as Phase 0's geo.valid_coord.
KA_LON, KA_LAT = (73.8, 78.9), (11.4, 18.7)


def valid_coord(lat, lon):
    """Return (lat, lon) if a plausible Karnataka coordinate (auto-unswaps), else None."""
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

EXPECTED_ROWS = 1_674_734
CHUNK = 200_000

# Columns written to case_features.parquet. Anything outcome-derived is intentionally absent.
CASE_FEATURE_COLS = [
    "year", "month", "dow", "season",
    "district", "crime_head", "crime_subhead", "gravity", "complaint_mode",
    "first_act", "first_section", "victims", "accused_count", "has_coord",
    "fir_stage",  # <- label
]
# Explicitly dropped (leakage / fairness) - documented, never emitted:
EXCLUDED = ["arrested_count", "arrested_male", "arrested_female",
            "chargesheeted_count", "conviction_count",   # leakage (downstream of disposition)
            "v_male", "v_female", "v_boy", "v_girl"]      # fairness (sex split)

VICTIM_COLS = ["v_male", "v_female", "v_boy", "v_girl"]
SEASON = {12: "Winter", 1: "Winter", 2: "Winter", 3: "Summer", 4: "Summer", 5: "Summer",
          6: "Monsoon", 7: "Monsoon", 8: "Monsoon", 9: "Monsoon",
          10: "Post-Monsoon", 11: "Post-Monsoon"}

PARQUET_SCHEMA = pa.schema([
    ("year", pa.int16()), ("month", pa.int8()), ("dow", pa.int8()), ("season", pa.string()),
    ("district", pa.string()), ("crime_head", pa.string()), ("crime_subhead", pa.string()),
    ("gravity", pa.string()), ("complaint_mode", pa.string()),
    ("first_act", pa.string()), ("first_section", pa.string()),
    ("victims", pa.int32()), ("accused_count", pa.int32()), ("has_coord", pa.int8()),
    ("fir_stage", pa.string()),
])


def enrich(chunk, rename, dist_attrs, act_cache):
    chunk = chunk.rename(columns=rename)
    # district -> canonical / parent (geographic units roll up to their parent district)
    da = chunk["district_name"].map(lambda d: dist_attrs.get((d or "").strip()))
    canon = da.map(lambda a: a["canonical_name"] if a else "UNKNOWN")
    parent = da.map(lambda a: (a["parent_district"] or a["canonical_name"]) if a else "UNKNOWN")
    chunk["district"] = parent.where(parent.astype(bool), canon)
    # categoricals
    chunk["crime_head"] = chunk["major_head"].map(clean_cat)
    chunk["crime_subhead"] = chunk["sub_head"].map(clean_cat)
    chunk["gravity"] = chunk["gravity_raw"].map(normalize_gravity)
    chunk["complaint_mode"] = chunk["complaint_mode"].map(clean_cat)
    chunk["fir_stage"] = chunk["status_raw"].map(normalize_status)
    # victims TOTAL (never sex-split) + accused total (both known at/near filing)
    for c in VICTIM_COLS + ["accused_count"]:
        chunk[c] = pd.to_numeric(chunk[c], errors="coerce").fillna(0).clip(lower=0)
    chunk["victims"] = chunk[VICTIM_COLS].sum(axis=1).astype("int32")
    chunk["accused_count"] = chunk["accused_count"].astype("int32")
    # temporal
    y = pd.to_numeric(chunk["year"], errors="coerce")
    m = pd.to_numeric(chunk["month"], errors="coerce")
    d = pd.to_numeric(chunk["day"], errors="coerce")
    dt = pd.to_datetime(dict(year=y, month=m, day=d), errors="coerce")
    chunk["year"] = y.fillna(0).astype("int16")
    chunk["month"] = m.fillna(0).astype("int8")
    chunk["dow"] = dt.dt.dayofweek.fillna(-1).astype("int8")   # 0=Mon..6=Sun, -1=unknown
    chunk["season"] = chunk["month"].map(SEASON).fillna("Unknown")
    # act/section (first/dominant) - parsed once per distinct raw string
    def parse_first(s):
        v = act_cache.get(s)
        if v is None:
            fa, fs, _acts, _pairs = parse_act_section(s)
            v = (fa or "NONE", fs or "NONE")
            act_cache[s] = v
        return v
    parsed = chunk["act_section"].map(parse_first)
    chunk["first_act"] = parsed.map(lambda t: t[0])
    chunk["first_section"] = parsed.map(lambda t: t[1])
    # lightweight geo_precision proxy: real KA-valid GPS present?
    chunk["has_coord"] = [
        1 if valid_coord(la, lo) else 0
        for la, lo in zip(chunk["latitude"], chunk["longitude"])
    ]
    return chunk


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="process only N chunks (smoke test)")
    args = ap.parse_args()

    t0 = time.time()
    out_dir = paths.ensure_out()
    partial = bool(args.limit)
    pq_name = "case_features.smoke.parquet" if partial else "case_features.parquet"
    pq_path = os.path.join(out_dir, pq_name)

    dist_attrs = {raw: resolve_district(raw) for raw in DISTRICT_MAP}
    act_cache = {}
    temporal = defaultdict(int)          # (district, dow, month) -> n
    stage_counts = defaultdict(int)      # fir_stage -> n (sanity)
    coord_hits = 0
    total = 0
    rename = None
    writer = pq.ParquetWriter(pq_path, PARQUET_SCHEMA, compression="zstd")

    reader = pd.read_csv(
        paths.FIR_CSV, dtype=str, keep_default_na=False, na_filter=False,
        encoding="utf-8-sig", chunksize=CHUNK,
    )
    try:
        for ci, chunk in enumerate(reader):
            if rename is None:
                rename = build_rename_map(list(chunk.columns))
                missing = set(CLEAN_COLUMNS) - set(rename.values())
                if missing:
                    raise ValueError(f"Missing expected columns after rename: {missing}")
            chunk = enrich(chunk, rename, dist_attrs, act_cache)
            total += len(chunk)
            coord_hits += int(chunk["has_coord"].sum())

            feat = chunk[CASE_FEATURE_COLS]
            writer.write_table(pa.Table.from_pandas(feat, schema=PARQUET_SCHEMA, preserve_index=False))

            for st, v in chunk["fir_stage"].value_counts().items():
                stage_counts[st] += int(v)
            g = chunk[chunk["dow"] >= 0].groupby(["district", "dow", "month"], sort=False).size()
            for (dist, dw, mo), v in g.items():
                temporal[(dist, int(dw), int(mo))] += int(v)

            if (ci + 1) % 3 == 0 or partial:
                print(f"  chunk {ci+1}: rows so far {total:,}  ({time.time()-t0:.0f}s)")
            if partial and (ci + 1) >= args.limit:
                print(f"[modeling] --limit {args.limit} reached, stopping early.")
                break
    finally:
        writer.close()

    # ---- agg_temporal.csv (dow x month x district) ----
    trows = [[dist, dw, mo, SEASON.get(mo, "Unknown"), n]
             for (dist, dw, mo), n in sorted(temporal.items())]
    tdf = pd.DataFrame(trows, columns=["district", "dow", "month", "season", "count"])
    tdf.to_csv(os.path.join(out_dir, "agg_temporal.csv"), index=False)

    # ---- report ----
    print("\n" + "=" * 68)
    print("PHASE 4 MODELING TABLE" + ("  (PARTIAL/SMOKE)" if partial else ""))
    print("=" * 68)
    print(f"rows processed : {total:,}")
    if not partial:
        print(f"expected rows  : {EXPECTED_ROWS:,}  [{'OK' if total == EXPECTED_ROWS else '!! MISMATCH'}]")
    print(f"has_coord      : {coord_hits:,} ({100*coord_hits/total:.1f}%)")
    print(f"parquet        : {pq_name} ({os.path.getsize(pq_path)//1024:,} KB)")
    print(f"agg_temporal   : {len(tdf):,} rows (district x dow x month)")
    print("fir_stage label distribution:")
    for st, n in sorted(stage_counts.items(), key=lambda x: -x[1]):
        print(f"   {st:22} {n:>10,}  ({100*n/total:4.1f}%)")
    print(f"features emitted : {', '.join(c for c in CASE_FEATURE_COLS if c != 'fir_stage')}")
    print(f"EXCLUDED (leak/fair): {', '.join(EXCLUDED)}")
    print(f"[modeling] done in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
