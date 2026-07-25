# Models_application.md — ML Models, Modules & Data Layers

> The analytical brain: 6 ML models + 2 analytical modules, plus the two special data layers
> (constructed time-of-day, synthetic person-network). All training/inference runs **offline in Python**;
> outputs are written as compact tables the API serves. **No protected attributes are ever used as features.**

---

## 0. Serving model

Everything here runs **offline as a build-time Python pipeline** (locally), producing small result tables → Data Store (+ CSV fallback bundled with the function). The live Node API never trains or runs inference on request — it serves precomputed tables. Fast, reproducible, dependency-light.

- We **build all models ourselves in Python** (no Zia AutoML / QuickML) — including the two tabular ones (risk, case-outcome) — because we're already running a Python pipeline and need full control over features (fairness guardrails) and validation.
- The pipeline runs offline; only its *outputs* deploy. (If we ever want it running on Catalyst for live re-ingest, AppSail is the future home — see `future_Ideas.md`.)

Real feature inputs available from the FIR data: district, unit/police-station, `crime_registered_date` (Y/M/D), gravity, major head (`CrimeGroup_Name`), sub head (`CrimeHead_Name`), status (`FIR_Stage`), lat/long (30% + geocoded), aggregate counts (victims/accused/arrested/convicted/chargesheeted), Act/Section (parsed). Enrichment: Census socio-economics (district), temporal features (dow/month/season), constructed time-of-day (modeled).

**Libraries (LOCKED):** pandas + **DuckDB** (out-of-core aggregation of the 1.67M-row file); **geopandas/shapely/pyproj/rtree** (geospatial) + **rapidfuzz** with a local GeoNames/station gazetteer (geocoding, no cloud API); **scikit-learn** (DBSCAN, KDE, IsolationForest, K-means); **Prophet** primary + **statsmodels** SARIMA fallback (forecasting); **LightGBM** (risk scoring + case-outcome); **hdbscan** (MO clustering); **NetworkX + python-louvain + mlxtend/FP-Growth** (graph + association rules); **Faker** + custom generator (labelled synthetic layer). All pinned in `requirements.txt`; runs offline; outputs load to Data Store (+CSV fallback).

---

## 1. Spatiotemporal Hotspot  *(Caps 1, 4)*
- **Technique:** Kernel Density Estimation for heat surfaces + **DBSCAN / ST-DBSCAN** for cluster detection. Grid pre-aggregation (~1.1 km cells) for scale.
- **Inputs:** incident lat/long (real + geocoded, with `geo_precision`), crime category, date, **modeled time bucket** (for the time×location view).
- **Outputs:** `agg_hotspots` (cells + density), cluster polygons/centroids per category/period.
- **Validation:** cluster stability across periods; silhouette on the DBSCAN space; sanity vs known high-crime districts (Bengaluru City).
- **Note:** the time×location view uses the MODELED time layer → labelled "estimated."

## 2. Forecasting + Emerging-Trend Alerts  *(Caps 1, 3, 6)*
- **Technique:** **Prophet** (or SARIMA) per **district × crime-type** monthly series; STL for seasonality; spike detection = current vs seasonal baseline (z-score / prediction-interval breach).
- **Inputs:** `agg_district_month` (2016–2023 full; **exclude partial 2024** from training).
- **Outputs:** `forecasts` (next N months + CI), `alerts` (red-zone spikes).
- **Validation:** backtest MAPE/RMSE on held-out months; alert precision on injected/known spikes.

## 3. Risk Scoring  *(Caps 3, 6)*
- **Technique:** gradient-boosted classification/regression (**LightGBM**, our Python pipeline) producing an area-level risk score/tier.
- **Inputs (crime-relevant ONLY):** historical counts & trend, category mix, seasonality, spatial density, socio-economic *area* indicators (Census). **Never** individual protected attributes.
- **Outputs:** `risk_scores` per district/grid + tier; feeds the risk choropleth and "nearest cluster → deployment plan."
- **Validation:** calibration + ranking (AUC/Brier) against next-period actuals; **fairness audit** (see §11).

## 4. Anomaly Detection  *(Caps 3, 6)*
- **Technique:** **Isolation Forest** on area-time feature vectors + statistical residual checks (baseline breaks, spatial outliers).
- **Inputs:** district/category/time aggregates + engineered features.
- **Outputs:** `anomalies` (flagged area-time cells + score + reason).
- **Validation:** recall on injected anomalies; bounded false-positive rate.

