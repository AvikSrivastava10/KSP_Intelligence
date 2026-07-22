# etl/ — Offline data pipeline (Python)

Streams the raw FIR data into clean, compact, API-ready tables. Runs as an **offline build step**;
outputs are loaded into the Catalyst Data Store and bundled as CSV fallback. Nothing here runs at request time.

## What it does (Phase 0)
1. **Canonical district dimension** — reconciles FIR district names ↔ 2021 KGIS ↔ 2011 census ↔ LGD codes.
2. **Stream + clean + reconstruct** — surrogate `case_id`, `ActSection`→act/section, reference tables, rank from `IOName`.
3. **Geocode** — real coords → police-station coords (921 KGIS) → GeoNames → district centroid; tag `geo_precision`.
4. **Modeled time-of-day** — per-crime-type profile (real day/night from `CrimeHead_Name` + criminological priors); labelled "estimated, not observed".
5. **Aggregate** — compact tables into `out/`.

## Outputs → `etl/out/`
`dim_district.csv`, `agg_hotspots.csv`, `agg_unit.csv`, `agg_district_month.csv`, `agg_outcomes.csv`, `meta.json`.

## Hard rules
- **NEVER open `datasets/FIR_Details_Data.csv` in Excel** (546 MB / 1,674,734 rows; Excel truncates at 1,048,576). Use pandas/DuckDB.
- Read with `encoding="utf-8-sig"`; header `Arrested Count\tNo.` has a literal tab.
- Reproducible + re-runnable; verify total rows == 1,674,734.

Spec: `Plans/Backend_architecture.md` §3 and `Plans/Models_application.md` §10a.
