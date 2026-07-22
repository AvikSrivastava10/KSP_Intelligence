# Phase-wise Development Log — KSP Crime Intelligence Platform

> Chronological record of what was actually built, verified, and decided in each phase.
> Source of truth for progress. Canonical project state lives in `.kiro/steering/project-brief.md`;
> this file is the human-readable narrative of development per phase.
>
> **Roadmap:** `Plans/plan.md` · **Last updated:** 2026-07-22

| Phase | Title | Status |
|---|---|---|
| 0 | Data foundation (ETL + schema) | ✅ COMPLETE |
| 1 | Live web app (API + Dashboard) | ✅ COMPLETE |
| 2 | Geospatial intelligence (Hotspot Map) | ⏳ next |
| 3–7 | Predictive / patterns / network / hub / deploy | ⏳ planned |

---

## Phase 0 — Data Foundation  ✅ COMPLETE (2026-07-22)

**Goal:** turn the raw 546 MB / 1,674,734-row FIR extract into clean, enriched, API-ready tables
+ a canonical district dimension + the Catalyst Data Store schema. Reproducible, re-runnable,
no fabricated data presented as real.

### What was built (`etl/`)
- **Shared helpers** (`etl/common/`): `paths.py`, `textutils.py` (header/`ActSection`/rank parsing),
  `districts.py` (hand-verified district override map), `geo.py` (multi-tier geocoder),
  `timeofday.py` (documented time-of-day priors).
- **`etl/build_dim_district.py`** → `etl/out/dim_district.csv` — the canonical district dimension.
- **`etl/ingest_fir.py`** → the streaming ETL producing all aggregate + reference tables + `meta.json`.
- **`etl/schema.md`** — Catalyst Data Store schema modelled on the official ER diagram.
- **`etl/load_datastore.py`** — dry-run inventory stub (fully implemented in Phase 1).

### Key results
- **Row reconciliation exact: 1,674,734 == expected.** Pipeline runs end-to-end in ~40s, deterministic.
- **Canonical district dimension** (41 FIR units): 37 geographic + **4 non-geographic flagged**
  (CID, Coastal Security, ISD, Karnataka Railways). City commissionerates + K.G.F fold into their
  parent → **31 KGIS map polygons**. Cross-validated vs 2021 KGIS + 2011 census SHP + LGD (0 errors;
  expected fuzzy warnings only: Ramanagara↔"Bengaluru South" 2024 rename, Kalaburagi↔"Gulbarga" 2011 name).
- **Geocoding** (multi-tier, tagged `geo_precision`): **29.92% real points → 99.54% after** geocoding
  (point 501,075 / KGIS-station 1,014,580 / GeoNames place 20,276 / district-centroid 131,146 /
  none 7,657 = the non-geographic specials). 875/1071 units matched to KGIS station coords.
- **Reconstructions:** deterministic surrogate `case_id`; `ActSection` → `dim_act` (4,831) + `dim_section`
  (17,465); reference dims `dim_crime_head` (107), `dim_crime_subhead` (626), `dim_case_status` (13,
  with ~300 `Transfered :UI(...)` variants collapsed → `Transferred`), `dim_gravity` (2),
  `dim_rank` (21, from `IOName` suffix), `dim_complaint_mode` (10).
- **Modeled time-of-day** (`agg_timeofday.csv`, `data_class=modeled`): real day/night signal read from
  **`CrimeGroup_Name`** (`BURGLARY - NIGHT/DAY`) → `category_encoded`, else `criminological_prior`,
  else `default_distributed`. Illustrative only; never trains models.
- **Aggregate tables** (`etl/out/`): `agg_district_month` (124,314), `agg_hotspots` (142,048,
  `(lat,lng,precision,year)` grid), `agg_unit` (1,074), `agg_outcomes` (41), `agg_case_status` (514),
  `agg_socioeconomic` (30, 2011 Census per-capita join), `entity_edges` (4,558, real within-case
  co-occurrence graph), `meta.json` (full provenance).

### Data-quality finds
- Raw **`VICTIM COUNT` column is dead** (sum ≈ 464 across 1.67M rows) → `victims` computed from
  Male+Female+Boy+Girl instead (real; e.g. RAPE ≈ 1.0, MURDER ≈ 1.15 victims/case), kept as a **total**
  (sex never used as a model feature — fairness guardrail respected).
- Real coordinates validated to the Karnataka bbox (501,075 valid vs 508,066 raw-filled; ~7k
  invalid/out-of-state dropped).
- Outcome rates can exceed 1 for the 4 non-geographic special units (inconsistent source count
  columns) — kept raw/honest.

### Notable decisions
- Spec said the day/night signal was in `CrimeHead_Name`; the data proved it is in `CrimeGroup_Name`
  (sub-head has zero NIGHT/DAY values) → implemented against the real data, documented the correction.
- `entity_edges` (listed in `plan.md` Phase 0) was added even though the task marked it a stretch —
  it feeds Phase 5's network capability.
- Committed on `main`: `etl/` code + `etl/out/` CSV/JSON. `datasets/` stays gitignored; only parquet is
  ignored inside `out/`. `Plans/future_Ideas.md` left untouched (user-owned).

---

## Phase 1 — Live Web App  ✅ COMPLETE (2026-07-22)

**Goal:** a live app — Catalyst Data Store loader + Node/Express `crime_api` + a React Dashboard with
real statewide KPIs and district drill-down. The app must work locally on the bundled CSV fallback
with **zero Catalyst services configured** (proven first).

