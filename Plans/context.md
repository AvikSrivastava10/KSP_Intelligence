# context.md — Project Handoff (read this first)

> **Purpose:** give any new chat session (or teammate) the *complete* picture of this project in one read —
> the goal, the data reality, the decisions already made, what's done, and what's next. If you're picking
> this up fresh, read this file top-to-bottom, then skim the sibling docs in `Plans/`.
>
> The canonical, always-current source of truth is `.kiro/steering/project-brief.md` (auto-loaded every session).
> This file mirrors it in a narrative form. **Last updated: 2026-07-17.**

---

## 1. What we're building

An **AI-driven Crime Intelligence & Analytical Platform** for the **Karnataka State Police (KSP) / State Crime Records Bureau (SCRB)**, for the **Hack2Skill Datathon 2026**. It replaces siloed, Excel-based crime reporting with:
interactive geospatial dashboards, spatiotemporal hotspots, network/link analysis, socio-economic correlation, and AI/ML prediction — moving SCRB from **reactive** reporting to **proactive** intelligence.

- **Deployment target:** **Zoho Catalyst** (confirmed).
- **Quality bar:** precise, well-planned, no fabricated data presented as real. Every model validated.

## 2. The 6 required capabilities (from the problem statement)

1. **Advanced Visualization** — district→station drill-down maps, spatiotemporal hotspots, emerging-trend/red-zone alerts.
2. **Criminological Network & Link Analysis** — relationship mapping, repeat-offender tracking, association detection.
3. **Sociological & AI Predictive Dashboards** — socio-economic correlation, predictive risk scoring, anomaly detection.
4. **Pattern & Trend Discovery** — statistical spatial/temporal hotspots.
5. **Network & Behavioral Analysis** — organized-crime networks, recurring Modus Operandi (MO).
6. **AI/ML-Driven Intelligence** — hidden correlations, anomalies, predict emerging risks.

## 3. The data reality (crucial — read carefully)

**What we actually have** (in `datasets/`):

| File | What it is | Use |
|---|---|---|
| `FIR_Details_Data.csv` | **1,674,734 real FIRs, 2016–2024, 41 units, 34 cols** (546 MB) | The backbone. Incident-level. |
| `CRIME_REVIEW_2021_TO_2024_KARNATAKA.csv` | State-level monthly counts by crime type + **motive** | Motive dimension + trend validation |
| `ka-district-wise-2025.csv` | 2025 district totals (IPC/BNS vs SLL) | 2025 recency + cross-check |
| `Police_FIR_ER_Diagram.pdf` | **Official KSP DB schema** (~27 tables). *No data, no links.* | The **target Data Store schema** |

The FIR CSV is the **only real incident data**, and it is a **de-identified, denormalized extract**: its person columns are **aggregate counts only** (`Male/Female/Boy/Girl`, `VICTIM COUNT`, `Accused Count`, `Arrested…`) — the ER source has full person tables (Victim/Accused/Complainant with names, and even caste/religion), but those are **confidential under Indian law and unavailable to any team**.

**External reference data** (in `datasets/external/`, all acquired + verified):
- `boundaries/` — 2011 DataMeet India districts (WGS84, census codes) **+ 2021 KGIS Karnataka districts reprojected to GeoJSON** (`karnataka_districts_2021_kgis.geojson` full-res + `.simplified.geojson` 0.21 MB web layer, 31 districts incl. Vijayanagara).
- `census/` — Census 2011 PCA (all-India state+district, 94 cols) + KA district population/SC-ST.
- `geonames/` — `IN.txt` (659,977 places; Karnataka = admin1 `19`) for geocoding.
- `police_stations/` — KGIS KML, **921 stations with names + coordinates** (pin FIRs to real station coords).
- `lgd/` — LGD district/subdistrict/village codes (SpreadsheetML).
- `ipc_bns_crosswalk.csv` — IPC 1860 ↔ BNS 2023 section mapping.

## 4. Hard constraints + the two key workarounds

**Constraints (do not fight):**
1. **No person-level identities** — confidential in India. Only aggregate counts exist.
2. **No time-of-day** in the CSV (only Year/Month/Day).
3. **No narrative text** (`BriefFacts` exists in the source schema, not in our extract).
4. **~70% of rows lack coordinates** (only 30.3% filled).
5. **2024 is partial** (~42k rows) — exclude from YoY/forecast baselines.

**The two decisions that turn constraints into designed features:**

- **(A) Time-of-day → CONSTRUCTED (modeled), clearly labelled.** We can't recover the real clock time, so we build a **modeled time-of-day profile per crime type**: grounded in *real* signal where present (`CrimeHead_Name` already encodes day/night, e.g. "BURGLARY - NIGHT" / "BURGLARY - DAY") and criminological priors for the rest. It powers the "time × location" spatiotemporal hotspot view, always labelled **"estimated, not observed."**
- **(B) Person relationships → SYNTHETIC, clearly labelled.** Suspect/victim/offender networks, repeat-offender tracking, and association detection use a **synthetic person-relationship layer**, generated to match the *real* aggregate counts and marginals (crime mix, district distribution). It lives in a **separate data plane**, is **never used for real analytics or model training**, and is **always UI-labelled "synthetic / demonstration."**

