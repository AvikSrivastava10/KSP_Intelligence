# Complete_architecture.md — End-to-End System Design

> The whole system in one place: layers, data flow, Catalyst services, and how the pieces connect.
> Deep-dives live in `Backend_architecture.md`, `Frontend_architecture.md`, and `Models_application.md`.

---

## 1. Design principles

1. **Precompute, don't compute-on-request.** The 546 MB / 1.67M-row FIR file is streamed offline into small, API-ready aggregate tables. The live API serves tiny payloads fast.
2. **Never hard-fail.** Every read path is storage-agnostic: Catalyst Data Store in production, bundled CSV as automatic fallback.
3. **Two labelled data planes.** REAL (analytics) and SYNTHETIC (person-network demo) never mix silently; the MODELED time-of-day layer is tagged as an estimate.
4. **Schema-faithful.** The Data Store mirrors the official KSP ER diagram (the subset we can populate), so real departmental data could drop in later.
5. **Reproducible.** ETL and model training are scripted end-to-end; nothing is hand-edited (that's how the Excel truncation happened once — never again).

## 2. Layered architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PRESENTATION            React + Vite SPA  (Catalyst Web Client Hosting)  │
│  8 workspaces · Leaflet maps · Chart.js/Recharts · Real/Modeled/Synthetic │
│  labels · export report                                                   │
└───────────────▲───────────────────────────────────────────────────────────┘
                │ HTTPS  {ok, result} JSON envelope
┌───────────────┴───────────────────────────────────────────────────────────┐
│  API / SERVING           Catalyst API Gateway → crime_api                 │
│  (Advanced I/O Function) routes · security middleware · Cache.remember    │
│  storage-agnostic reader (Data Store → CSV fallback)                      │
└───────────────▲───────────────────────────────────────────────────────────┘
                │ ZCQL / bundled tables
┌───────────────┴───────────────────────────────────────────────────────────┐
│  DATA STORE              Catalyst Data Store (schema ⊂ official ER diagram)│
│  REAL plane: cases, hotspots, unit/district aggregates, outcomes, trends, │
│  socio-economic, entity-cooccurrence  │  SYNTHETIC plane: persons, links  │
└───────────────▲───────────────────────────────────────────────────────────┘
                │ load
┌───────────────┴───────────────────────────────────────────────────────────┐
│  ANALYTICS / ML (Python, offline)   6 models + 2 modules                  │
│  hotspot · forecast+alerts · risk · anomaly · MO clustering · outcomes    │
│  + graph module + socio-econ module   → write compact result tables       │
└───────────────▲───────────────────────────────────────────────────────────┘
                │ clean, enriched tables
┌───────────────┴───────────────────────────────────────────────────────────┐
│  ETL / ENRICHMENT (Python, offline, stdlib-stream)                        │
│  stream FIR 1.67M → clean → reconstruct (surrogate key, Act/Section,      │
│  reference tables) → geocode (station coords + GeoNames) → construct       │
│  modeled time-of-day → join Census/boundaries → emit compact tables       │
│  + generate SYNTHETIC person layer (separate plane)                       │
└───────────────▲───────────────────────────────────────────────────────────┘
                │ raw
┌───────────────┴───────────────────────────────────────────────────────────┐
│  SOURCES   FIR_Details (real) · CRIME_REVIEW · ka-district-2025 ·         │
│  external/: boundaries(GeoJSON) · census · geonames · police_stations ·   │
│  lgd · ipc_bns_crosswalk · ER diagram (schema)                            │
└───────────────────────────────────────────────────────────────────────────┘
```

## 3. Catalyst services — lean footprint

**Priority: minimize dependencies.** Deployment on Catalyst is mandatory; individual services are *optional*. We use a Catalyst service only where it's clearly the best option and build everything else ourselves — less to learn, integrate, and debug means more time for the analytics and UI that actually win.

### Core — this *is* the deployed app (3 services)
| Catalyst service | Role |
|---|---|
| **Serverless / Advanced I/O Function** (`crime_api`, Node+Express) | REST backend (thin serving layer) |
| **Web Client Hosting** | serve the React SPA (static build) |
| **Data Store** (ZCQL) | database (ER-modelled tables) + full-text search; CSV fallback keeps us unblocked |

### We build ourselves (drop the Catalyst service)
| Capability | We build | Instead of |
|---|---|---|
| All models + ETL | **Python pipeline run offline** (build step) → compact tables into Data Store (+CSV) | Zia AutoML, AppSail, QuickML |
| Emerging-trend alerts | in-app **red-zone visualization** + alerts endpoint | Mail, Push |
| Report export | **client-side** (print stylesheet / html2canvas) | SmartBrowz |
| Static assets (GeoJSON) | **bundled** with the app | Stratus |
| Refresh / events | not needed — data is static (2016–2024) | Cron, Signals |
| Caching | precomputed tables + tiny in-function memo | Cache (add only if a real hotspot appears) |

### Optional (cheap adds, only if time/need)
- **Authentication** (role personas) — or a lightweight demo role-switcher.
- **API Gateway** (throttling) — else the function serves routes directly.
- **Pipelines** (CI/CD) — else deploy via Catalyst CLI.

### Parked → `future_Ideas.md`
Zia AutoML, AppSail, QuickML (RAG assistant), Zia OCR/Voice, Mail/Push, SmartBrowz, Stratus, Cron, Signals, Circuits, Domain Mappings, NoSQL. **Skipped:** Connections.

**Validity note:** the services table warns a third-party alternative "may affect validity"; we consciously accept that tradeoff for speed and control. Most of our ML (KDE/DBSCAN, Prophet, HDBSCAN, NetworkX, association rules) has no Catalyst equivalent regardless. The single service worth reconsidering if hedging that risk is **Zia AutoML** for the two tabular models (risk, case-outcome).

## 4. Data flow (end to end)

1. **Ingest (offline ETL):** stream `FIR_Details_Data.csv` row-by-row (never load whole file), clean headers/BOM/categories, reconstruct keys + reference tables, geocode, construct modeled time-of-day, join census + boundaries.
2. **Aggregate (offline):** produce compact tables — district/unit/grid hotspots, monthly series per district×category, outcomes, socio-economic joins, entity co-occurrence edges.
3. **Model (offline):** train/run the 6 models + 2 modules; write result tables (forecasts, risk scores, anomalies, clusters).
4. **Generate synthetic (offline, separate plane):** person + relationship tables matched to real marginals, tagged synthetic.
5. **Load:** push all tables into the Catalyst Data Store; also bundle CSV copies with the function for fallback.
6. **Serve:** `crime_api` answers workspace requests from Data Store (or CSV), cached.
7. **Render:** React SPA draws maps/charts/graphs, each panel tagged Real / Modeled / Synthetic.

## 5. The two data planes (+ the modeled layer)

| Plane / layer | Contents | Label in UI | Used for training? |
|---|---|---|---|
| **REAL** | FIR-derived aggregates, census, boundaries, outcomes, entity co-occurrence | (none / "real") | Yes |
| **MODELED** | constructed time-of-day profile per crime type | "estimated, not observed" | No (illustrative) |
| **SYNTHETIC** | persons, suspect/victim links, repeat offenders, org-crime networks | "synthetic / demo" | No |

## 6. Tech stack (LOCKED)

- **Frontend:** React 18 + Vite · React Router · **TanStack Query** (server cache) · **Zustand** (client state) · **React-Leaflet + Leaflet** (+ leaflet.heat) for maps · **Apache ECharts** (echarts-for-react) for charts/heatmaps · **react-force-graph** for networks · **Tailwind + shadcn/ui + lucide-react** · **TanStack Table** for grids · jsPDF/html2canvas (report export).
- **Backend:** **Node + Express** on Catalyst Advanced I/O Function (thin serving layer). `zcatalyst-sdk-node` (Data Store/Cache/Auth) · `zod` (validation) · `helmet`/`cors`/`express-rate-limit` (security). Jest + Supertest (test).
- **ETL/ML (offline Python):** pandas + **DuckDB** (fast out-of-core aggregation of the 1.67M-row file) · **geopandas/shapely/pyproj/rtree** · **rapidfuzz** + local GeoNames/station gazetteer for geocoding (no cloud API) · **scikit-learn** (DBSCAN/KDE/IsolationForest) · **Prophet** primary + **statsmodels** SARIMA fallback (forecasting) · **LightGBM** (risk + case-outcome) · **hdbscan** (MO clusters) · **NetworkX + python-louvain + mlxtend** (graph + association rules) · **Faker** + custom generator (labelled synthetic layer). pytest (test).
- **Storage:** Catalyst Data Store (ZCQL) + bundled CSV fallback.
- **Deliberately avoided:** deep-learning forecasters, GNNs, heavyweight SDV, cloud AI — higher risk / slower to tune for marginal gain; classical tools give more reliable results under datathon time.

## 7. Non-functional requirements

- **Resilience:** CSV fallback on every read; API returns a structured error envelope, never a 500 page.
- **Performance:** compact precomputed tables; simplified GeoJSON (0.21 MB) for maps; cached endpoints.
- **Security:** API Gateway + function-level middleware (headers, CORS, rate limit, request IDs); role-based auth; no secrets in code.
- **Observability:** request IDs + audit logging of API calls.
- **CI/CD:** Catalyst Pipelines from the repo.

## 8. How the sub-docs fit

- **`Backend_architecture.md`** — the Data Store schema (from the ER diagram), `crime_api` routes, ETL internals, fallback + caching.
- **`Frontend_architecture.md`** — SPA structure, the 8 workspaces, map/chart/graph stack, API client, labelling system.
- **`Models_application.md`** — each of the 6 models + 2 modules, plus the modeled time-of-day and synthetic-network methods and their honesty guardrails.
- **`plan.md`** — the phased build order that assembles all of the above.
