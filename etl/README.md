# etl/ — Offline data pipeline (Python)

Streams the raw FIR data into clean, compact, API-ready tables. Runs as an **offline build step**;
outputs are loaded into the Catalyst Data Store and bundled as CSV fallback. Nothing here runs at request time.

## What it does (Phase 0)
1. **Canonical district dimension** — reconciles the 41 FIR district units ↔ 2021 KGIS ↔ 2011 census ↔ LGD codes; flags the 4 non-geographic units; maps city commissionerates to their parent district.
2. **Stream + clean + reconstruct** — chunked read (never whole-file); fix UTF-8 BOM + the tab-mangled `Arrested Count\tNo.` header; trim/normalize categoricals; surrogate `case_id`; `ActSection`→act/section; reference tables; officer rank from `IOName` suffix; collapse the `Transfered :UI(...)` status tail.
3. **Geocode** — real coords → KGIS police-station coords (921 stations, district-census disambiguation + fuzzy) → GeoNames place → district centroid; tag `geo_precision`.
4. **Modeled time-of-day** — per-crime-type profile; **real day/night signal lives in `CrimeGroup_Name`** (e.g. `BURGLARY - NIGHT/DAY`) + criminological priors; labelled "estimated, not observed" (`data_class = modeled`), never used to train models.
5. **Temporal features + aggregate** — day-of-week/month/season/quarter, `is_2024_partial`; emit compact tables into `out/`.

## Scripts
- `common/` — shared helpers: `paths.py`, `textutils.py` (header/ActSection/rank), `districts.py` (hand-verified override map), `geo.py` (multi-tier geocoder), `timeofday.py` (documented priors).
- `build_dim_district.py` — writes `out/dim_district.csv`, cross-validates the district map against KGIS/census/LGD (rapidfuzz + exact code checks).
- `ingest_fir.py` — the streaming ETL; emits all aggregate + reference tables + `meta.json`; prints the Phase 0 completion report. `--limit N` for a smoke test.
- `load_datastore.py` — Phase 1 loader **stub**; dry-run inventory of `out/` + inferred Catalyst types.
- `schema.md` — Catalyst Data Store schema, modelled on the official ER diagram (REAL / MODELED / SYNTHETIC / designed-only planes).

## Run
```
python etl/build_dim_district.py      # 1. canonical district dimension (+ validation)
python etl/ingest_fir.py              # 2. full streaming ETL (~40s, reconciles to 1,674,734)
python etl/load_datastore.py          # 3. (optional) dry-run load plan
```

## Outputs → `etl/out/`
- **Aggregates:** `agg_district_month.csv`, `agg_hotspots.csv`, `agg_unit.csv`, `agg_outcomes.csv`, `agg_case_status.csv`, `agg_socioeconomic.csv`, `entity_edges.csv` (REAL co-occurrence graph), `agg_timeofday.csv` (MODELED).
- **Dimensions:** `dim_district.csv`, `dim_crime_head.csv`, `dim_crime_subhead.csv`, `dim_case_status.csv`, `dim_gravity.csv`, `dim_complaint_mode.csv`, `dim_act.csv`, `dim_section.csv`, `dim_rank.csv`.
- **Provenance:** `meta.json` (row counts, per-year, coord coverage before/after, geocoding stats, data-class labels).

## Hard rules
- **NEVER open `datasets/FIR_Details_Data.csv` in Excel** (546 MB / 1,674,734 rows; Excel truncates at 1,048,576). Use pandas/DuckDB only.
- Read with `encoding="utf-8-sig"`; header `Arrested Count\tNo.` has a literal tab.
- No protected attributes (caste/religion/sex/occupation) as features; `victims` is a total, never sex-split.
- Reproducible + re-runnable; total rows must reconcile to **1,674,734**.

Spec: `Plans/Backend_architecture.md` §2–§3 and `Plans/Models_application.md` §10a.