## 5. MO / Incident-Profile Clustering  *(Caps 4, 5)*
- **Technique:** **HDBSCAN** (or K-means) on encoded incident profiles.
- **Inputs:** crime group/head, Act/Section combination, gravity, location type (beat/village), season, modeled time bucket.
- **Outputs:** `mo_clusters` (cluster id + profile summary per incident/area) → the Patterns & MO workspace.
- **Validation:** cluster quality (silhouette/DBCV); interpretability — clusters should map to recognizable MOs (e.g., night vehicle theft belt).

## 6. Case-Outcome / Detection-Rate  *(Cap 6 — our differentiator)*
- **Technique:** supervised classification on **`FIR_Stage`** (Convicted / Undetected / Pending / Charge-sheeted / False Case …) with **LightGBM** + arrest/conviction-rate analytics.
- **Inputs:** category, gravity, district, Act/Section, counts, temporal features.
- **Outputs:** `agg_outcomes` (rates per district), outcome-driver insights ("what correlates with detection?").
- **Validation:** classification metrics; rate reconciliation vs raw aggregates.
- **Why it matters:** none of the reference projects did this; it directly answers "hidden correlations."

---

## Module A — Graph Co-occurrence & Association  *(Caps 2, 5)*
Two clearly-separated graphs:
- **Entity network (REAL):** nodes = crime types, locations/units, legal sections; edges = co-occurrence within cases. **Louvain** community detection + centrality reveal structure honestly from real data. **Association-rule mining** (Apriori/FP-Growth) on incident attributes → "these categories/sections/areas co-occur."
- **Person network (SYNTHETIC, labelled):** the suspect/victim/repeat-offender/organized-crime graph — see §10.
- **Outputs:** `entity_edges` (real), `syn_offender_network` (synthetic). Served to separate UI modes.

