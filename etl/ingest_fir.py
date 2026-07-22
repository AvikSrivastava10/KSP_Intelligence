"""Phase 0 streaming ETL for FIR_Details_Data.csv (1,674,734 rows / 546 MB).

Streams the raw FIR extract in chunks (never whole-file, never Excel), cleans and
reconstructs each row, geocodes with a precision tag, attaches a modeled (estimated)
time-of-day, derives temporal features, and emits compact API-ready aggregate tables
+ reference dimensions + meta.json into etl/out/.

Design:
  * pandas chunked read (dtype=str, utf-8-sig, na_filter=False) -> vectorized cleaning
  * one memoized per-row pass for geocoding (GeoResolver caches station/place lookups)
  * vectorized groupby per chunk, merged into global accumulators
  * ActSection/rank reference counts parsed over *distinct* strings (weighted), not per row

Run:  python etl/ingest_fir.py            (full)
      python etl/ingest_fir.py --limit 5  (first 5 chunks, smoke test)

Verifies total processed rows == 1,674,734 and prints a Phase 0 completion report.
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd

from common import paths
from common.districts import DISTRICT_MAP, resolve as resolve_district
from common.geo import GeoResolver
from common import timeofday
from common.textutils import (
    build_rename_map, clean_cat, normalize_status, normalize_gravity,
    parse_act_section, CLEAN_COLUMNS,
)

EXPECTED_ROWS = 1_674_734
CHUNK = 200_000
# Outcome count columns used for rate math. NOTE: the raw "VICTIM COUNT" column is a
# dead field (sum ~464 across 1.67M rows); real victim counts live in the
# Male/Female/Boy/Girl demographic columns -> summed into a single "victims" total
# (a total, never a sex-split feature, per the fairness guardrail).
COUNT_COLS = ["accused_count", "arrested_count", "chargesheeted_count", "conviction_count"]
VICTIM_COLS = ["v_male", "v_female", "v_boy", "v_girl"]
# entity_edges: min co-occurrence weight to keep an edge (trims the free-text act tail)
EDGE_MIN_MH_ACT = 10
EDGE_MIN_ACT_ACT = 25
DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def season_of(m):
    if m in (12, 1, 2):
        return "Winter"
    if m in (3, 4, 5):
        return "Summer"
    if m in (6, 7, 8, 9):
        return "Monsoon"
    return "Post-Monsoon"


SEASON = {m: season_of(m) for m in range(1, 13)}


class Accumulators:
    """Global streaming accumulators (all compact)."""
    def __init__(self):
        self.dm = defaultdict(int)          # (canonical, year, month, major) -> n
        self.hot = defaultdict(int)         # (lat2, lon2, prec, year) -> n
        # spatiotemporal grid kept compact: category filtering is served coarsely by
        # agg_district_month; year is retained here for emerging-hotspot detection.
        self.unit = defaultdict(lambda: [0, 0.0, 0.0, 0])  # (canon,parent,kgis,unit)->[n,slat,slon,ncoord]
        self.out = defaultdict(lambda: Counter())          # canonical -> Counter(sums)
        self.status = defaultdict(int)      # (canonical, status_norm) -> n
        self.tod = defaultdict(int)         # (canonical, major, bucket, method) -> n
        # reference dimensions
        self.major = Counter()
        self.sub = Counter()                # (major, sub) -> n
        self.status_only = Counter()
        self.gravity = Counter()
        self.cmode = Counter()
        self.act = Counter()
        self.section = Counter()            # (act, section) -> n
        self.rank = Counter()
        # entity co-occurrence edges (REAL network, within-case) — feeds Phase 5 Module A
        self.edge_mh_act = defaultdict(int)   # (major_head, act) -> weight
        self.edge_act_act = defaultdict(int)  # (actA, actB) sorted -> weight
        # meta
        self.year = Counter()
        self.crimes_by_census = Counter()   # census_code_2011 -> n (for socioeconomic)
        self.unknown_district = Counter()


def enrich_chunk(chunk, rename, dist_attrs):
    """Vectorized clean + derive columns on a chunk (returns the enriched frame)."""
    chunk = chunk.rename(columns=rename)
    # categoricals
    chunk["major_head"] = chunk["major_head"].map(clean_cat)
    chunk["sub_head"] = chunk["sub_head"].map(clean_cat)
    chunk["gravity"] = chunk["gravity_raw"].map(normalize_gravity)
    chunk["status_norm"] = chunk["status_raw"].map(normalize_status)
    chunk["complaint_mode"] = chunk["complaint_mode"].map(clean_cat)
    # district attrs
    da = chunk["district_name"].map(lambda d: dist_attrs.get((d or "").strip()))
    chunk["canonical_name"] = da.map(lambda a: a["canonical_name"] if a else "UNKNOWN")
    chunk["parent_district"] = da.map(lambda a: a["parent_district"] if a else "")
    chunk["kgis_code"] = da.map(lambda a: a["kgis_code"] if a else "")
    chunk["census_code"] = da.map(lambda a: a["census_code_2011"] if a else "")
    chunk["is_geographic"] = da.map(lambda a: bool(a["is_geographic"]) if a else False)
    # numeric counts (outcome cols + victim demographic cols)
    for c in COUNT_COLS + VICTIM_COLS:
        chunk[c] = pd.to_numeric(chunk[c], errors="coerce").fillna(0).clip(lower=0).astype("int64")
    chunk["victims"] = chunk[VICTIM_COLS].sum(axis=1)
    # socioeconomic join key: geographic districts only; Vijayanagara (2021, no 2011
    # census code) folds into its 2011 parent Ballari (565); non-geographic units excluded.
    sc = chunk["census_code"].where(chunk["is_geographic"], "")
    chunk["socio_census"] = sc.mask(chunk["canonical_name"] == "Vijayanagara", "565")
    # temporal
    chunk["year_i"] = pd.to_numeric(chunk["year"], errors="coerce").astype("Int64")
    chunk["month_i"] = pd.to_numeric(chunk["month"], errors="coerce").astype("Int64")
    dt = pd.to_datetime(
        dict(year=chunk["year_i"], month=chunk["month_i"],
             day=pd.to_numeric(chunk["day"], errors="coerce").astype("Int64")),
        errors="coerce",
    )
    chunk["dow"] = dt.dt.dayofweek
    # modeled time-of-day (per distinct major head -> cached map)
    return chunk


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="process only N chunks (smoke test)")
    args = ap.parse_args()

    t0 = time.time()
    out_dir = paths.ensure_out()
    print(f"[etl] source: {paths.FIR_CSV}")
    print(f"[etl] output: {out_dir}")

    # district attrs keyed by raw FIR name
    dist_attrs = {raw: resolve_district(raw) for raw in DISTRICT_MAP}

    # geocoder (loads centroids, stations, geonames)
    print("[etl] loading geo indexes ...")
    resolver = GeoResolver().load_all()

    # tod cache per distinct major head
    tod_cache = {}

    def tod_of(major):
        v = tod_cache.get(major)
        if v is None:
            v = timeofday.assign(major)
            tod_cache[major] = v
        return v

    # actsection cache per distinct raw string
    act_cache = {}

    acc = Accumulators()
    total = 0
    rename = None

    reader = pd.read_csv(
        paths.FIR_CSV, dtype=str, keep_default_na=False, na_filter=False,
        encoding="utf-8-sig", chunksize=CHUNK,
    )
    for ci, chunk in enumerate(reader):
        if rename is None:
            rename = build_rename_map(list(chunk.columns))
            missing = set(CLEAN_COLUMNS) - set(rename.values())
            if missing:
                raise ValueError(f"Missing expected columns after rename: {missing}")
        chunk = enrich_chunk(chunk, rename, dist_attrs)
        n = len(chunk)
        total += n

        # --- per-row geocoding pass (memoized) ---
        glat, glon, gprec = [], [], []
        for dn, un, va, po, la, lo in chunk[
            ["district_name", "unit_name", "village_area", "place_of_offence",
             "latitude", "longitude"]
        ].itertuples(index=False, name=None):
            a = dist_attrs.get((dn or "").strip())
            lat, lon, prec, _src = resolver.resolve(
                lat_raw=la, lon_raw=lo, dist_attrs=a, unit_name=un,
                village_area=va, place_of_offence=po,
            )
            glat.append(lat); glon.append(lon); gprec.append(prec)
        chunk["glat"] = glat
        chunk["glon"] = glon
        chunk["gprec"] = gprec

        # --- unknown districts ---
        unk = chunk.loc[chunk["canonical_name"] == "UNKNOWN", "district_name"]
        for d in unk:
            acc.unknown_district[d] += 1

        # --- year counts ---
        for y, c in chunk["year"].value_counts().items():
            acc.year[str(y)] += int(c)

        # --- agg_district_month ---
        g = chunk.groupby(["canonical_name", "year", "month", "major_head"], sort=False).size()
        for (cn, y, m, mh), v in g.items():
            acc.dm[(cn, y, m, mh)] += int(v)

        # --- agg_timeofday (modeled) ---
        chunk["tod_bucket"] = chunk["major_head"].map(lambda mh: tod_of(mh)[0])
        chunk["tod_method"] = chunk["major_head"].map(lambda mh: tod_of(mh)[1])
        g = chunk.groupby(["canonical_name", "major_head", "tod_bucket", "tod_method"], sort=False).size()
        for (cn, mh, tb, tm), v in g.items():
            acc.tod[(cn, mh, tb, tm)] += int(v)

        # --- agg_hotspots (rows with coords only) ---
        geo = chunk[chunk["gprec"] != "none"].copy()
        if len(geo):
            geo["lat2"] = geo["glat"].round(2)
            geo["lon2"] = geo["glon"].round(2)
            g = geo.groupby(["lat2", "lon2", "gprec", "year"], sort=False).size()
            for (la2, lo2, pr, y), v in g.items():
                acc.hot[(la2, lo2, pr, y)] += int(v)

        # --- agg_unit ---
        gu = chunk.groupby(["canonical_name", "parent_district", "kgis_code", "unit_name"], sort=False)
        sizes = gu.size()
        for key, v in sizes.items():
            acc.unit[key][0] += int(v)
        coord = chunk[chunk["gprec"] != "none"]
        gc = coord.groupby(["canonical_name", "parent_district", "kgis_code", "unit_name"], sort=False)
        slat = gc["glat"].sum(); slon = gc["glon"].sum(); cnt = gc.size()
        for key in cnt.index:
            acc.unit[key][1] += float(slat[key])
            acc.unit[key][2] += float(slon[key])
            acc.unit[key][3] += int(cnt[key])

        # --- agg_outcomes sums + status + gravity ---
        gs = chunk.groupby("canonical_name", sort=False)
        sum_cols = COUNT_COLS + ["victims"]
        sums = gs[sum_cols].sum()
        tc = gs.size()
        heinous = chunk[chunk["gravity"] == "Heinous"].groupby("canonical_name", sort=False).size()
        for cn in tc.index:
            o = acc.out[cn]
            o["total_cases"] += int(tc[cn])
            for c in sum_cols:
                o[c] += int(sums.loc[cn, c])
            if cn in heinous.index:
                o["heinous"] += int(heinous[cn])
        g = chunk.groupby(["canonical_name", "status_norm"], sort=False).size()
        for (cn, st), v in g.items():
            acc.status[(cn, st)] += int(v)

        # --- crimes by census (socioeconomic; geographic districts only) ---
        g = chunk.groupby("socio_census", sort=False).size()
        for cc, v in g.items():
            if cc:
                acc.crimes_by_census[cc] += int(v)

        # --- reference dims (weighted over distinct strings) ---
        for mh, v in chunk["major_head"].value_counts().items():
            acc.major[mh] += int(v)
        for (mh, sh), v in chunk.groupby(["major_head", "sub_head"], sort=False).size().items():
            acc.sub[(mh, sh)] += int(v)
        for st, v in chunk["status_norm"].value_counts().items():
            acc.status_only[st] += int(v)
        for gv, v in chunk["gravity"].value_counts().items():
            acc.gravity[gv] += int(v)
        for cm, v in chunk["complaint_mode"].value_counts().items():
            acc.cmode[cm] += int(v)
        # rank via vectorized extract of trailing (....)
        ranks = chunk["io_name"].str.extract(r"\(([^)]+)\)\s*$", expand=False)
        ranks = ranks.fillna("").str.upper().str.replace(".", "", regex=False).str.replace(" ", "", regex=False)
        for rk, v in ranks[ranks != ""].value_counts().items():
            acc.rank[rk] += int(v)
        # act/section reference dims + entity co-occurrence edges, from one grouped pass
        # over (major_head, act_section). ActSection parses are cached per distinct string.
        for (mh, as_str), v in chunk.groupby(["major_head", "act_section"], sort=False).size().items():
            parsed = act_cache.get(as_str)
            if parsed is None:
                fa, fs, acts, secpairs = parse_act_section(as_str)
                parsed = (acts, secpairs)
                act_cache[as_str] = parsed
            acts, secpairs = parsed
            v = int(v)
            for a in acts:
                acc.act[a] += v
            for (a, s) in secpairs:
                acc.section[(a, s)] += v
            # within-case co-occurrence: crime-type<->act and act<->act
            uacts = sorted(set(acts))
            for a in uacts:
                acc.edge_mh_act[(mh, a)] += v
            for a, b in itertools.combinations(uacts, 2):
                acc.edge_act_act[(a, b)] += v

        if (ci + 1) % 3 == 0 or args.limit:
            print(f"  chunk {ci+1}: rows so far {total:,}  ({time.time()-t0:.0f}s)")
        if args.limit and (ci + 1) >= args.limit:
            print(f"[etl] --limit {args.limit} reached, stopping early.")
            break

    # ---------------- write outputs ----------------
    write_outputs(out_dir, acc, resolver, total, t0, partial=bool(args.limit))
    return 0


def _rate(num, den):
    return round(num / den, 4) if den else 0.0


def write_outputs(out_dir, acc: Accumulators, resolver: GeoResolver, total, t0, partial):
    def w(name, header, rows):
        p = os.path.join(out_dir, name)
        with open(p, "w", newline="", encoding="utf-8") as f:
            wr = csv.writer(f)
            wr.writerow(header)
            wr.writerows(rows)
        return len(rows)

    counts = {}

    counts["agg_district_month.csv"] = w(
        "agg_district_month.csv",
        ["canonical_name", "year", "month", "major_head", "count"],
        [[cn, y, m, mh, v] for (cn, y, m, mh), v in sorted(acc.dm.items())],
    )
    counts["agg_hotspots.csv"] = w(
        "agg_hotspots.csv",
        ["lat", "lng", "geo_precision", "year", "count"],
        [[la, lo, pr, y, v] for (la, lo, pr, y), v in sorted(acc.hot.items())],
    )
    # agg_unit with mean coords
    unit_rows = []
    matched_units = 0
    for (cn, parent, kgis, un), (n, slat, slon, nc) in sorted(acc.unit.items()):
        mlat = round(slat / nc, 6) if nc else ""
        mlon = round(slon / nc, 6) if nc else ""
        if nc:
            matched_units += 1
        unit_rows.append([un, cn, parent, kgis, n, nc, mlat, mlon])
    counts["agg_unit.csv"] = w(
        "agg_unit.csv",
        ["unit_name", "canonical_name", "parent_district", "kgis_code",
         "count", "n_with_coord", "mean_lat", "mean_lng"],
        unit_rows,
    )
    # agg_outcomes per district
    out_rows = []
    for cn in sorted(acc.out):
        o = acc.out[cn]
        tc = o["total_cases"]
        undet = acc.status.get((cn, "Undetected"), 0) + acc.status.get((cn, "Un Traced"), 0)
        out_rows.append([
            cn, tc, o["heinous"], o["victims"], o["accused_count"],
            o["arrested_count"], o["chargesheeted_count"], o["conviction_count"],
            _rate(o["arrested_count"], o["accused_count"]),
            _rate(o["chargesheeted_count"], o["accused_count"]),
            _rate(o["conviction_count"], o["chargesheeted_count"]),
            _rate(tc - undet, tc),
        ])
    counts["agg_outcomes.csv"] = w(
        "agg_outcomes.csv",
        ["canonical_name", "total_cases", "heinous_cases", "victims", "accused",
         "arrested", "chargesheeted", "convicted", "arrest_rate",
         "chargesheet_rate", "conviction_rate", "detection_rate"],
        out_rows,
    )
    counts["agg_case_status.csv"] = w(
        "agg_case_status.csv",
        ["canonical_name", "status", "count"],
        [[cn, st, v] for (cn, st), v in sorted(acc.status.items())],
    )
    counts["agg_timeofday.csv"] = w(
        "agg_timeofday.csv",
        ["canonical_name", "major_head", "modeled_time_of_day", "method", "count"],
        [[cn, mh, tb, tm, v] for (cn, mh, tb, tm), v in sorted(acc.tod.items())],
    )
    # reference dimensions
    counts["dim_crime_head.csv"] = w("dim_crime_head.csv", ["major_head", "count"],
                                     [[k, v] for k, v in acc.major.most_common()])
    counts["dim_crime_subhead.csv"] = w("dim_crime_subhead.csv", ["major_head", "sub_head", "count"],
                                        [[mh, sh, v] for (mh, sh), v in sorted(acc.sub.items(), key=lambda x: -x[1])])
    counts["dim_case_status.csv"] = w("dim_case_status.csv", ["status", "count"],
                                      [[k, v] for k, v in acc.status_only.most_common()])
    counts["dim_gravity.csv"] = w("dim_gravity.csv", ["gravity", "count"],
                                  [[k, v] for k, v in acc.gravity.most_common()])
    counts["dim_complaint_mode.csv"] = w("dim_complaint_mode.csv", ["complaint_mode", "count"],
                                         [[k, v] for k, v in acc.cmode.most_common()])
    counts["dim_act.csv"] = w("dim_act.csv", ["act", "count"],
                              [[k, v] for k, v in acc.act.most_common()])
    counts["dim_section.csv"] = w("dim_section.csv", ["act", "section", "count"],
                                  [[a, s, v] for (a, s), v in sorted(acc.section.items(), key=lambda x: -x[1])])
    counts["dim_rank.csv"] = w("dim_rank.csv", ["rank", "count"],
                               [[k, v] for k, v in acc.rank.most_common()])

    # entity_edges (REAL co-occurrence graph, Phase 5 Module A): typed edges
    #   crime_head<->act, act<->act (within-case), crime_head<->district (from agg_district_month)
    edges = []
    for (mh, a), v in acc.edge_mh_act.items():
        if v >= EDGE_MIN_MH_ACT and mh and a:
            edges.append(["crime_head", mh, "act", a, v])
    for (a, b), v in acc.edge_act_act.items():
        if v >= EDGE_MIN_ACT_ACT and a and b:
            edges.append(["act", a, "act", b, v])
    mh_dist = defaultdict(int)
    for (cn, _y, _m, mh), v in acc.dm.items():
        if cn and cn != "UNKNOWN" and mh:
            mh_dist[(mh, cn)] += v
    for (mh, cn), v in mh_dist.items():
        edges.append(["crime_head", mh, "district", cn, v])
    edges.sort(key=lambda r: -r[4])
    counts["entity_edges.csv"] = w(
        "entity_edges.csv", ["src_type", "src", "dst_type", "dst", "weight"], edges)

    # socioeconomic (stretch): 2011 census join, per-capita
    socio_n = write_socioeconomic(out_dir, acc)
    if socio_n is not None:
        counts["agg_socioeconomic.csv"] = socio_n

    # ---------------- meta.json ----------------
    st = resolver.stats
    with_coord = st["point"] + st["station"] + st["place"] + st["district"]
    fsize = os.path.getsize(paths.FIR_CSV)
    meta = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_file": os.path.basename(paths.FIR_CSV),
        "source_size_bytes": fsize,
        "partial_run": partial,
        "total_rows_processed": total,
        "expected_rows": EXPECTED_ROWS,
        "row_count_reconciles": (total == EXPECTED_ROWS) if not partial else None,
        "per_year_counts": {y: acc.year[y] for y in sorted(acc.year)},
        "note_2024_partial": "2024 is a partial year; exclude from YoY/forecast training baselines.",
        "coordinate_coverage": {
            "before_geocoding_real_points": st["point"],
            "before_pct": round(100 * st["point"] / total, 2) if total else 0,
            "after_geocoding_with_coord": with_coord,
            "after_pct": round(100 * with_coord / total, 2) if total else 0,
            "by_precision": {k: st[k] for k in ["point", "station", "place", "district", "none"]},
        },
        "geocoding": {
            "distinct_units_seen": len(resolver._unit_cache),
            "units_matched_to_station": sum(1 for v in resolver._unit_cache.values() if v[1]),
            "police_stations_loaded": len(resolver.station_records),
            "geoname_place_names_loaded": len(resolver.geonames),
        },
        "districts": {
            "fir_units_total": len(DISTRICT_MAP),
            "geographic": sum(1 for r in DISTRICT_MAP.values() if r[5]),
            "non_geographic": sum(1 for r in DISTRICT_MAP.values() if not r[5]),
            "unknown_district_rows": dict(acc.unknown_district),
        },
        "reference_dim_sizes": {
            "major_heads": len(acc.major), "sub_heads": len(acc.sub),
            "case_statuses": len(acc.status_only), "acts": len(acc.act),
            "sections": len(acc.section), "ranks": len(acc.rank),
        },
        "tables": counts,
        "data_class": {
            "real": ["agg_district_month", "agg_hotspots", "agg_unit", "agg_outcomes",
                     "agg_case_status", "agg_socioeconomic", "entity_edges", "dim_*"],
            "modeled": ["agg_timeofday (estimated time-of-day, not observed)"],
            "synthetic": [],
        },
        "guardrails": "No protected attributes (caste/religion/sex/occupation) used as features. "
                      "Modeled time-of-day is illustrative only and never used to train models.",
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print_report(meta, counts, acc, resolver, total, t0, partial)


def write_socioeconomic(out_dir, acc: Accumulators):
    """Join district crime totals to 2011 Census population -> per-capita indicators."""
    try:
        pca = {}
        with open(paths.CENSUS_PCA, encoding="utf-8-sig", newline="") as f:
            r = csv.DictReader(f)
            for row in r:
                if row.get("State", "").strip() == "29" and row.get("Level") == "DISTRICT" \
                        and row.get("TRU") == "Total":
                    pca[row["District"].strip()] = row
    except FileNotFoundError:
        return None

    # crimes by 2011 census code (Vijayanagara already folded into Ballari 565 upstream;
    # non-geographic special units already excluded upstream)
    crimes = dict(acc.crimes_by_census)

    rows = []
    for code, row in pca.items():
        try:
            pop = int(row["TOT_P"]); tot_m = int(row["TOT_M"]); tot_f = int(row["TOT_F"])
            lit = int(row["P_LIT"]); sc = int(row["P_SC"]); stt = int(row["P_ST"])
        except (ValueError, KeyError):
            continue
        n = crimes.get(code, 0)
        rows.append([
            code, row["Name"].strip(), pop, n,
            round(100000 * n / pop, 1) if pop else 0,
            _rate(lit, pop), _rate(sc, pop), _rate(stt, pop),
            round(1000 * tot_f / tot_m, 1) if tot_m else 0,
        ])
    rows.sort(key=lambda x: -x[4])
    p = os.path.join(out_dir, "agg_socioeconomic.csv")
    with open(p, "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["census_code_2011", "district_2011_name", "population_2011",
                     "total_crimes_all_years", "crimes_per_100k", "literacy_rate",
                     "sc_share", "st_share", "sex_ratio_f_per_1000m"])
        wr.writerows(rows)
    return len(rows)


def print_report(meta, counts, acc, resolver, total, t0, partial):
    cc = meta["coordinate_coverage"]
    print("\n" + "=" * 72)
    print("PHASE 0 COMPLETION REPORT")
    print("=" * 72)
    print(f"Elapsed: {time.time()-t0:.0f}s | partial run: {partial}")
    print(f"\nTotal rows processed : {total:,}")
    if not partial:
        ok = "OK" if total == EXPECTED_ROWS else "!! MISMATCH"
        print(f"Expected rows        : {EXPECTED_ROWS:,}  [{ok}]")
    print("\nPer-year counts:")
    for y, n in meta["per_year_counts"].items():
        tag = "  (PARTIAL)" if y == "2024" else ""
        print(f"  {y}: {n:,}{tag}")
    print("\nCoordinate coverage:")
    print(f"  real points (before geocoding): {cc['before_geocoding_real_points']:,} ({cc['before_pct']}%)")
    print(f"  with coord (after geocoding)  : {cc['after_geocoding_with_coord']:,} ({cc['after_pct']}%)")
    print(f"  by precision: {cc['by_precision']}")
    g = meta["geocoding"]
    print(f"\nStation matching: {g['units_matched_to_station']}/{g['distinct_units_seen']} distinct units -> KGIS station coords")
    d = meta["districts"]
    print(f"\nDistricts: {d['fir_units_total']} FIR units ({d['geographic']} geographic + {d['non_geographic']} special)")
    if d["unknown_district_rows"]:
        print(f"  !! UNKNOWN districts: {d['unknown_district_rows']}")
    else:
        print("  all district names mapped (0 unknown)")
    print(f"\nReference dims: {meta['reference_dim_sizes']}")
    print("\nTables written to etl/out/:")
    for name, n in counts.items():
        print(f"  {name:28} {n:>8,} rows")
    print("=" * 72)


if __name__ == "__main__":
    raise SystemExit(main())
