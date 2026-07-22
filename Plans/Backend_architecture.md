# Backend_architecture.md — Functions, Data Store, API, ETL

> Backend deep-dive for the Catalyst deployment: the serverless functions, the Data Store schema
> (modelled on the official KSP ER diagram), the ETL that feeds it, and the API contract.

---

## 1. Catalyst functions

| Function | Type | Responsibility |
|---|---|---|
| **`crime_api`** | Advanced I/O Function | The REST backend — all workspace endpoints. Storage-agnostic reads (Data Store → CSV fallback). **The only function the MVP needs.** |

*(Optional / future, not core: `ingest_cron` (Cron) and `event_handler` (Signals) — only useful once data is live/refreshing. Ours is static 2016–2024, so we skip them for the MVP.)*

Runtime: **Node + Express** for `crime_api` (LOCKED). Heavy ML runs **offline in Python** (build step); the function only serves precomputed tables, so a thin Node/Express layer is ideal (fast I/O, Catalyst's most mature runtime, P2-proven, one language with the React frontend). Libraries: `zcatalyst-sdk-node` (Data Store/ZCQL, optional Cache/Auth), `zod` (request validation), `helmet` + `cors` + `express-rate-limit` (security), Jest + Supertest (tests).

## 1b. Where the heavy work runs (lean — no extra services)

The models + ETL are **not** a runtime service — they're a **build-time Python pipeline** run offline (locally): stream the FIR file, compute/train everything, emit compact tables. We load those into the Data Store and bundle CSV copies with the function. The deployed app (Node API + React + Data Store) is fully on Catalyst; the pipeline doesn't need to run there.

- **No AppSail** — nothing to host at runtime; the app reads precomputed tables, not Python.
- **No Zia AutoML / QuickML** — we train the tabular models ourselves (LightGBM/sklearn) inside the same pipeline, for speed and full feature control (matters for the fairness guardrails).
- **No Mail / Push / SmartBrowz / Stratus** — alerts render in-app, reports export client-side, static files (GeoJSON) are bundled.
- **No Cron / Signals** — data is static; no scheduled refresh or event reactions needed.
- Future: if we ever want the pipeline running *on* Catalyst (live re-ingest), AppSail (Docker/Python) is the home — see `future_Ideas.md`.

## 2. Data Store schema (⊂ official ER diagram)

The official ER diagram (`Police_FIR_ER_Diagram.pdf`) has ~27 normalized tables. We model the **subset we can populate** from the FIR extract, and mark the rest **designed-only** (present in schema for fidelity / future real data).

### 2a. Core (REAL plane) — populated
- **`case_master`** — one row per FIR. Columns we can fill: surrogate **`case_id`** (reconstructed — the extract has *no* FIR id), district, unit/PS, `crime_registered_date` (Y/M/D), gravity (Heinous/Non-Heinous, from `FIR Type`), major head (`CrimeGroup_Name`), sub head (`CrimeHead_Name`), status (`FIR_Stage`), complaint mode, lat/long (30% real + geocoded fallback), `geo_precision` (point/station/district), **`modeled_time_of_day`** (labelled estimate), IO ref.
- **Dimension/reference tables** (reconstructed from distinct values): `district`, `unit` (police station, + KGIS coords), `crime_head`, `crime_subhead`, `case_status`, `gravity`, `act`, `section` (from splitting `ActSection`), `employee`/`rank` (from `IOName`+`KGID`).
- **Aggregate/result tables** (what the API actually serves — small & fast):
  - `agg_hotspots` (grid cell lat/lng rounded ~1.1 km, counts) 
  - `agg_unit` (per police-station counts + mean coords)
  - `agg_district_month` (district × month × category series)
  - `agg_outcomes` (per district: victim/accused/arrest/conviction/chargesheet counts + rates)
  - `agg_socioeconomic` (district crime rates joined to Census)
  - `forecasts`, `risk_scores`, `anomalies`, `mo_clusters` (model outputs)
  - `entity_edges` (co-occurrence graph edges: crime-type↔location↔unit↔section)

### 2b. SYNTHETIC plane — clearly separated
- **`syn_person`** (synthetic suspects/victims; demographic buckets matched to real counts), **`syn_case_person`** (links to cases), **`syn_offender_network`** (edges: co-offending, repeat-offender, association). Every table flagged `is_synthetic = true`; served only to the Network workspace's synthetic mode.

### 2c. Designed-only (in ER, NOT populated) — documented, empty
`complainant_details`, `victim`, `accused`, `arrest_surrender` (real person tables), `court`, `chargesheet_details`, caste/religion/occupation lookups. Kept in the schema so real SCRB data + an anonymization layer could populate them later.

## 3. ETL pipeline (offline Python) — the heart

Adapted from reference project **P2's `fir_incidents.py`** streaming pattern, extended with our reconstruction + enrichment.

**Stages:**
1. **Stream & clean** — read the 546 MB CSV row-by-row (never whole-file). Fix UTF-8 BOM, the tab-mangled `Arrested Count\tNo.` header, leading spaces / casing in categories (fuzzy header aliases).
2. **Reconstruct** — surrogate `case_id`; parse `ActSection` → `act` + `section`; build all reference/dimension tables; derive `rank` from `IOName` suffixes ("(PI)", "(PSI)").
3. **Standardize geography** — canonical **district dimension** (name ↔ census code ↔ LGD code ↔ KGIS code); separate the 4 non-geographic units (CID, Coastal Security, ISD, Railways).
4. **Geocode** — keep real lat/long (30%); else pin to **KGIS police-station coords** (921 stations) via unit match; else GeoNames village/place lookup; else district centroid. Tag `geo_precision`.
5. **Construct modeled time-of-day** — assign a time bucket/profile per crime type: real day/night from `CrimeHead_Name` where present + criminological priors otherwise. Labelled MODELED.
6. **Temporal features** — day-of-week, month, season, quarter; flag 2024 partial.
7. **Aggregate** — emit the compact `agg_*` tables.
8. **Join** — Census socio-economic + boundary keys.
9. **Generate synthetic plane** — persons/links matched to real marginals (separate output).
10. **Emit** — write tables for Data Store load **and** bundle CSV copies for fallback + a `meta.json` (provenance, row counts, generated-at).

**Rule:** entirely scripted + re-runnable. No manual/Excel edits (Excel truncation cost us 626k rows once).

## 4. API contract

**Envelope (from P2, adopted):**
```json
// success
{ "ok": true, "result": { ... }, "request_id": "..." }
// error
{ "ok": false, "error": "message", "request_id": "..." }
```

**Endpoint groups (by workspace):**
- `GET /api/overview` · `/api/districts` · `/api/district/:id`
- `GET /api/hotspots?level=district|station|grid&category=&year=`
- `GET /api/patterns/mo-clusters` · `/api/patterns/seasonality`
- `GET /api/trends?district=&category=` · `/api/forecast?...` · `/api/alerts` (spikes)
- `GET /api/risk?...` · `/api/vulnerable`
- `GET /api/socio?indicator=` (crime vs census)
- `GET /api/anomalies`
- `GET /api/outcomes?district=` (arrest/conviction/detection rates)
- `GET /api/network/entity` (REAL co-occurrence) · `/api/network/persons` (SYNTHETIC, labelled)
- `GET /api/timeofday?...` (MODELED, labelled)
- `POST /api/report` (export) · `GET /api/search`
- `GET /api/meta` (provenance, data labels, generated-at) · `/api/health`

Every payload includes a **`data_class`** field (`real` | `modeled` | `synthetic`) so the frontend can label panels automatically.

## 5. Storage-agnostic reader + resilience

- A single data-access layer tries **Data Store (ZCQL)** first, falls back to **bundled CSV** if unavailable — so a demo never hard-fails.
- Expensive endpoints wrapped in **Cache.remember(key, ttl, fn)**.
- Errors return the structured envelope, never a stack trace / 500 page.

## 6. Security & auth

- API Gateway in front; function middleware adds security headers, CORS policy, JSON body cap, rate limiting, and a `request_id` per call.
- **Catalyst Authentication** with 4 roles (analyst / supervisor / investigator / policymaker); audit-log API calls.
- No secrets in code; config via environment.
- ⚠️ Any network-exposed endpoint without auth must be flagged — default to auth-on for anything beyond `/api/health`.

## 7. Deploy

- `catalyst.json` wires functions + web client; `catalyst-pipelines.yml` for CI/CD.
- Function mounts at `/server/crime_api` (Catalyst) and `/` (local serve) — mirror P2's dual-mount for easy local dev.
