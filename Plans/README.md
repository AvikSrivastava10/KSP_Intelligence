# KSP Crime Intelligence & Analytical Platform

AI-driven crime analytics & visualization platform for the **Karnataka State Police (KSP) / SCRB**,
built for the **Hack2Skill Datathon 2026**, deployed on **Zoho Catalyst**.

> **Status:** Planning complete, data prepped & verified — **build not yet started.**
> **Source of truth:** `.kiro/steering/project-brief.md` (auto-loads each session).
> **New here? Read `Plans/context.md` first.**

---

## What this is

Replaces siloed, Excel-based crime reporting with an interactive platform: district→station geospatial
hotspots, emerging-trend alerts, forecasting, risk scoring, anomaly detection, MO clustering, case-outcome
analytics, socio-economic correlation, and network/link analysis — moving SCRB from reactive to proactive.

Built on **1,674,734 real FIRs (2016–2024)** plus official external data. Where data is legally or
technically unavailable, we're transparent: **time-of-day is a labelled model**, and **person networks use
labelled synthetic data** — with real SCRB data able to plug in later.

## Repository structure

```
KSP_Intelligence/
├── .kiro/steering/project-brief.md   ← canonical, always-current source of truth
├── datasets/
│   ├── FIR_Details_Data.csv          ← backbone: 1.67M FIRs (546 MB — never open in Excel)
│   ├── CRIME_REVIEW_2021_TO_2024_KARNATAKA.csv
│   ├── ka-district-wise-2025.csv
│   ├── Police_FIR_ER_Diagram.pdf     ← official KSP schema (= Data Store target)
│   └── external/                     ← reference data (all acquired + verified)
│       ├── boundaries/  (2011 DataMeet + 2021 KGIS GeoJSON: full + simplified web layer)
│       ├── census/      (Census 2011 PCA + KA population)
│       ├── geonames/    (IN.txt — geocoding)
│       ├── police_stations/  (KGIS KML — 921 stations w/ coords)
│       ├── lgd/         (district/subdistrict/village codes)
│       └── ipc_bns_crosswalk.csv
├── external_projects/                ← 4 reference-project zips (P2 = skeleton, P4 = privacy)
└── Plans/                            ← planning docs (this folder)
```

## Planning docs — reading order

| # | Doc | Contents |
|---|---|---|
| 1 | **`context.md`** | Full project handoff — read this first |
| 2 | **`Product.md`** | What we're building, for whom, features, pitch |
| 3 | **`Complete_architecture.md`** | End-to-end system design |
| 4 | **`Backend_architecture.md`** | Catalyst functions, Data Store schema, API, ETL |
| 5 | **`Frontend_architecture.md`** | React SPA, 8 workspaces, maps, charts |
| 6 | **`Models_application.md`** | 6 models + 2 modules + synthetic/modeled layers + fairness |
| 7 | **`plan.md`** | Phased build roadmap (Phase 0–7) + tasks + risks |

## Quick facts

- **Data:** 1.67M FIRs, 2016–2024 (2024 partial), 41 units; coords ~30% (geocoded to fill); person data is aggregate counts only.
- **Capabilities:** 6 (visualization, network/link, predictive dashboards, pattern discovery, behavioral/MO, AI/ML intelligence).
- **Models:** 6 (hotspot, forecast+alerts, risk, anomaly, MO clustering, case-outcome) + 2 modules (graph, socio-economic).
- **Stack:** React+Vite SPA · Catalyst Advanced I/O Function (`crime_api`) · Data Store (+CSV fallback) · Python ETL/ML · Cron/Signals/Pipelines.
- **Two labelled data layers:** MODELED time-of-day, SYNTHETIC person network.

## Guardrails

- Never present fabricated data as real — Real / Modeled / Synthetic labelled everywhere.
- No protected attributes (caste, religion, sex, occupation) as model features.
- Socio-economic analysis aggregate/area-level only; ships with a fairness/data-quality audit.
- Big CSVs: pandas/DuckDB only — **never Excel** (it silently truncates at 1,048,576 rows).

## Running it (once built — see `plan.md`)

- **ETL/models (Python, offline):** stream FIR → compact tables + model outputs → load to Data Store (+ CSV fallback). Deps already used: pandas, pyshp, pyproj, shapely, pdfplumber; to add: duckdb, geopandas, rapidfuzz, scikit-learn, prophet, statsmodels, lightgbm, hdbscan, networkx, python-louvain, mlxtend, faker.
- **Backend:** Node + Express (`zcatalyst-sdk-node`, zod, helmet) — thin serving layer.
- **App:** Catalyst CLI to deploy `crime_api` + the React (Vite) build; CI/CD via Catalyst Pipelines.

*(Detailed setup lands with Phase 1 of `plan.md`.)*
