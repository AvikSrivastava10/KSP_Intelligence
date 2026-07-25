"""Spatiotemporal hotspots where the time is REAL — not inferred.

THE PROBLEM THIS SOLVES, AND ITS DELIBERATE LIMIT
The problem statement asks for "Crime Hotspots identified by layering time of day with location".
The FIR extract has no clock field, so a naive implementation would paint the MODELED time-of-day
onto the map. That modeled layer is 97.4% assumption:

    default_distributed   832,619 FIRs (49.7%)  <- no signal at all
    criminological_prior  798,141 FIRs (47.7%)  <- documented assumption, not observation
    category_encoded       43,974 FIRs ( 2.6%)  <- REAL: recorded by police in the classification

Mapping the first two would look like genuine spatiotemporal intelligence while being a crime-type
map wearing a clock costume — the exact "never present inferred data as real" failure the project
guards against.

So this table is built ONLY from `category_encoded` rows: crime heads where the FIR classification
itself records the time — BURGLARY - NIGHT vs BURGLARY - DAY (and HOUSE BREAKING BY NIGHT/DAY).
That is a real observation made by the recording officer, not our inference.

It is further restricted to incidents with REAL GPS (no station/centroid fallback), so every cell
is real-location x real-time. Smaller, but true — and directly actionable: night-burglary hotspots
are where night patrols go.

Output -> etl/out/agg_hotspots_timed.csv
  lat, lng, time_bucket, major_head, year, count      (all data_class=real)

Run:  python etl/build_timed_hotspots.py
"""
from __future__ import annotations

import csv
import os
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd

from common import paths
from common.textutils import build_rename_map, clean_cat

CHUNK = 200_000
KA_LON, KA_LAT = (73.8, 78.9), (11.4, 18.7)

# Crime heads whose NAME encodes the time the offence occurred. This is the officer's own
# classification — the only real time signal in the extract.
NIGHT_TOKENS = ("BURGLARY - NIGHT", "BY NIGHT")
DAY_TOKENS = ("BURGLARY - DAY", "BY DAY")


def real_time_bucket(major_head: str):
    h = (major_head or "").upper()
    if any(t in h for t in NIGHT_TOKENS):
        return "Night"
    if any(t in h for t in DAY_TOKENS):
        return "Daytime"
    return None


def valid_coord(lat, lon):
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if lat == 0 and lon == 0:
        return None
    if KA_LAT[0] <= lat <= KA_LAT[1] and KA_LON[0] <= lon <= KA_LON[1]:
        return (lat, lon)
    if KA_LAT[0] <= lon <= KA_LAT[1] and KA_LON[0] <= lat <= KA_LON[1]:
        return (lon, lat)
    return None


def main():
    t0 = time.time()
    out_dir = paths.ensure_out()
    grid = defaultdict(int)          # (lat2, lon2, bucket, major_head, year) -> n
    matched = kept = total = 0
    rename = None

    reader = pd.read_csv(paths.FIR_CSV, dtype=str, keep_default_na=False, na_filter=False,
                         encoding="utf-8-sig", chunksize=CHUNK)
    for chunk in reader:
        if rename is None:
            rename = build_rename_map(list(chunk.columns))
        chunk = chunk.rename(columns=rename)
        total += len(chunk)
        heads = chunk["major_head"].map(clean_cat)
        buckets = heads.map(real_time_bucket)
        sub = chunk[buckets.notna()]
        if sub.empty:
            continue
        matched += len(sub)
        b = buckets[buckets.notna()]
        h = heads[buckets.notna()]
        for (la, lo, yr), bucket, head in zip(
                sub[["latitude", "longitude", "year"]].itertuples(index=False, name=None), b, h):
            c = valid_coord(la, lo)
            if not c:
                continue          # real GPS only — no station/centroid fallback here
            kept += 1
            grid[(round(c[0], 2), round(c[1], 2), bucket, head, yr)] += 1

    rows = [[la, lo, bk, mh, yr, n] for (la, lo, bk, mh, yr), n in sorted(grid.items())]
    path = os.path.join(out_dir, "agg_hotspots_timed.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["lat", "lng", "time_bucket", "major_head", "year", "count"])
        w.writerows(rows)

    by_bucket = defaultdict(int)
    for (_la, _lo, bk, _mh, _yr), n in grid.items():
        by_bucket[bk] += n
    print("=" * 70)
    print("SPATIOTEMPORAL HOTSPOTS — REAL TIME SIGNAL ONLY")
    print("=" * 70)
    print(f"rows scanned            : {total:,}")
    print(f"real day/night classified: {matched:,} ({100*matched/total:.2f}% of all FIRs)")
    print(f"...of those, with real GPS: {kept:,} ({100*kept/matched:.1f}%)")
    print(f"grid cells written      : {len(rows):,}")
    for bk, n in sorted(by_bucket.items(), key=lambda x: -x[1]):
        print(f"   {bk:10} {n:>7,} incidents")
    print(f"\nEXCLUDED BY DESIGN: the 97.4% of FIRs whose time-of-day is modeled "
          f"(criminological prior / distributed).\nMapping those would present assumption as observation.")
    print(f"[timed-hotspots] wrote agg_hotspots_timed.csv  [{time.time()-t0:.0f}s]")


if __name__ == "__main__":
    main()
