"""Build etl/out/dim_district.csv (canonical district dimension) and cross-validate
the hand-verified override map in common/districts.py against the real external files:

  * 2021 KGIS boundaries GeoJSON  -> kgis_code, lgd_code, district name
  * 2011 DataMeet census SHP      -> censuscode (2011)
  * LGD SpreadsheetML XML         -> authoritative lgd_code <-> census_2011 <-> name

rapidfuzz is used to confirm each canonical parent name matches its KGIS/census source
name; exact code lookups confirm the numeric joins. Warnings are printed loudly; the
map itself is the hand-verified source of truth.

Run:  python etl/build_dim_district.py
"""
from __future__ import annotations

import csv
import json
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shapefile  # pyshp
from rapidfuzz import fuzz

from common import paths
from common.districts import DISTRICT_MAP, FIELDS, resolve


def load_kgis():
    with open(paths.KGIS_GEOJSON_SIMPLE, encoding="utf-8") as f:
        gj = json.load(f)
    by_code = {}
    for ft in gj["features"]:
        p = ft["properties"]
        code = str(p["kgis_code"]).zfill(2)
        by_code[code] = {"district": p["district"], "lgd_code": str(p["lgd_code"])}
    return by_code


def load_census_shp():
    sf = shapefile.Reader(paths.CENSUS_SHP)
    fields = [f[0] for f in sf.fields[1:]]
    di, ci, si = fields.index("DISTRICT"), fields.index("censuscode"), fields.index("ST_NM")
    by_code = {}
    for r in sf.records():
        if str(r[si]).strip().lower() == "karnataka":
            by_code[str(r[ci])] = r[di]
    return by_code


def load_lgd():
    """Parse SpreadsheetML: lgd_code -> {name, census2011}."""
    NS = {"ss": "urn:schemas-microsoft-com:office:spreadsheet"}
    root = ET.parse(paths.LGD_DISTRICTS_XLS).getroot()
    out = {}
    for row in root.findall(".//ss:Row", NS):
        cells, idx = [], 1
        for c in row.findall("ss:Cell", NS):
            ix = c.get("{urn:schemas-microsoft-com:office:spreadsheet}Index")
            if ix:
                idx = int(ix)
            d = c.find("ss:Data", NS)
            while len(cells) < idx - 1:
                cells.append(None)
            cells.append(d.text if d is not None else None)
            idx += 1
        # data rows: col0 like '1.0', col1 = lgd code (3 digits)
        if len(cells) >= 7 and cells[1] and str(cells[1]).strip().isdigit():
            out[str(cells[1]).strip()] = {
                "name": (cells[3] or "").strip(),
                "census2011": (cells[6] or "").strip(),
            }
    return out


def main():
    kgis = load_kgis()
    census = load_census_shp()
    lgd = load_lgd()
    print(f"[refs] KGIS districts={len(kgis)} | census KA={len(census)} | LGD rows={len(lgd)}")

    warnings, errors = [], []
    for raw, v in DISTRICT_MAP.items():
        a = resolve(raw)
        if not a["is_geographic"]:
            continue
        canon, parent = a["canonical_name"], a["parent_district"]
        kc, lc, cc = a["kgis_code"], a["lgd_code"], a["census_code_2011"]

        # KGIS code must exist; lgd_code must match KGIS's lgd_code
        if kc not in kgis:
            errors.append(f"{raw}: kgis_code {kc} not in KGIS boundaries")
        else:
            if kgis[kc]["lgd_code"] != lc:
                errors.append(f"{raw}: lgd_code {lc} != KGIS lgd {kgis[kc]['lgd_code']} (kgis {kc})")
            score = fuzz.token_set_ratio(parent.upper(), kgis[kc]["district"].upper())
            if score < 55:
                warnings.append(f"{raw}: parent '{parent}' ~ KGIS '{kgis[kc]['district']}' (fuzzy {score})")

        # census code must exist in the 2011 SHP (Vijayanagara legitimately blank)
        if cc:
            if cc not in census:
                errors.append(f"{raw}: census_code_2011 {cc} not in 2011 SHP")
            else:
                score = fuzz.token_set_ratio(parent.upper(), str(census[cc]).upper())
                if score < 45:
                    warnings.append(f"{raw}: parent '{parent}' ~ census '{census[cc]}' (fuzzy {score})")
        elif canon != "Vijayanagara":
            warnings.append(f"{raw}: blank census_code_2011 (only Vijayanagara expected)")

        # LGD authoritative lgd_code <-> census2011 cross-check
        if lc and lc in lgd:
            if cc and lgd[lc]["census2011"] and lgd[lc]["census2011"] != cc:
                errors.append(f"{raw}: LGD says lgd {lc} -> census {lgd[lc]['census2011']}, map has {cc}")
        elif lc:
            warnings.append(f"{raw}: lgd_code {lc} not found in LGD table")

    print(f"\n[validate] {len(errors)} error(s), {len(warnings)} warning(s)")
    for e in errors:
        print("  ERROR:", e)
    for w in warnings:
        print("  warn :", w)

    # write dim_district.csv
    out_dir = paths.ensure_out()
    out_path = os.path.join(out_dir, "dim_district.csv")
    rows = [resolve(raw) for raw in DISTRICT_MAP]
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: (r[k] if not isinstance(r[k], bool) else str(r[k]).lower()) for k in FIELDS})
    geo = sum(1 for r in rows if r["is_geographic"])
    print(f"\n[write] {out_path}: {len(rows)} rows ({geo} geographic, {len(rows)-geo} non-geographic)")
    if errors:
        print("\n!! validation errors present — review the map before proceeding.")
        return 1
    print("[ok] dim_district.csv written and validated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
