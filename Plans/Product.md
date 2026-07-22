# Product.md — Crime Intelligence & Analytical Platform

> The product definition: what we're building, who it's for, the features, what makes it win, and the pitch.
> Technical detail lives in the architecture docs; this is the "why and what."

---

## 1. Vision

Turn Karnataka's crime records from **static spreadsheets** into a **living intelligence hub** — where SCRB can *see* where and when crime concentrates, *understand* the socio-economic "why" behind it, *anticipate* emerging risks, and *act* proactively, all from one interactive platform on Zoho Catalyst.

## 2. The problem (from the challenge brief)

- **Data silos & manual processes** — records live in disconnected Excel sheets.
- **No advanced analytics** — behavioral patterns and networks go undiscovered.
- **Information gaps** — SCRB gets fragmented, delayed pictures.
- **Reactive, not proactive** — no systematic early-warning for emerging trends.

## 3. Who it's for (personas)

| Persona | Needs | Key screens |
|---|---|---|
| **SCRB analyst** | explore patterns, build reports | Dashboard, Patterns, Trends |
| **District supervisor** | monitor their jurisdiction, deploy resources | Hotspot Map, Risk, Alerts |
| **Investigator** | link cases, spot MO/associations | Network, MO Clusters |
| **Policymaker** | strategic view, socio-economic context | Socio-Economic, Strategic Hub |

## 4. Solution overview — 8 workspaces

The platform is organized into workspaces, each mapping to the six required capabilities:

1. **Dashboard** — state KPIs, district drill-down, headline trends. *(Cap 1)*
2. **Hotspot Map** — district → police-station → grid-cell hotspots on interactive maps; layers for volume, category, and *modeled* time-of-day. *(Cap 1, 4)*
3. **Patterns & MO** — crime-type / MO clustering, recurring incident profiles, seasonality. *(Cap 4, 5)*
4. **Trends & Forecast** — per district × crime-type forecasts + **emerging-trend red-zone alerts** (spike vs historical baseline). *(Cap 1, 3, 6)*
5. **Risk & Vulnerability** — predictive area-level risk scores; high-risk zones. *(Cap 3, 6)*
6. **Socio-Economic** — crime overlaid with Census urbanization/population/literacy; correlation view — the "why behind the where." *(Cap 3)*
7. **Network & Link Analysis** — node-graph of relationships. Two clearly-separated modes: **Entity network (real)** — crime-type/location/unit/section co-occurrence; **Person network (synthetic, labelled)** — suspects, repeat offenders, associations, organized-crime structures. *(Cap 2, 5)*
8. **Strategic Intelligence Hub / Ask** — unified prediction + anomaly + risk command view; optional natural-language "ask the data" + exportable intelligence report. *(Cap 3, 6)*

## 5. Standout differentiators ("wow")

- **Real statewide incident data** (1.67M FIRs, 2016–2024) — not a toy or aggregate-only dataset.
- **Police-station-accurate maps** — FIRs pinned to real KGIS station coordinates (921 stations), not just district blobs.
- **Case-outcome intelligence** — conviction/detection-rate analytics from `FIR_Stage` (most teams ignore this).
- **Depth of ML** — real forecasting (Prophet/SARIMA), density-based hotspots (DBSCAN/KDE), Isolation-Forest anomalies, HDBSCAN MO clustering — beyond the z-score/linear-trend baselines seen elsewhere.
- **Honesty as a feature** — every panel is tagged **Real / Modeled / Synthetic**. Judges and officers can trust exactly what they're looking at.
- **Privacy-ready ingestion** — an anonymization layer designed so real SCRB person data could plug in safely later (turns our biggest data limitation into a maturity story).

## 6. Trust & ethics stance (a product pillar, not a footnote)

- **Three clearly-labelled data planes:**
  - **Real** — everything derived from the FIR/census data.
  - **Modeled** — the constructed time-of-day profile (labelled "estimated, not observed").
  - **Synthetic** — the person-relationship network (labelled "synthetic / demonstration").
- **No protected attributes** (caste, religion, sex, occupation) as model features — ever.
- **Aggregate-only** socio-economic analysis; no individual profiling.
- A **fairness / data-quality audit** view is part of the product, acknowledging predictive-policing bias risk.

## 7. Competitive edge (vs the 4 reference projects we studied)

- **P2** (a full Catalyst build of this same challenge) → we adopt its architecture skeleton but **out-build its analytics** (it uses 3-month linear forecasts, z-score hotspots, kNN risk; we go deeper) and we're **more honest** about real vs synthetic.
- **P4** (2024 datathon *winner*, "Data Privacy") → we adopt its anonymization idea as our privacy-ready differentiator.
- **P1 / P3** → we borrow their best UI ideas (temporal heatmap + peak callout; "nearest cluster → deployment plan") and drop their weak/again-fairness-risky models.

## 8. Success criteria (what "done and winning" looks like)

- All 6 capabilities demoable, each visibly labelled Real/Modeled/Synthetic.
- Statewide coverage (all 31 districts) with station-level drill-down.
- Every model has a validation number (backtest error, cluster quality, detection metric).
- Runs on Catalyst end-to-end; never hard-fails (CSV fallback).
- A clear, defensible answer to "is this real data?" for every screen.

## 9. Pitch narrative (one paragraph)

> Karnataka generates over a million FIRs a year, today locked in spreadsheets. Our platform ingests 1.67M real FIRs (2016–2024), pins them to real police-station locations, and turns them into a live intelligence hub: district-to-station hotspot maps, emerging-trend red-zone alerts, forecasts and risk scores, MO clustering, and case-outcome analytics — overlaid with Census socio-economics to explain the "why." Where the law rightly withholds personal data, we're transparent: time-of-day is a clearly-labelled model, and suspect networks run on clearly-labelled synthetic data built to real distributions — with an anonymization layer ready to accept real SCRB records the moment they're authorized. Built on Zoho Catalyst, honest by design, and proactive by default.
