# ml/ — Offline model training (Python)

Reads the compact tables from `etl/out/`, trains/computes the models, and writes **result tables** to `ml/out/`.
Runs as an offline build step; the live site serves the precomputed outputs (no request-time inference).

## Models (see `Plans/Models_application.md`)
- `hotspots.py`   — KDE + DBSCAN/ST-DBSCAN → hotspot cells/clusters
- `forecast.py`   — Prophet (+ statsmodels SARIMA fallback) per district×category + spike alerts
- `risk.py`       — LightGBM area-level risk scoring
- `anomaly.py`    — IsolationForest + statistical residuals
- `mo_clustering.py` — HDBSCAN incident-profile clusters
- `outcomes.py`   — LightGBM case-outcome / detection-rate on `FIR_Stage`
- `graph.py`      — NetworkX + Louvain + FP-Growth (entity co-occurrence) [+ synthetic person graph]
- `socioeconomic.py` — Census join + correlation/regression
- `synthetic.py`  — labelled synthetic person/relationship layer (separate data plane)

## Outputs → `ml/out/`
`forecasts.csv`, `risk_scores.csv`, `anomalies.csv`, `mo_clusters.csv`, `entity_edges.csv`, `agg_socioeconomic.csv`, `syn_*.csv`, each with a `data_class` (real/modeled/synthetic).

## Guardrails
No protected attributes (caste/religion/sex/occupation) as features. Modeled/synthetic outputs always labelled. Every model reports a validation number.