### Backend — `functions/crime_api/` (Node 18 + Express, Catalyst Advanced I/O)
- **`src/lib/`**: `{ok, data_class, result, request_id}` response envelope; security middleware
  (helmet + cors + express-rate-limit + request-id); in-memory TTL cache; a **storage-agnostic reader**
  (`store.js`) that tries the Catalyst Data Store (ZCQL, paginated) when `USE_DATASTORE=true` and
  **falls back to the bundled CSVs** otherwise; a robust CSV parser (handles quoted commas).
- **`src/routes/`** (all read precomputed tables — **no ML at request time**):
  - `GET /health` — liveness + active storage backend
  - `GET /meta` — full provenance / `data_class` map (serves `meta.json`)
  - `GET /overview` — state KPIs (aggregated over geographic units only; 2024 flagged partial)
  - `GET /districts` — 31 districts joined to the choropleth on `kgis_code`; `?per_capita=true`
  - `GET /district/:id` — drill-down (id = parent district; aggregates member units incl. city+district):
    monthly series, category breakdown, outcomes + rates, case-status split, top stations
- Mounted at `/server/crime_api` (Catalyst) and `/` (local). `etl/out/*.csv` + `meta.json` bundled into
  `src/data/` (so the function deploys self-contained). `package.json`, `catalyst-config.json`,
  Jest + Supertest smoke test.

### Frontend — `client/` (React 18 + Vite + Tailwind)
- **Shell**: React Router, Sidebar/TopBar layout, `DataClassBadge` (real/modeled/synthetic),
  envelope-unwrapping API client, TanStack Query, Zustand filter store.
- **Dashboard workspace**:
  - 6 KPI cards (total FIRs, districts, year range w/ 2024-partial, conviction rate, detection rate, % geocoded)
  - **District choropleth** (React-Leaflet + bundled `karnataka_districts.geojson`), colored by total
    crimes, **joined on `kgis_code`** (names differ, codes match); raw-count vs per-capita toggle;
    click a district → drill-down panel
  - **Drill-down panel**: outcome rate pills + monthly ECharts line + top-crime-head bars + top stations
  - **Yearly trend**: ECharts line, 2024 shown amber (partial)
- Web map layer bundled: `client/public/karnataka_districts.geojson`. `vite build` → `client/dist`
  (+ `client-package.json` + `404.html` for Catalyst web hosting).

### Data Store load — `etl/load_datastore.py`
- `--plan` (dry-run inventory) · `--schema` (emits `etl/out/datastore_schema.json` = authoritative
  table/column/type spec, e.g. `kgis_code` as `varchar`) · `--load` (idempotent truncate+insert via the
  Catalyst Data Store REST API, OAuth creds from env, batched).
- Catalyst has **no public create-table API** → tables are created in the console from the schema JSON;
  documented. The app runs on the CSV fallback until the Data Store is loaded.

### Deploy wiring
- Root **`catalyst.json`**: functions target `crime_api` (source `functions`); client source `client/dist`.
- **`functions/crime_api/catalyst-config.json`**: `advancedio`, `node18`, `USE_DATASTORE=false` default.
- **Deployment is the user's step** (needs their Zoho Catalyst account) — not run in-session.

### Verified locally
- Backend on **CSV fallback** (zero Catalyst services): **5/5 Jest+Supertest tests pass**; live check —
  total FIRs **1,674,734**, **31 districts**, conviction **0.2242**, detection **0.8857**, geocoded **99.54%**,
  top head "MOTOR VEHICLE ACCIDENTS NON-FATAL" 242,976. Mysuru drill-down correctly merges Mysuru +
  Mysuru City (81,109); Belagavi 80,446.
- `vite build` succeeds (2,268 modules) → `client/dist` with all Catalyst-hosting files.
- **Choropleth join verified: 31 API district codes == 31 GeoJSON polygons, 0 mismatches.**
- Not verifiable with available tooling: a live browser render (no browser) — but build + API contract
  + geo join all pass, so the wiring is sound.

### How to run locally
```
# API (terminal 1)
cd functions/crime_api && npm install && npm start        # http://localhost:9000
# client (terminal 2) — dev proxies /server -> :9000
cd client && npm install && npm run dev                   # http://localhost:5173
```

### How to deploy (user step)
```
catalyst login
catalyst init                       # link org + project (keep existing catalyst.json)
cd client && npm run build && cd ..
catalyst deploy                     # deploys crime_api + built client/dist
```
Optional — move off CSV onto the Data Store:
```
python etl/load_datastore.py --schema     # create tables in console from etl/out/datastore_schema.json
# set env: CATALYST_PROJECT_ID, CATALYST_API_DOMAIN, CATALYST_ENVIRONMENT, ZOHO_ACCOUNTS_URL,
#          ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
python etl/load_datastore.py --load       # idempotent bulk load
# then set the crime_api function env var USE_DATASTORE=true (still falls back to CSV on error)
```

### Notes
- `node_modules/` and `client/dist/` are gitignored → build before deploy. The CSV fallback bundle in
  `functions/crime_api/src/data/` **is** committed so the function deploys self-contained.
- Committed on `main` (authored by the repo owner). `Plans/future_Ideas.md` untouched.

---

## Phase 2 — Geospatial Intelligence  ⏳ NEXT
Deep Hotspot Map (KDE + DBSCAN on `agg_hotspots`) · district→station→grid drill-down · `geo_precision`
styling · modeled time-of-day layer (labelled). See `Plans/plan.md` Phase 2.
