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
| 2 | Geospatial intelligence (Hotspot Map) | ✅ COMPLETE |
| 3 | Predictive dashboards (forecast / alerts / risk / anomaly) | ✅ COMPLETE |
| 4–7 | Patterns / network / hub / deploy | ⏳ planned |

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

## Phase 2 — Geospatial Intelligence (Hotspot Map)  ✅ COMPLETE (2026-07-22)

**Goal:** an interactive district → police-station → grid hotspot map (KDE + DBSCAN), a station
layer, honest `geo_precision` styling, and a labelled **modeled time-of-day** layer. Offline model,
API serves precomputed tables, works on the CSV fallback.

### ⚠️ Accuracy guard (the geo_precision artifact)
The 131,146 `district`-centroid incidents all sit at one point per district → they would render as
**fake giant hotspots**. `ml/hotspots.py` filters to `point` + `station` + `place` only and asserts no
`district` leaks in. Verified: 258 centroid/none cells excluded; the API `/hotspots` and the jest test
both confirm no `district` precision reaches the point/heat/cluster layers. District-centroid data stays
on the aggregate choropleth only.

### Model — `ml/hotspots.py` (offline; reads `etl/out/agg_hotspots.csv` + `agg_unit.csv`)
- **KDE** density surface: Gaussian kernel (bw = 2 km) over a haversine BallTree, evaluated per cell.
- **Weighted DBSCAN** (eps = 3 km, min_samples = 400 weighted by incident count, haversine metric).
- Outputs → `ml/out/`:
  - `hotspot_cells.csv` (141,790 rows): lat, lng, count, density, cluster_id, geo_precision, year.
  - `hotspot_clusters.csv` (467 clusters): cluster_id, centroid, n_points, total_count, canonical_name,
    radius_km, top_category, **deployment_note** (proactive-deployment angle).
- **Result:** 467 clusters, **90.4%** of clustered-eligible incidents in a cluster, **silhouette 0.492**.
  Top cluster = Bengaluru Urban (402,838 FIRs, dominant head THEFT); then Mysuru, Dakshina Kannada.

### API — new routes (read precomputed tables via `store.js`, CSV fallback)
- `GET /hotspots?year=&precision=` — heat-layer cells (default all real precisions; `district` never
  returned; capped to top 25k by count for browser performance).
- `GET /hotspots/clusters?limit=` — cluster summaries + deployment notes (top-N by volume; 467 total).
- `GET /stations?district=` — police-station points from `agg_unit` (mean coords + counts).
- `GET /timeofday?district=&category=` — **MODELLED** time-of-day buckets (`data_class=modeled`, with a
  persistent "estimated, not observed" note) + method mix.
- `hotspot_cells` + `hotspot_clusters` added to `datastore_schema.json` + `load_datastore.py`
  (its `csv_path` now falls back to `ml/out/`). **9/9 Jest+Supertest tests pass** (incl. an
  accuracy-guard test that fails if `district`/`none` appears in `/hotspots`).

### Frontend — Hotspot Map workspace (`client/src/workspaces/HotspotMap.jsx`)
- React-Leaflet map, **toggleable layers**: district choropleth base (join on `kgis_code`) · **heat**
  (`leaflet.heat`, log-scaled intensity) · **DBSCAN cluster** circles (sized by volume; popup = count +
  top category + deployment note) · **police-station** markers (click → station stats).
- **Precision filter** (point / station / place) + a **legend** explaining precision and that
  district-centroid data is excluded from the point layers.
- **Drill-down:** click a district → `flyTo` + load its stations; click a station → its counts.
- **Modeled time-of-day** panel: ECharts bar per time bucket for the selected district (or statewide),
  with a persistent `DataClassBadge` = "modeled" and the "estimated, not observed" caveat.
- Year filter (2016–2024 + All). Route `/hotspots` added; sidebar nav item enabled. `leaflet.heat` added.