**Guardrail:** never present fabricated data as real. The two synthetic layers above are explicitly labelled everywhere.

## 5. Feasibility summary

- ✅ **Real-data capabilities:** district/station maps, spatial hotspots, trend + emerging-spike alerts, forecasting, anomaly detection, area risk scoring, MO/incident clustering, case-outcome analytics, socio-economic correlation.
- 🟡 **Modeled (labelled):** time-of-day spatiotemporal hotspots (constructed time layer).
- 🟡 **Synthetic (labelled):** person networks, repeat-offender tracking, association/organized-crime detection.
- ➕ **Real entity network (bonus, on real data):** co-occurrence graph of crime-type ↔ location ↔ unit ↔ legal-section (an honest, real complement to the synthetic person network).

## 6. Model plan (6 models + 2 modules) — see `Models_application.md`

1. Spatiotemporal hotspot (KDE + DBSCAN/ST-DBSCAN)
2. Forecasting + spike alerts (Prophet/SARIMA, per district×crime-type)
3. Risk scoring (gradient-boosted, area-level)
4. Anomaly detection (Isolation Forest / statistical)
5. MO / incident-profile clustering (HDBSCAN/K-means)
6. Case-outcome / detection-rate (supervised on `FIR_Stage`) — our differentiator
- Module A: Graph co-occurrence & association (NetworkX + Louvain + FP-Growth) — real entities + synthetic person layer
- Module B: Socio-economic correlation (Census join + regression)
- (+) Optional privacy/anonymization layer (from reference project P4) — "plug in real SCRB person data safely."

## 7. Architecture at a glance — see `Complete_architecture.md`

```
React + Vite SPA (Catalyst Web Hosting)
  → API Gateway → crime_api (Catalyst Advanced I/O Function)
      → Catalyst Data Store (ZCQL)  ── CSV fallback (never hard-fail)
  ingest_cron (Cron) · event_handler (Signals) · Pipelines (CI/CD)
ETL (Python): stream the 546 MB FIR → compact, API-ready aggregate tables
Data Store schema modelled on the official ER diagram (the subset we can populate)
Two clearly-separated data planes: REAL (analytics) and SYNTHETIC (network demo)
```

## 8. Current status

- ✅ Data understood, verified, cleaned-of-fakes (`karnataka_model_ready.csv` was synthetic → discarded).
- ✅ FIR file recovered to full 1.67M rows (an Excel save had truncated it to 1.05M — **never open big CSVs in Excel**).
- ✅ All external data acquired, verified, organized; 2021 boundaries reprojected to web-ready GeoJSON.
- ✅ 4 reference projects mined (see `Product.md` / brief §9); learnings captured. Zips kept, extraction deleted.
- ⏳ **Build not started yet.** Next is the ETL + Catalyst scaffold.

## 9. Immediate next steps

1. Build the **canonical district dimension** (name ↔ census code ↔ LGD code ↔ KGIS code) — the common join key.
2. Build the **data cleaning + ingestion ETL** (reconstruct surrogate `CaseMasterID`, split `ActSection`→Act/Section, reference tables, geocode via police-station coords + GeoNames, 2024 partial flag, district-name standardization).
3. Stand up the **Catalyst Data Store schema** (from the ER diagram; populated vs designed-only tables).
4. Then models, then frontend. Full sequence in `plan.md`.

## 10. Where things live

```
KSP_Intelligence/
├── .kiro/steering/project-brief.md   ← canonical source of truth (auto-loads)
├── datasets/                          ← real data + external/ reference data
├── external_projects/                 ← 4 reference-project zips (P2 = build skeleton, P4 = privacy)
├── etl/                               ← PYTHON offline data pipeline → etl/out/ (Phase 0)
├── ml/                                ← PYTHON offline model training → ml/out/ (Phase 3+)
├── functions/crime_api/               ← BACKEND: Node/Express Catalyst function (Phase 1)
├── client/                            ← FRONTEND: React + Vite SPA (Phase 1+)
├── requirements.txt · .gitignore · README.md
└── Plans/                             ← planning docs
    ├── context.md            ← you are here (handoff)
    ├── README.md             ← entry point / index
    ├── Product.md            ← what we're building + for whom + pitch
    ├── Complete_architecture.md  ← end-to-end system design
    ├── Backend_architecture.md   ← Catalyst functions, DataStore, API, ETL
    ├── Frontend_architecture.md  ← React SPA, workspaces, maps, charts
    ├── Models_application.md     ← the 6 models + 2 modules + synthetic layers
    ├── plan.md               ← phased build roadmap + tasks
    └── future_Ideas.md       ← (user-owned) stretch/parked ideas
```

## 11. Non-negotiable guardrails

- Never use protected attributes (caste, religion, sex, occupation) as model features.
- Socio-economic analysis stays **aggregate/area-level**, never individual profiling.
- Synthetic + modeled layers are **always labelled** and never presented as real or used to train real analytics.
- Special/non-geographic units (CID, Coastal Security, ISD, Railways) are bucketed separately from district maps.
- Predictive policing has feedback-loop bias risk → ship a fairness/data-quality audit view.