## Module B — Socio-Economic Correlation  *(Cap 3)*
- **Technique:** join district crime rates to **Census 2011** indicators (population, urbanization %, literacy, SC/ST share, sex ratio); Pearson/Spearman + simple regression; **per-capita normalization** (fixes Bengaluru's raw-count dominance).
- **Inputs:** `agg_district_*` + `census/` PCA data (joined via the canonical district dimension).
- **Outputs:** `agg_socioeconomic` (rates + coefficients) → the Socio-Economic workspace.
- **Guardrail:** strictly **area-level**, never individual profiling; caste/religion never used as predictors.

---

## 10. Special data layers (the two decisions)

### 10a. Constructed time-of-day  — MODELED, labelled
- **Why:** the source has only Y/M/D; true clock time is unrecoverable.
- **Method:** assign each incident a time-of-day profile **conditioned on crime type**:
  1. **Real signal first** — `CrimeHead_Name` already encodes day/night for some heads (e.g. "BURGLARY - NIGHT" / "BURGLARY - DAY", "HOUSE BREAKING BY NIGHT"). Use it directly.
  2. **Criminological priors** for the rest — e.g. traffic accidents peak at commute hours, public-order/riots skew evening, residential burglary daytime, etc. Encoded as documented per-category distributions.
- **Output:** `modeled_time_of_day` bucket/distribution per incident; powers the time×location hotspot view.
- **Honesty:** always tagged `data_class = "modeled"`; UI reads "estimated time-of-day — modeled from crime-type profiles, not observed." **Not** used to train the real models; illustrative for the spatiotemporal view only.

### 10b. Synthetic person-relationship network — SYNTHETIC, labelled
- **Why:** person identities are legally unavailable; needed to *demonstrate* Caps 2 & 5.
- **Method:** generate synthetic persons/links **matched to real marginals** — accused/victim counts per case (from real count columns), demographic buckets, district/category distributions. Create a synthetic offender pool assigned across multiple cases to demonstrate **repeat-offender tracking, co-offending, association, and organized-crime clusters**; keep MO consistency (same synthetic offender → similar categories/areas).
- **Output:** `syn_person`, `syn_case_person`, `syn_offender_network` (separate data plane, `is_synthetic = true`).
- **Honesty:** `data_class = "synthetic"`; persistent UI banner; never mixed with real analytics; never used to train real models.

---

## 11. Fairness, ethics & validation

- **Protected attributes (caste, religion, sex, occupation) are never features.** Even though the ER source has them, they're absent from our data and stay out of models by design.
- **Socio-economic analysis is aggregate/area-level only** — no individual profiling.
- **Predictive-policing bias:** historical enforcement data can create feedback loops. We ship a **fairness / data-quality audit** view: coverage gaps (the 30% coord fill, 2024 partial), per-district data density, and a caveat that risk scores reflect *reported* crime, not ground truth.
- **Every model reports a validation number** (backtest error, cluster quality, classification metric) surfaced in a model-card panel.
- **Reproducibility:** training scripts are version-controlled and re-runnable end-to-end.

## 12. Model → capability → workspace map

| Model / module | Capabilities | Workspace |
|---|---|---|
| 1 Hotspot | 1, 4 | Hotspot Map, Patterns |
| 2 Forecast + alerts | 1, 3, 6 | Trends & Forecast, Dashboard |
| 3 Risk scoring | 3, 6 | Risk & Vulnerability |
| 4 Anomaly | 3, 6 | Strategic Hub |
| 5 MO clustering | 4, 5 | Patterns & MO |
| 6 Case-outcome | 6 | Dashboard, Strategic Hub |
| A Graph (real + synthetic) | 2, 5 | Network & Link |
| B Socio-economic | 3 | Socio-Economic |
| Time-of-day (modeled) | 1 | Hotspot Map |


---

## 13. Success metrics & quality targets (honest, per model)

**Principle:** push each model as high as it *legitimately* goes, measured by the metric that actually fits its type — never a blanket "accuracy %". Every model ships a **model card** (metric on held-out data, the baseline it beats, holdout method, leakage note). A panel of honest, correct metrics is more credible — and more defensible at judging — than one inflated number.

**Universal discipline (every supervised / forecast model):**
- **Proper holdout:** temporal split for forecasting; stratified CV for classification. Never evaluate on training data.
- **Beat a baseline (report skill/lift):** forecast vs seasonal-naive; classifier vs majority-class; risk vs "same as last period".
- **Leakage check (mandatory):** confirm no feature encodes the target. **If a metric looks >95% on this data, assume leakage until proven otherwise.**
- Lift quality *honestly* via feature engineering (lags, rolling means, seasonality, density) + bounded hyperparameter tuning.

| Model | Metric (fits its type) | Ambitious-but-honest target | How to reach it legitimately |
|---|---|---|---|
| 1 Hotspot (KDE+DBSCAN) | cluster quality + coverage | stable clusters; top-20 hotspots capture a reported share of incidents; matches known high-crime areas | tune eps/min_samples; face-validity check |
| 2 Forecasting (Prophet/SARIMA) | backtested MAPE + skill vs seasonal-naive | high-volume series (state, big district×category) **MAPE ≤ ~10%**; medium ≤ ~20%; always beat naive | lags/seasonality; seasonal-naive fallback on sparse series |
| 3 Risk scoring (LightGBM) | AUC + calibration + lift | **AUC ≥ 0.80**, calibrated, top-decile lift | crime-history + density features only (NO protected proxies); temporal validation |
| 4 Anomaly (IsolationForest) | recall on injected anomalies @ fixed FPR | **≥ 90% recall** at controlled false-positive rate | inject known anomalies to validate; tune contamination |
| 5 MO clustering (HDBSCAN) | silhouette/DBCV + noise fraction + interpretability | good separation, low noise, clusters map to recognizable MOs | feature encoding + min_cluster_size tuning |
| 6 Case-outcome (LightGBM) | **accuracy applies here** | multi-class: macro-F1 + accuracy, strongly beating majority baseline (realistic ~65–85%). **Binary framing** (detected vs undetected) can honestly reach **high-80s–90s AUC** → use as the headline | stratified CV; leakage check; try the binary target |
| Graph co-occurrence | modularity + recovered links | meaningful communities; rules with **confidence ≥ 0.6, lift > 1** | Louvain + FP-Growth thresholds |
| Socio-economic | Pearson/Spearman r (+p), R² | report significant correlations honestly (strong *and* weak are both findings) | per-capita normalization; area-level only |

**Legitimately high "headline" numbers for the pitch (all real, verifiable):**
- **100% row reconciliation** (1,674,734 == source) — data integrity.
- **99.54% geocoding coverage.**
- **Aggregate forecast accuracy** (state / large-district monthly) — report the low MAPE as "~9X% accurate", honestly.
- **Binary case-outcome classifier** (detected vs undetected) — the one genuine high-accuracy model.
- **Detection & conviction rates** from real `FIR_Stage` outcomes — factual insight.

**Bottom line:** "super good" here = *every model is as strong as its task honestly allows, validated on held-out data, beating a baseline, leakage-free.* That's bulletproof under scrutiny — unlike a fragile 95% that invites the leakage/overfitting/fabrication we've committed to avoiding.
