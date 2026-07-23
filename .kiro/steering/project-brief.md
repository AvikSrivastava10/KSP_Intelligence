# KSP Crime Intelligence Platform — Project Brief & Working Memory

> **Purpose:** single source of truth for this project. Captures the goal, all decisions,
> the data situation, constraints, the model plan, learnings, and the live backlog so
> nothing gets lost between sessions. **Keep this updated as things change.**
>
> **Last updated:** 2026-07-22
> **Status:** Phase 3 (Predictive Dashboards) COMPLETE — offline forecasting (Holt-Winters, statewide backtest MAPE 14.3%), emerging-trend alerts (121 red-zones), LightGBM risk scoring (Spearman 0.837, fairness-safe features), and anomaly detection (IsolationForest, 80% injected recall); 6 new API endpoints (/forecast, /forecast/options, /alerts, /risk, /risk/:id, /anomalies) and two React workspaces (Trends & Forecast, Risk & Vulnerability). 17/17 API tests pass; runs on CSV fallback. (Phase 2 Hotspot Map also complete.) Next: Phase 4 (Patterns/MO + case-outcome) or remaining phases.

---

## 1. Project overview

- **What:** An AI-driven Crime Intelligence & Analytical Platform for the **Karnataka State Police (KSP) / State Crime Records Bureau (SCRB)**.
- **Why:** Replace siloed, Excel-based crime reporting with interactive dashboards, geospatial hotspot maps, network/link analysis, and AI/ML prediction — moving SCRB from reactive to proactive.
- **Context:** Hack2Skill **Datathon 2026** challenge.
- **Deployment target:** **Zoho Catalyst** (confirmed).
- **Quality bar (user's words):** precise, well-planned, no mistakes, no unverified/fabricated data.

### The 6 required capabilities
1. Advanced Visualization (district drill-down maps, spatiotemporal hotspots, emerging-trend alerts)
2. Criminological Network & Link Analysis (relationship mapping, repeat-offender tracking, association detection)
3. Sociological & AI Predictive Dashboards (socio-economic correlation, risk scoring, anomaly detection)
4. Pattern & Trend Discovery (statistical spatial/temporal hotspots)
5. Network & Behavioral Analysis (organized-crime networks, recurring MO)
6. AI/ML-Driven Intelligence (hidden correlations, anomalies, predict emerging risks)

---

## 2. Tech stack decisions

| Area | Decision | Status |
|---|---|---|
| Deployment | Zoho Catalyst | ✅ confirmed |
| ETL / ML | Python | ✅ (stdlib streaming for big file; sklearn/Prophet etc. for models) |
| Frontend | **React 18 + Vite** · TanStack Query · Zustand · React-Leaflet · **ECharts** · react-force-graph · Tailwind+shadcn/ui | ✅ confirmed |
| Backend functions | **Node + Express** (Catalyst Advanced I/O) · zcatalyst-sdk-node · zod · helmet | ✅ confirmed (Node; Python does ML offline) |
| ETL / ML libs | pandas+**DuckDB** · geopandas/shapely/pyproj · scikit-learn · **Prophet**+statsmodels · **LightGBM** · hdbscan · NetworkX+louvain+mlxtend · Faker | ✅ confirmed |
| DB | Catalyst Data Store (ZCQL) + CSV fallback | ⏳ planned |

---

## 3. Data inventory (what we actually have)

Located in `datasets/`.

### 3.1 FIR_Details_Data.csv — THE backbone (real, incident-level)
- **1,674,734 rows**, **2016–2024** (2024 partial ~42k), **41 units** (37 districts/city-commissionerates + 4 special: CID, Coastal Security, ISD Bengaluru, Karnataka Railways).
- Source: Kaggle `vanshangaria/fir-details-karnataka-police` (self-sourced, NOT given by KSP).
- **546 MB. NEVER open in Excel/Sheets** — it truncates at 1,048,576 rows (this already happened once and cost 626,159 rows / half the districts; re-downloaded full). Use pandas/DuckDB only.
- **34 columns:** District_Name, UnitName, FIR_YEAR, FIR_MONTH, Offence_Duration, FIR_Day, FIR Type (=gravity: Heinous/Non-Heinous), FIR_Stage (=case status), Complaint_Mode, CrimeGroup_Name (major head), CrimeHead_Name (sub head), Latitude, Longitude, ActSection (free text), IOName, KGID, Internal_IO, Place of Offence, Distance from PS, Beat_Name, Village_Area_Name, Male, Female, Boy, Girl, Age 0, VICTIM COUNT, Accused Count, Arrested Male, Arrested Female, "Arrested Count\tNo." (tab in header), Accused_ChargeSheeted Count, Conviction Count, Unit_ID.
- **Coordinates only ~30.3% filled** (508k rows).
- Person data is **aggregate counts only** (no identities) — these counts are the de-identified projection of the source Victim/Accused tables.
- Quirks: UTF-8 BOM; tab in one header; leading spaces / casing in categories; free-text distance; district name variants (Vijayapur vs Vijayapura, Mysuru City/Dist).

### 3.2 CRIME_REVIEW_2021_TO_2024_KARNATAKA.csv
- 30,956 rows. **State-level monthly** counts by ACT (IPC/SLL) → MAJOR HEAD (crime type) → **MINOR HEAD (motive)** + 4 comparison columns (current/prev month, same month last yr, YTD) + Month + Year.
- **Unique value: motive dimension** (absent from FIR and from the ER schema). State-level only, no district.

### 3.3 ka-district-wise-2025.csv
- 47 rows. **2025** district totals: IPC/BNS Crimes vs SLL Crimes, grouped by Range/Commissionerate (header rows blank).
- **Unique value: 2025 recency** (extends past FIR's 2016–2024) + validation cross-check.

### 3.4 karnataka_model_ready.csv — ⛔ DISCARD (synthetic)
- 152 rows (38 districts × 2020–2023). **Proven fabricated:** 2022 = exactly 2×2020 and 2023 = exactly 2×2021 for all 38 districts; cyber/other crime = 0 in every odd year. Do not use.

### 3.5 Police_FIR_ER_Diagram.pdf — official KSP schema (the only KSP-provided artifact)
- ~27-table normalized ER schema (Word 2010 export, 2026-06-10, "Confidential").
- **Contains NO data / no download link / no source** — it's a database DESIGN document = the **target schema / contract** for our Catalyst Data Store.
- Reveals the source system DOES have (but our CSV lacks): person tables (Complainant/Victim/Accused w/ name, age, gender, **caste/religion/occupation**), **BriefFacts** narrative text, **IncidentFromDate DATETIME** (time-of-day), Court, Chargesheet, full reference tables, `Inv_OccuranceTime`.
- Note: even the full schema has **no cross-case person key** (AccusedMasterID is per-case; PersonID is A1/A2 within-case) — so repeat-offender tracking would need fuzzy matching even with full access.

---

## 4. Hard constraints (do not fight these)

1. **No person-level data — ever.** Victim/Accused/Complainant identities are confidential under Indian law. Not obtainable by any team. Only aggregate counts exist in our data.
2. **No time-of-day** in the CSV (only Y/M/D). Source has it (`IncidentFromDate`) — see Bucket 3.
3. **No narrative text** in the CSV. Source has `BriefFacts` — see Bucket 3.
4. **~70% of rows lack coordinates** — needs geocoding/centroid fallback.
5. **2024 is partial** — exclude from YoY/forecast training baselines.

---

## 5. Capability feasibility (given the constraints)

- ✅ **Fully feasible:** district drill-down maps, spatial hotspots, emerging-trend/spike alerts, forecasting, anomaly detection, risk scoring, MO/pattern clustering, case-outcome analytics, socio-economic correlation.
- 🔄 **Reframe (entity-level, not persons):** "network & link analysis" → co-occurrence graph of crime-type ↔ location ↔ unit ↔ legal-section. "Association detection" → association-rule mining on incident attributes.
- ❌ **Descope (state why — legal/data limits):** repeat-offender tracking, suspect↔victim person networks, time-of-day hotspots (unless time obtained), NLP/narrative MO (no text).

---

## 6. Model plan — 6 models + 2 modules

| # | Model | Technique | Powers |
|---|---|---|---|
| 1 | Spatiotemporal hotspot | KDE + DBSCAN/ST-DBSCAN | hotspots, spatial clusters |
| 2 | Forecasting + spike alerts | Prophet / SARIMA per district×crime-type | trends, emerging alerts |
| 3 | Risk scoring | gradient-boosted classifier/regressor | predictive risk dashboards |
| 4 | Anomaly detection | Isolation Forest / statistical | anomaly call-outs |
| 5 | MO / incident-profile clustering | HDBSCAN/K-means | pattern & MO discovery |
| 6 | Case-outcome / detection-rate | supervised on FIR_Stage | "hidden correlations" (our differentiator) |
| + | Graph co-occurrence & association | NetworkX + Louvain + Apriori/FP-Growth | entity link analysis |
| + | Socio-economic correlation | Census join + correlation/regression | "why behind the where" |
| (+) | **Privacy/anonymization layer** | Presidio-style pseudonymization (from P4) | "plug in SCRB person data safely" — pitch differentiator |

---

## 7. Gap-coverage strategy (4 buckets)

- **Bucket 1 — Reconstruct (free, from existing data):** surrogate `CaseMasterID`; parse `ActSection` → Act/Section tables; build CrimeHead/District/Unit/Status/Gravity reference tables; derive Employee/Rank from `IOName`+`KGID`; temporal features (day-of-week/month/season).
- **Bucket 2 — Enrich (real external data):** geocode missing coords (GeoNames/OSM + PS centroid fallback); Census/SHRUG socio-economic join; district GeoJSON; police-station list.
- **Bucket 3 — Request from organizers (non-PII, exists in source):** time-of-day (`IncidentFromDate`), `BriefFacts` narrative.
- **Bucket 4 — Descope or clearly-labelled demo:** person-level features. Optional: synthetic person layer for network-graph DEMO only, generated to match real aggregate counts, always labelled, never used for analytics/training. **DECISION PENDING (user wary of synthetic).**

**Guardrail:** never fabricate data and present it as real.

---

## 8. External data requirements — `datasets/external/`

Filing scheme: `boundaries/ · census/ · geonames/ · police_stations/ · lgd/`

| Item | Purpose | Source | Status |
|---|---|---|---|
| District boundaries — TWO sets | maps/choropleth | DataMeet 2011 + KGIS 2021 | ✅ **2011 DataMeet** in `external/boundaries/india_districts_2011_datameet/` (641 India/30 KA, **WGS84 lat/long**, has census codes → joins Census PCA). ✅ **2021 KGIS** in `external/District/` (**31 KA districts incl. Vijayanagara + Bengaluru South**, high-res, fields KGISDistri + LGD_Distri → aligns w/ KGIS police KML + LGD files). ⚠️ **2021 set is UTM Zone 43N — MUST reproject to EPSG:4326 (lat/long)** before web use. ✅ DONE: reprojected → `boundaries/karnataka_districts_2021_kgis.geojson` (full-res 8.9MB, source of truth) + `.simplified.geojson` (0.21MB, 97% fewer vertices — the web map layer). Raw shapefile kept at `external/District/`. Name variants to normalize (Kalaburgi/Bagalkote/Kolara). |
| Census 2011 PCA + KA population | socio-economic correlation + per-capita | data.gov.in (DDW PCA) | ✅ **in `external/census/`** — `DDW_PCA0000_2011_Indiastatedist.csv` (all-India state+district, 94 cols, Level=India/STATE/DISTRICT, TRU=Total/Rural/Urban; has pop, literacy, SC/ST, sex ratio, workers) + `DistricWisePoplnTWD.csv` (KA-only pop + SC/ST). Joins to boundaries via 2011 census codes. 2011 vintage (30 KA districts). Name standardization needed (Bangalore→Bengaluru etc.). |
| GeoNames `IN` dump | geocode missing coords | download.geonames.org | ✅ **in `external/geonames/`** — `IN.txt` (659,977 places; KA = admin1 `19`, ~39k places) + readme. For fuzzy geocoding Village/Place names. |
| Police-station list (+coords) | unit standardization, PS-centroid fallback, station-level maps | KGIS | ✅ **in `external/police_stations/` (KML)** — KGIS `ka_ps_locs`: **921 stations** with `POL_STAName` + coords + KGIS codes. Pin FIRs to station coords via UnitName match. |
| LGD district/taluk/village codes | canonical joins, village geocoding | lgdirectory.gov.in | ✅ **in `external/lgd/`** — districts/subdistricts/villages as **SpreadsheetML XML** (not binary xls — parse via ElementTree/lxml). Villages file 34MB = all KA villages. |
| IPC↔BNS crosswalk | legal dimension, 2024 transition | public | ✅ **in `external/ipc_bns_crosswalk.csv`** — official BNS 2023 ↔ IPC 1860 corresponding-section table (cols: PDF_Page, BNS_2023, IPC_1860, Status[New/Change/Deleted], Cross_Check). Needs cleaning (drop chapter/definition header rows; parse section numbers from text cells). Bridges FIR IPC (2016–24) ↔ 2025 BNS file. |
| Karnataka holiday calendar | explain temporal spikes | `holidays` pkg | ⏳ optional |

---

## 9. Learnings from the 4 reference projects (`external_projects/_extracted/`)

| Project | Take (best thing) | Leave / build better |
|---|---|---|
| **P1 Rakshakanetra** (Streamlit, Boston data) | Chart patterns: temporal heatmap + peak-callout (adapt to Day×Month), hotspot heat layer, cached filters | Weak RF model; Mongo/Boston layer; Streamlit (we go React) |
| **P2 karnataka-crime-intelligence-platform** (full Catalyst app — our exact challenge) | **Architecture skeleton** + `etl/fir_incidents.py` streaming→compact-tables (fuzzy headers, KA bbox, grid aggregation); {ok,result} API + security + cache + DataStore/CSV fallback; 8-workspace IA; honest real-vs-synthetic separation | Shallow analytics (3-mo linear forecast, z-score hotspots/anomalies, kNN risk); synthetic hourly/network; no MO clustering; no outcome model |
| **P3 police_rescue** (Flask) | "Nearest cluster → deployment plan with actionable suggestions" (proactive resource deployment) | LR on age+**sex**+city (fairness red flag); baked-in pkls; static HTML maps; hardcoded creds |
| **P4 KSP_24** (2024 datathon WINNER, "Data Privacy") | **PII anonymization engine** (reversible consistent placeholders, hashing, de-anon map) + FIR/Crime-No regex + OCR → our privacy differentiator | Azure AI (use Catalyst Zia); heavy custom NER (we lack narrative text) |

**Strategy:** P2 = architectural skeleton, P4 = privacy differentiator, P1/P3 = specific features, **our ML depth = where we out-build all four.**

---

## 10. Target architecture (from P2 + our improvements)

```
React+Vite SPA (Catalyst Web Hosting)
   → API Gateway → crime_api (Advanced I/O Function)
        → Catalyst Data Store (ZCQL)  ── CSV fallback (never hard-fail)
   ingest_cron (Cron) · event_handler (Signals) · Pipelines (CI/CD)
ETL (Python): stream FIR 546MB → compact API-ready tables
DataStore schema modelled on the official ER diagram (subset we can populate)
```

---

## 11. Fairness / ethics guardrails

- **Never** use protected attributes (caste, religion, sex, occupation) as model features.
- Socio-economic correlation stays **aggregate/area-level**, not individual profiling.
- Predictive-policing carries feedback-loop bias risk → include a fairness/data-quality audit.
- Any synthetic data must be **clearly labelled** and never presented as real.
- Special/non-geographic units (CID, Coastal Security, ISD, Railways) bucketed separately from district maps.

---

## 12. BACKLOG — outstanding tasks & open decisions

### Immediate next steps
- [x] Reprojected 2021 KGIS districts → WGS84 GeoJSON in `boundaries/` (full-res 8.9MB + simplified 0.21MB web layer). Verified: bbox matches Karnataka extent.
- [x] **Canonical district dimension** built → `etl/out/dim_district.csv` (41 FIR units → 31 KGIS polygons; 4 non-geographic units flagged; commissionerates → parent). Cross-validated vs KGIS/census/LGD (0 errors). Code: `etl/common/districts.py` + `etl/build_dim_district.py`.
- [x] **Data cleaning + ingestion pipeline** built → `etl/ingest_fir.py` (streaming, reconciles to 1,674,734; BOM/tab fixes, surrogate `case_id`, `ActSection`→act/section, reference dims, rank from `IOName`, transfer-status collapse, geocoding w/ `geo_precision`, modeled time-of-day, temporal features, `is_2024_partial`).
- [x] **Catalyst Data Store schema** designed → `etl/schema.md` (modelled on the ER diagram: REAL / MODELED / SYNTHETIC / designed-only planes) + `etl/load_datastore.py` dry-run stub.
- [x] Adapted P2's `fir_incidents.py` streaming pattern into our deeper `etl/ingest_fir.py`.
- [x] **Phase 1 COMPLETE:** `crime_api` (Node/Express, CSV-fallback + Data Store reader) + React Dashboard (KPIs + district choropleth joined on `kgis_code` + drill-down + yearly trend) run locally; `catalyst.json` + `load_datastore.py` (idempotent REST loader + `datastore_schema.json`) ready. App works on bundled CSV with zero Catalyst services.
- [x] **Phase 2 COMPLETE:** Hotspot Map — offline KDE+DBSCAN model (`ml/hotspots.py`, 467 clusters, silhouette 0.492, district-centroid artifact excluded) → `ml/out/hotspot_cells`+`hotspot_clusters`; 4 geo endpoints (`/hotspots`, `/hotspots/clusters`, `/stations`, `/timeofday`=modeled); React Hotspot Map workspace (choropleth + heat + clusters + station markers + precision legend + district→station drill-down + modeled time-of-day). 9/9 tests pass; `vite build` OK.
- [x] **Phase 3 COMPLETE:** predictive dashboards — `ml/forecast.py` (Holt-Winters, 199 series, backtest MAPE 14.3%), `ml/alerts.py` (121 red-zones vs 2021-22 baseline), `ml/risk.py` (LightGBM, Spearman 0.837, fairness-safe: no caste/religion/sex), `ml/anomaly.py` (IsolationForest, 80% injected recall); 6 API endpoints + 2 React workspaces (Trends & Forecast, Risk & Vulnerability); 17/17 tests; `vite build` OK.
- [ ] **Phase 4 (next):** Patterns/MO clustering (HDBSCAN) + case-outcome / detection-rate model; then network (Phase 5), hub, deploy.
- [ ] **Deploy (user step):** `catalyst login` → `catalyst init` (link project) → `cd client && npm run build` → `catalyst deploy`. Optional: create Data Store tables from `etl/out/datastore_schema.json`, run `python etl/load_datastore.py --load` (needs Zoho OAuth env), set function env `USE_DATASTORE=true`.

### Pending external data (user gathering)
- [x] Core external data COMPLETE: boundaries ✅ · census ✅ · GeoNames ✅ · police stations ✅ · LGD ✅.
- [x] IPC↔BNS crosswalk ✅ · 2021 KGIS district boundaries ✅ (both added).
- [ ] Optional remaining: taluk/sub-district polygons; holidays (`holidays` pkg — no file needed).

### Open decisions
- [x] **Bucket 4 → YES:** build a **clearly-labelled synthetic** person/relationship layer (suspects, victims, co-offending, repeat offenders, networks) — matched to real aggregate counts, separate data plane, never used for real analytics/training, always UI-labelled.
- [x] **Time-of-day → CONSTRUCT:** modeled per-crime-type profile (real day/night signal from `CrimeHead_Name` + criminological priors), labelled "estimated, not observed". (No longer blocking on an organizer request.)
- [x] **Tech stack LOCKED:** Node+Express API · Python ML (offline) · React+Vite+ECharts+React-Leaflet frontend · Catalyst Data Store+CSV fallback. (Full framework list in §2 and `Plans/`.)
- [x] **Phase 0 (data foundation) COMPLETE** — green light to scaffold the Catalyst project skeleton in Phase 1.

### Housekeeping
- [x] `external_projects/_extracted/` deleted (fully mined; learnings in §9; re-extractable from the 4 zips). Empty `external/IN/` leftover also removed.

---

## 13. Decisions log

- **2026-07-17** — Datathon uses self-sourced Kaggle FIR data; KSP provided only the ER diagram (schema, no data). ER diagram = target Data Store schema.
- **2026-07-17** — `karnataka_model_ready.csv` confirmed synthetic → discarded.
- **2026-07-17** — FIR file re-downloaded to full 1,674,734 rows after Excel truncation; rule: never open big CSVs in Excel.
- **2026-07-17** — Person-level analysis descoped (Indian confidentiality law); network capability reframed to entity co-occurrence; person-network to be demoed only via labelled synthetic if approved.
- **2026-07-17** — Model portfolio set at 6 models + 2 modules (+ optional privacy layer).
- **2026-07-17** — Reference projects analyzed; P2 architecture + P4 anonymization adopted as key learnings.
- **2026-07-17** — DataMeet district boundaries downloaded, verified, organized into `external/boundaries/`.
- **2026-07-17** — Census 2011 socio-economic data acquired (DDW PCA all-India state+district + KA district population/SC-ST), filed in `external/census/`; joins to district boundaries via 2011 census codes.
- **2026-07-17** — Acquired GeoNames IN (659,977 places, KA=admin1 19), KGIS police-station KML (921 stations w/ names+coords), and LGD Karnataka district/subdistrict/village files (SpreadsheetML). **Core external data now complete** (boundaries, census, geocoding, stations, LGD). Police KML enables pinning FIRs to real station coords — best fix for the 70% missing-coordinates gap.
- **2026-07-17** — Added IPC↔BNS crosswalk (`external/ipc_bns_crosswalk.csv`, official corresponding-section table) and 2021 KGIS Karnataka district boundaries (`external/District/`, 31 districts incl. Vijayanagara). KGIS set is UTM Zone 43N → must reproject to EPSG:4326 for web maps; will become primary map layer. KGIS boundaries + KGIS police KML + LGD codes form a coherent joinable geospatial set.
- **2026-07-17** — Reprojected 2021 KGIS district shapefile UTM43N→WGS84 and exported GeoJSON (full-res 8.9MB + simplified 0.21MB, 97.4% vertex reduction) into `external/boundaries/`. Reprojection verified (lon/lat bbox 74.09–78.59E, 11.60–18.48N = Karnataka). Simplified file is the web map layer; per-feature simplify may leave hairline shared-border gaps at deep zoom (use TopoJSON later if pixel-perfect borders needed).
- **2026-07-17** — Cleanup: deleted `external_projects/_extracted/` (~100MB, fully mined, re-extractable from zips) and the empty `external/IN/` leftover. Kept the 4 reference zips (P2 = build skeleton, P4 = privacy reference). All real data + brief untouched.
- **2026-07-17** — Two decisions locked: (A) **time-of-day will be CONSTRUCTED** as a clearly-labelled modeled per-crime-type profile (real day/night signal from CrimeHead + criminological priors) since it can't be recovered; (B) **person-relationship networks will use clearly-labelled SYNTHETIC data** (Bucket 4 approved) matched to real aggregate counts, kept in a separate data plane, never used for real analytics/training. Both surfaced in the Plans docs. Filled the 8 `Plans/*.md` planning documents.
- **2026-07-17** — Tech stack finalized. **Backend = Node + Express** on Catalyst Advanced I/O (thin serving layer; models run offline in Python). **Python ML/ETL** = pandas+DuckDB, geopandas/shapely/pyproj, scikit-learn, Prophet(+statsmodels), LightGBM, hdbscan, NetworkX+louvain+mlxtend, Faker (synthetic). **Frontend** = React 18+Vite, TanStack Query, Zustand, React-Leaflet(+leaflet.heat), Apache ECharts, react-force-graph, Tailwind+shadcn/ui, TanStack Table. Geocoding via local GeoNames+station gazetteer + rapidfuzz (no cloud API). Deliberately avoiding DL/GNN/SDV/cloud-AI for reliability under time. Plans docs updated.
- **2026-07-17** — Received the official Catalyst services↔capability table (deployment on Catalyst mandatory; using a 3rd-party alt where a Catalyst service exists may affect validity). Adoption decided (~17 services): CORE = Functions(Node API), Web Client Hosting, Data Store(+full-text search), API Gateway, Cache, Cron, Signals+Event, Authentication, Pipelines. ADOPTED = **Zia AutoML** (tabular models: risk + case-outcome, replacing LightGBM for those two), **AppSail Docker/Python** (host custom ETL + specialized models on Catalyst), **Mail+Push** (emerging-trend alerts), **SmartBrowz** (PDF reports, replacing jsPDF), **Stratus** (object storage). WOW = **QuickML LLM+RAG** (Ask-Intelligence assistant), **Zia OCR** (scanned FIRs), **Zia Voice+Translation** (voice + EN↔Kannada). PARKED (future_Ideas) = Circuits, Domain Mappings, NoSQL. SKIP = Connections. Custom Python (KDE/DBSCAN, Prophet, HDBSCAN, NetworkX, association rules) justified: no Catalyst equivalent → hosted on AppSail. Frontend viz libs (ECharts/Leaflet/force-graph) have no Catalyst equivalent. Docs updated: Complete_architecture §3, Models §0+#3+#6, Backend §1b, Frontend report-export.
- **2026-07-17** — **Reversed the heavy Catalyst-services adoption** (user priority: minimize dependencies, build ourselves unless a service is clearly best; more services = more time/risk). **Core Catalyst services now just 3:** Functions (Node API), Web Client Hosting, Data Store. We build the rest ourselves: all models + ETL as an **offline Python build step** (incl. tabular risk/case-outcome via **LightGBM**, NOT Zia AutoML); alerts = in-app visual; report = client-side; static assets bundled; no AppSail/Mail/Push/SmartBrowz/Stratus/Cron/Signals/QuickML in core. Optional easy adds: Auth, API Gateway, Cache, Pipelines. Everything dropped is parked in `future_Ideas.md`. Accepted the stated "third-party may affect validity" tradeoff for speed/control; Zia AutoML (tabular) noted as the one service to reconsider if hedging. Docs updated (Complete_architecture §3, Backend §1/§1b, Models §0/#3/#6, Frontend report, future_Ideas).
- **2026-07-17** — Scaffolded the monorepo folder architecture: `etl/` (+out/, common/), `ml/` (+out/), `functions/crime_api/src/{routes,lib,data}`, `client/src/{api,components,workspaces,state,styles}` + public/, plus root `README.md`, `.gitignore`, `requirements.txt`. Each app folder has a README pointing to its Plans spec. Empty subfolders hold `.gitkeep`. Phase 0 session fills `etl/`; Phase 1 fills `functions/crime_api` + `client`. (Folder layout mirrored into `Plans/context.md` §10.)
- **2026-07-17** — Repo is **code-only**: entire `datasets/` and `external_projects/` are gitignored (data kept local; sourcing documented in §8). Committed = code (etl/ ml/ functions/ client/), Plans/, .kiro/steering, requirements.txt.
- **2026-07-22** — **PHASE 0 (data foundation) COMPLETE.** Built the offline Python ETL in `etl/` (helpers in `etl/common/`, outputs in `etl/out/`), runs end-to-end in ~40s and **reconciles exactly to 1,674,734 rows**. Key outcomes:
  - **Canonical district dimension** (`dim_district.csv`, 41 rows): hand-verified override map (`etl/common/districts.py`) mapping the 41 FIR units → 31 KGIS polygons; 4 non-geographic units (CID, Coastal Security, ISD, Karnataka Railways) flagged `is_geographic=false`; city commissionerates → parent district (share KGIS/census/LGD codes). Cross-validated vs 2021 KGIS + 2011 census SHP + LGD table (0 errors; expected fuzzy warnings: Ramanagara↔"Bengaluru South" 2024 rename, Kalaburagi↔"Gulbarga" 2011 name). LGD lgd↔census2011 pairing verified clean.
  - **Streaming ingest** (`ingest_fir.py`): chunked (never Excel), UTF-8-BOM + tab-header (`Arrested Count\tNo.`) fixes, categorical trim, deterministic surrogate `case_id`, `ActSection`→`dim_act`(4831)/`dim_section`(17465), reference dims (`dim_crime_head` 107, `dim_crime_subhead` 626, `dim_case_status` 13 with the ~300 `Transfered :UI(...)` variants collapsed → `Transferred`, `dim_gravity` 2, `dim_rank` 21 from `IOName` suffix, `dim_complaint_mode` 10).
  - **Geocoding** (multi-tier, tagged `geo_precision`): real point 29.92% → **99.54% after** (point 501,075 / KGIS-station 1,014,580 / GeoNames place 20,276 / district-centroid 131,146 / none 7,657 = the non-geographic specials). 875/1071 distinct units matched to KGIS station coords (name + district-census disambiguation + rapidfuzz).
  - **Modeled time-of-day** (`agg_timeofday.csv`, `data_class=modeled`): real day/night signal is in **`CrimeGroup_Name`** (`BURGLARY - NIGHT/DAY`) → `category_encoded`; else `criminological_prior`; else `default_distributed`. Illustrative only; never trains models.
  - **Aggregates:** `agg_district_month` (124,314 — forecasting base), `agg_hotspots` (142,048 — grid `(lat,lng,precision,year)`, kept compact ~3.5MB; per-cell category dropped, coarse category trend lives in `agg_district_month`), `agg_unit` (1,074 stations + mean coords), `agg_outcomes` (41 districts, rates), `agg_case_status` (514), `agg_socioeconomic` (30 — 2011 Census per-capita join; Vijayanagara folds into Ballari 565; specials excluded), `meta.json` (full provenance).
  - **Data-quality finds:** raw `VICTIM COUNT` column is **dead** (sum≈464 statewide) → `victims` computed from Male+Female+Boy+Girl (real; e.g. RAPE≈1.0, MURDER≈1.15/case) as a **total** (sex never a model feature — guardrail respected). Real points validated to KA bbox (501,075 vs 508,066 raw-filled; ~7k invalid/out-of-state dropped). Outcome rates can exceed 1 for the 4 specials (inconsistent source count cols) — kept raw/honest.
  - **Schema:** `etl/schema.md` defines the Catalyst Data Store on the official ER diagram (REAL populated / MODELED / SYNTHETIC-plane / designed-only person+narrative+time tables) + `load_datastore.py` dry-run stub. Case-level `case_master` materialization deferred to Phase 1.
  - Committed on `main` (code + `etl/out/` CSV/json per `.gitignore`, which excludes only parquet in out/). `Plans/future_Ideas.md` left untouched (user-owned).
- **2026-07-22 (addendum)** — After cross-checking the completed Phase 0 against all four `Plans/` spec docs: implementation matches the specs, with one deliberate correction — the modeled time-of-day **real day/night signal is in `CrimeGroup_Name`** (`BURGLARY - NIGHT/DAY`), NOT `CrimeHead_Name` as context.md §4 / Models §10a state (`CrimeHead_Name` has zero NIGHT/DAY values in the data); `timeofday.py` correctly reads `CrimeGroup_Name`. Also **added `entity_edges.csv`** (the one `plan.md` Phase 0 table initially deferred): REAL within-case co-occurrence graph — `crime_head↔act`, `act↔act`, `crime_head↔district` (4,558 edges after low-weight trim; e.g. accidents↔IPC+Motor-Vehicles-Act, THEFT/CYBER↔Bengaluru City). Feeds Phase 5 Module A. `etl/out/` now 18 tables / 10.1MB; reconciliation still exact (1,674,734). Committed + pushed to `main`.
- **2026-07-22** — **PHASE 1 (live web app) COMPLETE.** Built the Node/Express `crime_api` + React Dashboard; verified locally on the bundled CSV fallback (zero Catalyst services needed).
  - **Backend** (`functions/crime_api/`, Node 18 + Express): `src/lib/` = `{ok,data_class,result,request_id}` envelope, helmet+cors+rate-limit security, in-memory cache, and a **storage-agnostic reader** (`store.js`) that tries Catalyst Data Store (ZCQL, paginated) when `USE_DATASTORE=true` and falls back to the bundled CSVs otherwise. Own robust CSV parser (handles quoted commas). `src/routes/`: `/health`, `/meta` (serves meta.json), `/overview` (state KPIs — geographic units only, 2024 flagged), `/districts` (31 rows, joined to choropleth on `kgis_code`, `?per_capita`), `/district/:id` (drill-down; `id`=parent district, aggregates member units incl. city+district). Mounted at `/server/crime_api` (Catalyst) and `/` (local). Bundled `etl/out/*.csv`+`meta.json` → `src/data/`. Jest+Supertest: 5/5 pass. Verified: total_firs=1,674,734, 31 districts, conviction 0.2242, detection 0.8857, geocoded 99.54%.
  - **Frontend** (`client/`, React 18 + Vite + Tailwind): shell (React Router, Sidebar/TopBar layout, `DataClassBadge`, TanStack Query, Zustand filter store, envelope-unwrapping API client). **Dashboard**: 6 KPI cards, **React-Leaflet choropleth** (raw-count vs per-capita toggle, joined to `karnataka_districts.geojson` on `kgis_code`, click → drill-down), `DrillDownPanel` (outcome rates + monthly ECharts line + top-crime-head bars + top stations), yearly-trend ECharts (2024 amber/partial). `vite build` OK → `client/dist` (+ `client-package.json` + `404.html` for Catalyst web hosting). **Choropleth join verified: 31 API districts == 31 GeoJSON polygons, 0 mismatches.**
  - **Data Store loader** (`etl/load_datastore.py`): `--plan` (dry run) + `--schema` (emits `etl/out/datastore_schema.json`, authoritative table/column/types — kgis_code etc. as varchar) + `--load` (idempotent truncate+insert via Catalyst Data Store REST API, OAuth creds from env, batched). Catalyst has no public create-table API → tables made in console from the schema JSON; documented. App works on CSV until then.
  - **Deploy wiring:** root `catalyst.json` (functions target `crime_api` src `functions`; client src `client/dist`) + `functions/crime_api/catalyst-config.json` (advancedio, node18, `USE_DATASTORE=false` default). **Deployment is the user's step** (`catalyst login`/`init`/`deploy`) — not run here.
  - Committed on `main`. Bundled CSVs in `functions/crime_api/src/data/` are committed (fallback must deploy self-contained); `node_modules/` + `client/dist/` gitignored (build before deploy). `Plans/future_Ideas.md` untouched.
- **2026-07-22** — **PHASE 2 (Geospatial Intelligence / Hotspot Map) COMPLETE.** Offline model + 4 API endpoints + a React Hotspot Map workspace; verified locally on the CSV fallback.
  - **Accuracy guard enforced:** the 131,146 `district`-centroid incidents (all piled at district centres) are EXCLUDED from the point/heat/cluster layers — they'd render as fake hotspots. `ml/hotspots.py` filters to `point`+`station`+`place` and asserts no `district` leak; the API + a jest test both confirm it. District-centroid data stays on the aggregate choropleth only.
  - **`ml/hotspots.py`** (offline; reads `agg_hotspots.csv`+`agg_unit.csv`): Gaussian **KDE** density (BallTree, bw 2 km) + **weighted DBSCAN** (eps 3 km, min_samples 400 weighted, haversine). Outputs `ml/out/hotspot_cells.csv` (141,790 rows) + `hotspot_clusters.csv` (467 clusters, each with a plain-language **deployment_note**). Result: **467 clusters, silhouette 0.492, 90.4% of eligible incidents clustered**; top cluster Bengaluru Urban (402,838 FIRs, THEFT).
  - **API:** `/hotspots?year=&precision=` (heat cells, capped 25k, no district-centroid), `/hotspots/clusters?limit=` (summaries + deployment notes), `/stations?district=` (station points), `/timeofday?district=&category=` (**`data_class=modeled`**, "estimated not observed" note). Added `hotspot_cells`+`hotspot_clusters` to `datastore_schema.json` + `load_datastore.py` (its `csv_path` now falls back to `ml/out/`). **9/9 Jest+Supertest tests pass.**
  - **Frontend:** `client/src/workspaces/HotspotMap.jsx` — React-Leaflet with toggleable layers (choropleth base joined on `kgis_code` · `leaflet.heat` heat · DBSCAN cluster circles w/ deployment-note popups · station markers), precision filter + legend, year filter, **district→station drill-down** (flyTo), and a labelled **modeled time-of-day** ECharts panel with a persistent `DataClassBadge`. `HeatLayer.jsx` added; `leaflet.heat` installed; route `/hotspots` + sidebar nav enabled. `vite build` OK (2,272 modules).
  - Committed on `main`. `Plans/future_Ideas.md` untouched; `Plans/phase_wise_log.md` (local-only) updated with the Phase 2 section.
- **2026-07-22 (Phase 2 hotfix)** — Fixed hotspot heat bleeding into the Arabian Sea / neighbouring states. Two causes: (1) Phase-0 `geo.py` validates coords only to a loose KA bbox (`KA_LON=(73.8,78.9)`), letting some points sit offshore/out-of-state; (2) `leaflet.heat` radius/blur smeared ~60-70 km at zoom 7. Fix: added a **Karnataka land-polygon clip** in `ml/hotspots.py` (`clip_to_land()` — union of 31 KGIS district polygons, buffered ~3 km, point-in-polygon before KDE/DBSCAN) removing 1,648 cell-rows / 3,098 incidents; and tightened `HeatLayer.jsx` (radius 18→11, blur 22→12, minOpacity 0.28→0.2) + heat floor 0.06→0.03. Chose a real polygon test over a crude `lng≥74.6` cut (which would have deleted ~50k legit coastal FIRs — KA's west coast reaches ~74.1°E at Karwar). Verified: 140,142 cells (was 141,790), still 467 clusters/silhouette 0.492 (`hotspot_clusters.csv` unchanged — offshore cells were noise, not cores), zero cells west of 74.0, API returns 0 offshore cells. Re-ran the model, re-copied CSV to the API bundle, `vite build` OK. Committed on `main`. (Note: user's local `client/public/ksp-logo.png` swap 34KB→1.39MB left untouched/uncommitted — flagged as heavy.)
- **2026-07-22 (Phase 2 hotfix 2 + audit)** — Fixed "Hotspot heat layer on but shows nothing." Cause: the precision filter (point/station/place) could be fully unchecked → frontend sent `precision=__none__` → API matched nothing → blank heat, with the layer toggle still saying "on" (two controls gating visibility). Fix (frontend-only, `HotspotMap.jsx`): all-off now = no filter (show all real precisions, same as all-on); the UI keeps ≥1 precision checked (unchecking the last is a no-op); added an on-map empty-state hint + microcopy. Added a jest test for the precision filter (10/10 pass); `vite build` OK. Ran a wider Phase 0/1/2 audit — no other bugs/vulns/incompleteness found: ZCQL table names hardcoded (no injection), inputs safe-decoded, CORS origin-restricted + helmet + rate-limit, resilient CSV fallback, `/districts` returns mean coords for drill-down flyTo, HashRouter deep-links, all public assets present, data classes labelled. Committed on `main`.
- **2026-07-22** — Quality-bar decision: goal is **honest, per-model-appropriate metrics pushed as high as legitimately possible**, NOT a blanket >95% accuracy (which would signal leakage/overfitting on this data). Codified in `Plans/Models_application.md` §13: universal discipline (holdout, beat-a-baseline, mandatory leakage check), per-model targets (forecast MAPE ≤10% on high-volume series; risk AUC ≥0.80; anomaly ≥90% injected-recall; case-outcome multi-class 65–85% + a BINARY detected-vs-undetected headline in high-80s–90s), and the real headline numbers (100% row reconciliation, 99.54% geocoding). Every model ships a model card.
- **2026-07-22** — **PHASE 3 (Predictive Dashboards) COMPLETE.** Offline models in `ml/` → `ml/out/`, wired into `crime_api` (CSV fallback), two new React workspaces. Predictions are `data_class=real` (derived from real data) but presented as projections/flags in the UI.
  - **Forecasting** (`ml/forecast.py`): **Holt-Winters exponential smoothing** (statsmodels; additive trend+seasonality, period 12) with seasonal-naive fallback. **Prophet was NOT installed** — heavy/flaky on Windows under time pressure; the Phase-3 prompt explicitly sanctions the statsmodels/seasonal-naive fallback. Trains on 2016-2023 (partial 2024 excluded from training + displayed history). Bounded to 199 series (statewide, 31 districts, top-12 categories, district×top-5). 12-mo forecast + 95% CI → `forecasts.csv` (21,491 rows). **Backtest held-out 2023: statewide MAPE 14.3%, median 21.7%.**
  - **Alerts** (`ml/alerts.py`): 2023 vs **recent 2021-2022 baseline** per district×category (recent baseline avoids COVID-2020/21 inflation) → `alerts.csv` (**121 red-zones: 68 red, 53 amber**).
  - **Risk** (`ml/risk.py`): **LightGBM** regression on a district×year panel; validation Spearman ρ=**0.837** (held-out 2023). Final model predicts 2024 → 0-100 score + tier (Low/Moderate/High/Critical) + **SHAP drivers** (`pred_contrib`) → `risk_scores.csv` (31 districts). **FAIRNESS GUARDRAIL honoured:** features = lag totals/3-yr avg/trend/YoY/seasonal volatility/crime-type mix/population/prior per-capita — **no caste/religion/sex** (`sc_share`/`st_share`/`sex_ratio` excluded, reserved for Phase-5 correlation). A jest test asserts `/risk/:id` drivers never expose protected attributes.
  - **Anomaly** (`ml/anomaly.py`): **IsolationForest** on scale-free residual features (z + log-ratio) + z-rule, district×category monthly (2016-2023). Spike-focused (low-side = data-gap/COVID noise, excluded) → `anomalies.csv` (**134 spikes**). **Injected-spike recall 80%.**
  - **API:** `routes/predict.js` → `/forecast`, `/forecast/options`, `/alerts`, `/risk`, `/risk/:id`, `/anomalies`. 4 CSVs bundled to `src/data/`; `datastore_schema.json` now 23 tables; `forecasts` added to `store.js` CSV_ONLY. **17/17 Jest+Supertest tests pass.** Live spot-check on :9010 OK.
  - **Frontend:** `TrendsForecast.jsx` (scope selector → ECharts actual+dashed-forecast+CI band; alerts panel; red-zone choropleth) and `RiskVulnerability.jsx` (risk-tier choropleth + ranked list + SHAP-driver panel + anomaly call-outs). Routes `/trends` + `/risk`; sidebar nav enabled. `vite build` OK (2,274 modules).
  - Also this session (user UI requests, pre-Phase-3): brightened the KSP marching-photo watermark (lower scrim alpha), removed the dashboard hero border, and stripped onboarding/instructional microcopy ("Scroll to explore", "click to drill down", etc.) across the UI — and will avoid such instruction text going forward until asked.
  - Committed on `main`. `Plans/future_Ideas.md` untouched.
- **2026-07-22 (Phase 3 QA hardening)** — Full audit of Phase 3 (data-integration script + code review + security). No fakes/incomplete features found. Fixed: (1) API `/forecast` with `level=district|category` and no key now resolves to exactly one series (was returning all series concatenated → garbled chart if selector fired pre-load); added a jest test. (2) Anomaly detection gained a multiplicative-spike rule (≥2.5× seasonal expectation) → **injected recall 80%→91%** (415 spikes, all count>expected). (3) Risk score rescaled 0–100 → 8–100 (lowest district shows a small bar, not "0"; tiers unchanged). (4) Forecast CI band now defined at every point (no null-gap stacked-area edge cases); removed an unused import. Verified: all 31 risk/alert kgis join to the 31 GeoJSON polygons (0 gaps), every forecast series has exactly 12 projection points, 0 CI-ordering violations, 0 NaN/negatives; **18/18 jest tests pass**, `vite build` OK; inputs injection-safe (hardcoded ZCQL table names). Committed on `main`.
- **2026-07-22 (Phase 3 UX pass)** — Made the two Phase-3 pages understandable for non-technical viewers. Added a shared `InfoDot` (hover-explained term marker). **Trends & Forecast:** plain-language header; 4 headline KpiCards (projected next-12-mo, direction vs 2023 with up/down colour, busiest month ahead, active alerts); clearer chart legend (Actual (recorded) / Forecast (projected) / likely range) + a custom tooltip ("Projected X · likely A–B") + a y-axis label; an "In plain terms" summary sentence; alerts + red-zone map now explained in plain words. **Risk & Vulnerability:** plain-language header; 4 headline KpiCards (priority districts, projected FIRs, highest-risk district, anomalies flagged); tier chips with hover blurbs; risk index shown as /100 with an InfoDot explaining the 0–100 model score + fairness note; "Why it ranks here" drivers with a SHAP tooltip; anomalies labelled "×normal" with an explainer. Kept to descriptive/interpretive text (no "click/select" action-instructions, per the standing UI rule). `vite build` OK (2,275 modules). Committed on `main`.