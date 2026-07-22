# KSP Crime Intelligence & Analytical Platform

AI-driven crime analytics platform for the Karnataka State Police / SCRB — Hack2Skill Datathon 2026, deployed on **Zoho Catalyst**.

> **Source of truth:** `.kiro/steering/project-brief.md` (auto-loads). Full docs in `Plans/`.

## Repository layout

```
KSP_Intelligence/
├── .kiro/                 Steering brief (project source of truth)
├── Plans/                 Planning docs (architecture, product, models, roadmap)
├── datasets/              Raw data (FIR, crime review, 2025) + external/ reference data
├── external_projects/     Reference-project zips (studied; P2 = skeleton, P4 = privacy)
│
├── etl/                   PYTHON — offline data pipeline (clean/reconstruct/geocode → tables)
├── ml/                    PYTHON — offline model training (reads etl/out → model tables)
├── functions/
│   └── crime_api/         BACKEND — Node/Express Catalyst Advanced I/O Function (REST API)
├── client/                FRONTEND — React 18 + Vite SPA (Catalyst Web Client Hosting)
│
├── requirements.txt       Python deps (etl + ml)
└── .gitignore
```

## How it fits together

```
etl/  +  ml/   (offline Python, build step)
   └── produce compact result tables (CSV/JSON)
          └── loaded into Catalyst Data Store  (+ bundled as CSV fallback in functions/crime_api/src/data)
                 └── functions/crime_api  (Node API)  reads & serves  {ok, result}
                        └── client  (React SPA)  renders maps / charts / networks
```

Deployed on Catalyst: **Functions** (crime_api) + **Web Client Hosting** (client build) + **Data Store**. Models run offline and only their outputs are deployed — the live site never runs ML at request time. See `Plans/Complete_architecture.md`.
