# plan.md — Phased Build Roadmap

> How we assemble the platform, in order. Each phase ends in a **demoable increment** and is built
> test-first where practical. Data prep is already done (see `context.md` §8); this is the build.

---

## Guiding approach

- **Data → backend → models → frontend**, but sliced so each phase shows something on screen.
- **Precompute-first:** offline Python ETL/models produce compact tables; the API just serves them.
- **Reproducible & honest:** scripted end-to-end; Real/Modeled/Synthetic labelled throughout.
- Reuse **P2's** Catalyst skeleton + streaming-ETL pattern; build our **deeper models** on top.

---

## Phase 0 — Data foundation  *(prerequisite for everything)*
**Goal:** clean, enriched, API-ready tables + schema.
- [ ] Canonical **district dimension** (name ↔ census ↔ LGD ↔ KGIS codes) + name-standardization map (Bagalkote/Kalaburgi/Kolara/Bengaluru variants; separate CID/Coastal/ISD/Railways).
- [ ] **ETL pipeline** (Python, streaming): clean → reconstruct (surrogate `case_id`, `ActSection`→act/section, reference tables, rank from IOName) → geocode (station coords → GeoNames → district centroid, tag `geo_precision`) → **construct modeled time-of-day** → temporal features → **flag 2024 partial**.
- [ ] **Aggregate tables**: `agg_hotspots`, `agg_unit`, `agg_district_month`, `agg_outcomes`, `agg_socioeconomic`, `entity_edges` + `meta.json`.
- [ ] **Catalyst Data Store schema** (from ER diagram: populated / synthetic / designed-only) + loader + CSV fallback bundle.
- **Milestone:** query any district's cleaned metrics from the Data Store (and CSV fallback). Row counts reconcile to 1,674,734.

## Phase 1 — Backend skeleton + Dashboard
**Goal:** live API + first screen.
- [ ] Scaffold Catalyst project (`crime_api` Advanced I/O fn, web client, `catalyst.json`, pipelines).
- [ ] `{ok,result}` envelope + security middleware + cache + storage-agnostic reader + `data_class` tagging.
- [ ] Endpoints: `/overview`, `/districts`, `/district/:id`, `/meta`, `/health`.
- [ ] React+Vite shell (router, layout, filters, `DataClassBadge`) + **Dashboard** workspace (KPIs, district choropleth via simplified GeoJSON, headline trend).
- **Milestone:** deployed SPA showing real statewide KPIs + district drill-down.

## Phase 2 — Geospatial intelligence
**Goal:** the map story.
- [ ] Model 1 **Hotspots** (KDE + DBSCAN) → `agg_hotspots`; `/hotspots` endpoint.
- [ ] **Hotspot Map** workspace: district→station→grid drill-down; heat layer; 921-station layer; `geo_precision` styling.
- [ ] **Modeled time-of-day** layer + `/timeofday` (labelled).
- **Milestone:** interactive hotspot map to station level + labelled time×location view.

## Phase 3 — Predictive dashboards
**Goal:** proactive intelligence.
- [ ] Model 2 **Forecast + spike alerts** (Prophet/SARIMA) → `forecasts`, `alerts`.
- [ ] Model 3 **Risk scoring** → `risk_scores`. Model 4 **Anomaly** → `anomalies`.
- [ ] **Trends & Forecast** + **Risk & Vulnerability** workspaces (incl. "nearest cluster → deployment plan"), red-zone alerts.
- **Milestone:** forecasts with backtest error shown, risk choropleth, anomaly call-outs.

## Phase 4 — Patterns, MO & outcomes
**Goal:** discovery + the differentiator.
- [ ] Model 5 **MO clustering** (HDBSCAN) → `mo_clusters`. Model 6 **Case-outcome** → `agg_outcomes`.
- [ ] **Patterns & MO** workspace (cluster explorer, Day×Month heatmap + peak callout); outcome analytics on Dashboard/Hub.
- **Milestone:** MO clusters + conviction/detection-rate analytics per district.

## Phase 5 — Network & socio-economic
**Goal:** link analysis (honest) + the "why."
- [ ] Module A **Entity co-occurrence graph** (real) + association rules → `entity_edges`, `/network/entity`.
- [ ] **Synthetic person layer** generation → `syn_*`, `/network/persons` (labelled, separate plane).
- [ ] Module B **Socio-economic** correlation → `agg_socioeconomic`, `/socio`.
- [ ] **Network & Link** (Entity↔Person toggle + synthetic banner) + **Socio-Economic** workspaces.
- **Milestone:** real entity network + clearly-labelled synthetic person network + socio-economic overlay.

## Phase 6 — Strategic Hub, report, fairness, polish
- [ ] **Strategic Hub** (unified risk+anomaly+forecast) + **report export** + optional NLQ/"Ask".
- [ ] **Fairness / data-quality audit** view (coverage gaps, 30% coord fill, 2024 partial, reported-not-truth caveat).
- [ ] Model-card panels (validation numbers), empty/error states, accessibility pass.
- **Milestone:** all 6 capabilities demoable, each labelled Real/Modeled/Synthetic.

## Phase 7 — Deploy & demo
- [ ] Catalyst Pipelines CI/CD; auth roles; cache warm; `ingest_cron` + `event_handler` wired.
- [ ] End-to-end smoke test; demo script + pitch (see `Product.md` §9).
- **Milestone:** live on Catalyst, resilient (CSV fallback), demo-ready.

---

## Dependencies (critical path)
`Phase 0 (data)` → everything. Maps need Phase 0 geocoding. Forecast/risk/anomaly need `agg_district_month`. Network-real needs `entity_edges`; network-synthetic needs the synthetic generator. Socio needs the census join + canonical district dimension.

## Risk register
| Risk | Mitigation |
|---|---|
| Coordinates only 30% | station-centroid + GeoNames geocoding; `geo_precision` flag; honest labelling |
| 2024 partial skews trends | exclude from training; flag in UI |
| Synthetic misread as real | separate data plane + persistent labels + `data_class` on every payload |
| Big-file mishandling | scripted streaming ETL only; **never open in Excel** |
| Node vs Python function runtime undecided | doesn't block Phase 0; decide before Phase 1 |
| Catalyst service limits/quotas | precompute + cache + CSV fallback keep runtime light |

## Definition of done (per model/feature)
Runs from the scripted pipeline · has a validation number · output table loads via Data Store *and* CSV fallback · surfaced in a workspace with the correct Real/Modeled/Synthetic label.
