# Frontend_architecture.md — React SPA

> The client: a React + Vite single-page app on Catalyst Web Client Hosting. Eight workspaces,
> interactive maps, charts, and network graphs — with a built-in Real / Modeled / Synthetic labelling system.

---

## 1. Stack (LOCKED)

- **React 18 + Vite** (fast build, static output for Catalyst hosting).
- **React Router** — one route per workspace.
- **Data/cache:** **TanStack Query** (dedupe, cache, loading/error) + **Zustand** (light client/filter state).
- **Maps:** **React-Leaflet + Leaflet** (+ `leaflet.heat`) — token-free, works with our WGS84 GeoJSON + 921 station points.
- **Charts:** **Apache ECharts** (`echarts-for-react`) — lines, bars, donuts, and especially **heatmaps + large series** with demo-grade polish (single powerful lib).
- **Network graph:** **react-force-graph** — interactive node-link for the entity (real) and person (synthetic) graphs.
- **UI/styling:** **Tailwind CSS + shadcn/ui + lucide-react**; **TanStack Table** for data grids.
- **Report export:** **client-side** — print stylesheet + html2canvas/jsPDF. Dependency-light, no server service. (Catalyst SmartBrowz only if we later want polished server-side PDFs.)
- *(Alternative noted: Mantine as a batteries-included component kit if we want to assemble dashboards faster.)*

## 2. App structure

```
client/src/
├── main.jsx / App.jsx            ← router + layout shell
├── api/
│   ├── client.js                 ← fetch wrapper, {ok,result} unwrap, request IDs
│   └── endpoints.js              ← typed endpoint helpers
├── components/
│   ├── layout/ (Sidebar, TopBar, WorkspaceFrame)
│   ├── DataClassBadge.jsx        ← Real / Modeled / Synthetic tag (see §5)
│   ├── maps/ (DistrictChoropleth, StationLayer, HotspotHeat, MapControls)
│   ├── charts/ (TrendLine, TemporalHeatmap, CategoryBar, DonutTop, KpiCard)
│   ├── network/ (ForceGraph, NetworkModeToggle)
│   └── filters/ (DistrictFilter, CategoryFilter, YearFilter)  ← cached, shared
├── workspaces/
│   ├── Dashboard.jsx
│   ├── HotspotMap.jsx
│   ├── PatternsMO.jsx
│   ├── TrendsForecast.jsx
│   ├── RiskVulnerability.jsx
│   ├── SocioEconomic.jsx
│   ├── NetworkAnalysis.jsx
│   └── StrategicHub.jsx
├── state/ (filters store, auth/role context)
└── styles/
```

## 3. The 8 workspaces (→ endpoints)

| Workspace | Key visuals | Reads |
|---|---|---|
| **Dashboard** | KPI cards, district choropleth, headline trend | `/overview`, `/districts`, `/trends` |
| **Hotspot Map** | district→station→grid drill-down; heat layer; **modeled time-of-day** layer | `/hotspots`, `/timeofday` |
| **Patterns & MO** | MO cluster explorer, seasonality, **Day-of-week × Month heatmap + peak callout** (from P1) | `/patterns/*` |
| **Trends & Forecast** | forecast lines + confidence band; **red-zone spike alerts** | `/trends`, `/forecast`, `/alerts` |
| **Risk & Vulnerability** | risk-scored choropleth/grid; ranked high-risk zones; "nearest cluster → deployment plan" (from P3) | `/risk`, `/vulnerable` |
| **Socio-Economic** | crime vs Census scatter/overlay, correlation coefficients | `/socio` |
| **Network & Link** | force-directed graph; **toggle: Entity (real) ↔ Person (synthetic)** | `/network/entity`, `/network/persons` |
| **Strategic Hub / Ask** | unified risk+anomaly+forecast; report export; optional NLQ | `/anomalies`, `/risk`, `/forecast`, `/report` |

## 4. Map layers (our prepared data)

- **District choropleth** → `karnataka_districts_2021_kgis.simplified.geojson` (0.21 MB — instant load); join crime metrics on `district` / `kgis_code`.
- **Station layer** → 921 KGIS police stations (name + coords) as points/clusters; drill-down target.
- **Hotspot heat** → `agg_hotspots` grid cells (from real coords + geocoded fallback); each point carries `geo_precision` so we can visually distinguish precise vs centroid-approximated.
- Full-res GeoJSON kept server-side for any precise point-in-polygon needs.

## 5. The labelling system (honesty as UI)

Every data response carries a **`data_class`** (`real` | `modeled` | `synthetic`). A shared `<DataClassBadge>` renders on every panel:
- **Real** — neutral/green, no caveat.
- **Modeled** — amber "Estimated time-of-day — modeled from crime-type profiles, not observed."
- **Synthetic** — purple "Synthetic demonstration data — not real persons."

The Network workspace defaults to the **Entity (real)** graph and requires an explicit toggle into **Person (synthetic)** mode, which shows a persistent synthetic banner. This makes the real/synthetic boundary impossible to miss (for judges and officers alike).

## 6. State & data flow

- **Filter state** (district, category, year, time-bucket) lives in a small global store; workspaces subscribe.
- **API client** unwraps `{ok, result}`, surfaces `{ok:false, error}` as a toast, attaches/echoes `request_id`.
- **Query cache** dedupes and caches responses (endpoints are already cached server-side too).
- **Auth/role context** gates workspaces/actions by persona (analyst/supervisor/investigator/policymaker).

## 7. Non-functional

- **Performance:** simplified GeoJSON, precomputed API tables, lazy-loaded workspace routes, memoized charts.
- **Resilience:** graceful empty/error states (the API never hard-fails; the UI mirrors that).
- **Accessibility:** semantic markup, keyboard-navigable controls, color choices that don't rely on hue alone (pair color with labels/icons — important for the Real/Modeled/Synthetic tags).
- **Responsive:** desktop-first (SCRB command use) with sensible tablet layout.

## 8. Build & deploy

- `vite build` → static assets → **Catalyst Web Client Hosting**.
- API base URL from env (Catalyst API Gateway path `/server/crime_api` in prod, proxy in local dev).
- Deployed via Catalyst Pipelines alongside the functions.