### Verified locally
- `ml/hotspots.py` re-runnable (~55s), prints cluster count + silhouette, guard-asserts no centroid leak.
- API on **CSV fallback**: `/hotspots?year=2023` → 25k cells (precisions `place,point,station`, **no
  district**); `/hotspots/clusters` → 467; `/timeofday` → `data_class=modeled`; `/stations?district=Mysuru`
  → 52. `vite build` succeeds (2,272 modules). (No browser render available in-session.)

### How to run / deploy
```
python ml/hotspots.py                         # regenerate hotspot tables (writes ml/out/)
# then it's bundled: copy ml/out/*.csv -> functions/crime_api/src/data/ (done)
cd functions/crime_api && npm start           # API on :9000 (CSV fallback)
cd client && npm run dev                       # http://localhost:5173  (Hotspot Map in the sidebar)
# deploy (user step): cd client && npm run build && cd .. && catalyst deploy
```

---

### Hotfix (2026-07-22) — heat bleeding into the Arabian Sea / neighbouring states
**Symptom:** the hotspot heat layer painted a large diffuse blob over the Arabian Sea and across
Karnataka's borders. **Two root causes, both fixed:**
1. **Off-land cells (data).** Phase-0 `geo.py` validates coordinates only against a loose KA bounding
   box (`KA_LON=(73.8, 78.9)`), so some real/geocoded points sat offshore or in neighbouring states.
   → Added a **Karnataka land-polygon clip** in `ml/hotspots.py` (`clip_to_land()`): union of the 31
   KGIS district polygons, buffered ~3 km (`LAND_BUFFER_DEG=0.03`) so genuine coastal/border cells
   survive, then a point-in-polygon test drops the rest **before** KDE/DBSCAN. Removed **1,648 cell-rows
   / 3,098 incidents / 1,438 unique cells**. Deliberately used a real polygon test, **not** a crude
   `lng≥74.6` cut — that would have wrongly deleted ~50k legitimate coastal FIRs (Mangaluru/Udupi/Karwar;
   Karnataka's west coast reaches ~74.1°E at Karwar).
2. **Pixel smear (render).** `leaflet.heat` `radius:18`/`blur:22` smears ~60–70 km at zoom 7.
   → `HeatLayer.jsx`: `radius 18→11`, `blur 22→12`, `maxZoom 13→12`, `minOpacity 0.28→0.2`; and
   `HotspotMap.jsx` heat-intensity floor `0.06→0.03` (less faint wash from tiny cells).

**Verified:** re-ran `ml/hotspots.py` → 140,142 cell-rows (was 141,790), still **467 clusters /
silhouette 0.492** (offshore cells were low-count noise, not cluster cores → `hotspot_clusters.csv`
unchanged). Post-clip cell lng range **74.09→78.59**, **zero cells west of 74.0**; API `/hotspots`
(year=2023 and all) returns **0 offshore cells**, westernmost cluster centroid 74.13 (Karwar, on land).
`vite build` OK. Re-copied `hotspot_cells.csv` → `functions/crime_api/src/data/`. Committed on `main`.

---

### Hotfix (2026-07-22) — heat layer silently blank ("hotspot on but shows none") + audit
**Symptom:** with the "Hotspot heat" layer toggled ON, the map showed no heat. **Root cause:** the
precision filter (point/station/place) could be **fully unchecked**; the frontend then sent
`precision=__none__`, which the API matched against nothing → empty heat, with no explanation. Two
controls (the layer toggle and the precision filter) both gated visibility, so the filter could
silently override the toggle.
**Fix (`HotspotMap.jsx`, frontend-only):**
- `precParam`: "none selected" now means **no filter** (show all real precisions), same as "all
  selected" — removed the `__none__` empty-match branch so the filter can never blank the layer.
- Precision checkboxes now **keep at least one selected** (unchecking the last one is a no-op).
- Added an **empty-state hint** on the map ("No hotspot cells for this filter…") shown only when the
  heat layer is on, not fetching, no error, and genuinely zero points — defensive UX for any cause.
- Microcopy under the filter: "Narrows the heat layer. At least one type stays selected."
- Added a jest test (`/hotspots?precision=point` returns only point cells) → **10/10 pass**; `vite build` OK.

**Wider audit (Phase 0/1/2), no other defects found:** API inputs are safe-decoded and table names in
ZCQL are hardcoded (no injection); CORS is origin-restricted + helmet + rate-limit; the CSV fallback is
resilient (never hard-fails); `/districts` returns `mean_lat/mean_lng` so the drill-down `flyTo` works;
HashRouter handles deep links/refresh; all `client/public` assets (logo, marching bg, geojson) present;
modeled/real/synthetic data classes are labelled. The offshore land-clip from the earlier hotfix holds.

---

## Phase 3 — Predictive Dashboards  ✅ COMPLETE (2026-07-22)

**Goal:** forecasting + emerging-trend alerts, area risk scoring, and anomaly detection —
computed offline in `ml/`, served by the existing API, shown in two new React workspaces.
Predictions are derived from real data (`data_class=real`) but presented as projections/flags.

### Models — `ml/` (offline; read `etl/out/`, write `ml/out/`)
- **`ml/forecast.py`** — monthly forecasting. Engine: **Holt-Winters exponential smoothing**
  (statsmodels, additive trend + additive seasonality, period 12) with a seasonal-naive fallback.
  **Prophet was skipped** — heavy/flaky Windows install under time pressure; the task sanctions the
  statsmodels fallback. Trains on **2016–2023** (partial 2024 excluded from training AND displayed
  history). Bounded series set: statewide total, 31 district totals, top-12 statewide categories,
  and each district's top-5 categories = **199 series** (all fit ETS). 12-month forecast + 95% CI.
  → `forecasts.csv` (21,491 rows: level, key, category, year, month, y_actual, yhat, yhat_lower,
  yhat_upper, is_forecast, method). **Backtest on held-out 2023: statewide MAPE 14.3%, median 21.7%.**
- **`ml/alerts.py`** — emerging-trend "red-zones": 2023 actual vs **recent 2021–2022 baseline**
  per district×category (recent baseline avoids COVID-2020/21 inflating deviations). Floors
  (baseline ≥ 80, absolute jump ≥ 50) + thresholds (red ≥ +40%, amber ≥ +20%). → `alerts.csv`
  (**121 red-zones: 68 red, 53 amber**). Cols: canonical_name, kgis_code, category, period, actual,
  baseline, deviation_pct, severity, reason.
- **`ml/risk.py`** — area risk scoring with **LightGBM** regression on a district×year panel
  (target = year total; features from prior years). **Validation (held-out 2023): Spearman ρ=0.837**,
  MAE 27.5% of mean. Final model predicts 2024 → 0–100 risk score (log-scaled) + tier (Low/Moderate/
  High/Critical, quantile bands) + per-district **SHAP drivers** (`pred_contrib`). → `risk_scores.csv`
  (31 districts; tiers Low 11 / Moderate 8 / High 6 / Critical 6; top = Bengaluru Urban 100/Critical).
  **FAIRNESS:** features = lag totals, 3-yr avg, trend, YoY, seasonal volatility, crime-type mix
  (property/violent/traffic/cyber), population, prior per-capita — **never caste/religion/sex**
  (`sc_share`/`st_share`/`sex_ratio` are excluded; kept for the Phase-5 correlation view only).
- **`ml/anomaly.py`** — **IsolationForest** on scale-free features (standardised residual z +
  log ratio) + a z-score rule, over district×category monthly counts (2016–2023, top-10 cats/district).
  Spike-focused (low-side outliers are data-gap/COVID noise → excluded). → `anomalies.csv`
  (**134 spikes**; e.g. Jul 2017 CrPC in Dharwad 5.1×). **Injected-spike recall 80%** (120 synthetic spikes).

### API — new routes (`functions/crime_api/src/routes/predict.js`, read precomputed tables via `store.js`)
- `GET /forecast?level=state|district|category&key=&category=` — history + 12-mo forecast points (+CI, method)
- `GET /forecast/options` — selectable districts (31) + categories (12)
- `GET /alerts?severity=` — red-zones sorted (red first, then deviation)
- `GET /risk` — per-district scores + tier counts (join on `kgis_code`); `GET /risk/:id` — one district + drivers
- `GET /anomalies?district=&category=&year=&limit=` — flagged spikes (sorted by score)
- 4 CSVs bundled into `src/data/`; added to `datastore_schema.json` (now 23 tables) + `load_datastore.py`;
  `forecasts` added to the `CSV_ONLY` set in `store.js` (21k rows — never paged via ZCQL).
  **Jest+Supertest: 17/17 pass** (added 7 Phase-3 cases incl. a fairness check on `/risk/:id` drivers).

### Frontend — two new workspaces (`client/`, match Phase 1 conventions)
- **Trends & Forecast** (`TrendsForecast.jsx`): scope selector (Statewide / by district / by category) →
  ECharts line — solid actual 2016–2023 + **dashed projected 2024 with a shaded 95% CI band**; an
  **emerging-trend alerts** panel (red/amber list, filterable, click → re-scope the chart); and a
  **red-zone choropleth** (districts shaded by worst active alert, click → re-scope).
- **Risk & Vulnerability** (`RiskVulnerability.jsx`): **risk-tier choropleth** (join on `kgis_code`,
  click → district drivers), ranked highest-risk list with score bars, a **drivers** panel
  (score / projected FIRs / SHAP drivers), and **anomaly call-outs** (filter to the selected district).
- Routes `/trends` + `/risk` added; sidebar nav items enabled. `vite build` OK (2,274 modules).

### Verified locally (CSV fallback, zero Catalyst services)
- All 4 models re-runnable, each prints a validation metric (forecast MAPE, risk Spearman, anomaly recall).
- API on port 9010 spot-check: `/forecast?level=state` 108 pts (96 hist + 12 fc, ets), `/forecast/options`
  31+12, `/risk` 31 (Bengaluru Urban 100/Critical), `/alerts` 121 (68/53), `/anomalies` 134. Build passes.

### How to run
```
python ml/forecast.py ; python ml/alerts.py ; python ml/risk.py ; python ml/anomaly.py   # writes ml/out/
# bundle: copy ml/out/{forecasts,alerts,risk_scores,anomalies}.csv -> functions/crime_api/src/data/ (done)
cd functions/crime_api && npm start        # API on :9000 (CSV fallback)
cd client && npm run dev                    # Trends & Forecast + Risk & Vulnerability in the sidebar
```

### Notes
- statsmodels added to the environment (Prophet intentionally not installed). `requirements.txt` already
  lists both; the code path uses statsmodels + a seasonal-naive fallback.
- Committed on `main`. `Plans/future_Ideas.md` untouched.

### QA hardening pass (2026-07-22)
A full audit (data-integration script + code review) confirmed no fakes/incomplete features and fixed
three items:
- **Bug (API `/forecast`):** `level=district`/`category` with no `key`/`category` returned *all* series
  concatenated (a garbled multi-line chart if the selector fired before options loaded). Now the route
  always resolves to exactly ONE series (defaults to the first available key/category); added a jest test.
- **Anomaly recall:** added a multiplicative-spike rule (count ≥ 2.5× seasonal expectation) alongside the
  IsolationForest + z-rule → **injected-spike recall 80% → 91%** (415 genuine spikes surfaced; all still
  count>expected). Frontend/API cap the display to the top by score.
- **Risk score presentation:** rescaled the 0–100 index to **8–100** so the lowest district shows a small
  bar rather than an empty "0" (tiers are quantile-based, unchanged). Removed an unused import.
- **Frontend CI band:** made the forecast confidence band define values at every point (0-height over
  history) so the stacked area never has null-gap rendering edge cases.
- **Integration invariants verified (temp script, then deleted):** all 31 risk + all alert `kgis_code`s
  join to the 31 GeoJSON polygons (0 gaps); every district/category/state forecast series has exactly 12
  projection points; 0 CI-ordering violations; 0 NaN/negative forecasts; anomalies are all genuine spikes.
  **18/18 Jest tests pass; `vite build` OK.** Security re-checked: user inputs are string-compared or
  clamped ints, ZCQL table names hardcoded → no injection; CORS/helmet/rate-limit inherited from Phase 1.

---

## Phase 4+ — Patterns / network / hub / deploy  ⏳ (separate sessions)
