"use strict";
// readJson moved into lib/store.js once a second route (schema.js) needed it.
const { getTable, readJson, readMeta, probeDatastore } = require("../lib/store");
const { probeCache } = require("../lib/catalystCache");
const { smartbrowzState } = require("./report");
const { num } = require("../lib/districts");

/**
 * Phase 6 — Fairness & Data-Quality audit.
 *
 * GET /audit — the platform's own limitations, in one place, stated before anyone has to ask.
 *
 * A crime-intelligence tool that only advertises its strengths is not trustworthy. This endpoint
 * publishes what the data cannot support, which capabilities were descoped and why, what every
 * model actually scored, and which attributes are excluded from modelling by design.
 */
module.exports = (router, asyncH) => {
  router.get("/audit", asyncH(async (req, res) => {
    const meta = readMeta();
    const outcome = readJson("outcome_metrics.json", {});
    const network = readJson("network_metrics.json", {});
    const socio = readJson("socio_metrics.json", {});
    const validation = readJson("validation_metrics.json", {});
    const zia = readJson("zia_benchmark.json", null);
    const er = readJson("er_conformance.json", null);
    const timeofday = await getTable("agg_timeofday", req.ctx);

    const cov = meta.coordinate_coverage || {};
    const byPrec = cov.by_precision || {};
    const totalRows = num(meta.total_rows_processed);

    // ---- data coverage / quality ----
    const coverage = {
      total_records: totalRows,
      reconciles_to_source: meta.row_count_reconciles === true,
      year_range: "2016–2024",
      partial_year: { year: 2024, records: num((meta.per_year_counts || {})["2024"]),
                      note: meta.note_2024_partial },
      geocoding: {
        real_gps_pct: cov.before_pct,
        after_geocoding_pct: cov.after_pct,
        by_precision: byPrec,
        note: "Only ~30% of FIRs carry real GPS. The rest are pinned to police-station or "
          + "village/place coordinates, or fall back to the district centroid. District-centroid "
          + "points are EXCLUDED from the hotspot/heat layers — they would render as fake clusters.",
      },
      districts: {
        fir_units: (meta.districts || {}).fir_units_total,
        geographic: (meta.districts || {}).geographic,
        non_geographic: (meta.districts || {}).non_geographic,
        note: "CID, Coastal Security, ISD Bengaluru and Karnataka Railways are not geographic "
          + "districts; they are excluded from maps and per-capita rates.",
      },
    };

    // ---- what the data cannot support (stated up front) ----
    const limitations = [
      { item: "Person-level networks (suspect ↔ victim) on REAL data", status: "not possible",
        why: "Victim/accused identities are confidential under Indian law and absent from the "
          + "extract. Even the official KSP ER schema has no cross-case person key.",
        instead: "Entity co-occurrence network on real data, PLUS a clearly-labelled SYNTHETIC "
          + "person network (separate syn_* plane, data_class=synthetic) demonstrating the "
          + "capability without fabricating anything presented as real." },
      { item: "Repeat-offender tracking on REAL data", status: "not possible",
        why: "Same constraint — no person identifiers, and no cross-case key to join on.",
        instead: "A real privacy-preserving record-linkage (PPRL) engine that resolves identity "
          + "probabilistically and exports only salted tokens — validated at F1 0.98 against "
          + "synthetic ground truth. Deployed inside KSP's perimeter it would enable this for "
          + "real, with identities never leaving the force." },
      { item: "Observed time-of-day hotspots", status: "not possible",
        why: "The FIR extract records only year/month/day — no clock time.",
        instead: "A clearly-labelled MODELED time-of-day profile (data_class=modeled), never "
          + "used to train any model." },
      { item: "Crime rate as true offending", status: "caveat",
        why: "FIR counts measure REPORTED crime. Better-policed, more literate districts report "
          + "more, which inflates their apparent rate.",
        instead: "Socio-economic correlations are labelled as reporting-propensity signals." },
      { item: "Per-capita rates", status: "caveat",
        why: "Population is Census 2011 while crime spans 2016–2024, so rates are indicative.",
        instead: "Raw counts are shown alongside every per-capita figure." },
    ];

    // ---- fairness guarantees ----
    const fairness = {
      excluded_from_all_models: ["caste (SC/ST share)", "religion", "sex / sex ratio", "occupation"],
      victim_counts: "Used only as a TOTAL. The Male/Female/Boy/Girl split is never a feature.",
      where_protected_attributes_appear: "Only in the area-level socio-economic correlation view, "
        + "segregated into a 'sensitive' group with a mandatory caveat, for enforcement-disparity "
        + "audit — never for targeting and never as a model feature.",
      finding: (socio.ethics && socio.ethics.protected_attributes_segregated)
        ? "No protected attribute shows a significant, non-negligible association with recorded crime."
        : null,
      leakage_control: outcome.leakage_check
        ? `Outcome model excludes every disposition-derived field (${(outcome.leakage_check.excluded_features || []).join(", ")}); leakage flag: ${outcome.leakage_check.flagged}.`
        : null,
      predictive_policing_note: "Risk scores rank AREAS for resource planning, never individuals. "
        + "Because recorded crime reflects where police already look, feedback-loop bias is a real "
        + "risk — these outputs support deployment decisions, they do not justify them.",
    };

    // ---- model cards, one row each ----
    const models = [
      { model: "Spatiotemporal hotspots", technique: "Gaussian KDE + weighted DBSCAN",
        metric: "silhouette 0.492 · 467 clusters", data_class: "real" },
      { model: "Forecast (12-month)", technique: "Holt-Winters, damped trend",
        metric: "backtest MAPE 11.2% · real-2024 MAPE 8.2%", data_class: "real" },
      { model: "Emerging-trend alerts", technique: "deviation vs recent baseline",
        metric: "121 red-zones (68 red / 53 amber)", data_class: "real" },
      { model: "District risk", technique: "LightGBM on growth ratio",
        metric: "Spearman 0.981 · MAE 1229 (beats persistence 1258)", data_class: "real" },
      { model: "Anomaly detection", technique: "IsolationForest + z/ratio rules",
        metric: "91% injected-spike recall · 415 flagged", data_class: "real" },
      { model: "MO clustering", technique: "HDBSCAN on weighted MO profiles",
        metric: "silhouette 0.682 · noise 9.1% · 43 clusters", data_class: "real" },
      { model: "Case outcome (binary)", technique: "LightGBM detected/undetected",
        metric: `AUC ${(outcome.binary_detection || {}).auc_mean ?? "—"} vs ${(outcome.binary_detection || {}).baseline_accuracy ?? "—"} baseline`,
        data_class: "real" },
      { model: "Case outcome (13-class)", technique: "LightGBM on FIR_Stage",
        metric: `acc ${(outcome.multiclass || {}).accuracy ?? "—"} · macro-F1 ${(outcome.multiclass || {}).macro_f1 ?? "—"}`,
        data_class: "real" },
      { model: "Entity network", technique: "NetworkX + Louvain",
        metric: `modularity ${(network.communities || {}).modularity ?? "—"} · ${(network.communities || {}).count ?? "—"} communities`,
        data_class: "real" },
      { model: "Socio-economic", technique: "Pearson/Spearman + partial correlation",
        metric: `n=${socio.n_districts ?? "—"} districts · ${socio.significant_findings ?? 0} significant`,
        data_class: "real" },
      { model: "Time-of-day profile", technique: "category signal + criminological priors",
        metric: `${timeofday.length} rows — illustrative only`, data_class: "modeled" },
    ];

    // ---- Catalyst service map ----
    // Published for the same reason the limitations are: a reviewer should not have to reverse
    // engineer which platform service backs which capability. Where a capability is served by our
    // own code, the reason is stated rather than left to inference.
    // A service is reported "active" only if it is OBSERVABLY serving this request. Anything that
    // needs a Catalyst request context (Data Store, Cache, SmartBrowz, and the function runtime
    // itself) is inactive off-platform, so claiming otherwise here would contradict /health in the
    // same breath — and the panel's whole value is that it reports rather than asserts.
    const onPlatform = !!(req.ctx && req.ctx.app);
    const live = (cond) => (cond ? "active" : "configured");
    // Data Store and SmartBrowz are reported from EVIDENCE, not from the presence of a context.
    // On the first live deploy both read "active" while neither was actually serving.
    const [dsProbe, cacheProbe] = await Promise.all([
      probeDatastore(req.ctx), probeCache(req.ctx),
    ]);
    const sb = smartbrowzState();
    const sbStatus = !onPlatform ? "configured"
      : sb.attempted ? (sb.ok ? "active" : "unavailable")
        : "configured";

    const catalyst_services = [
      { capability: "Serverless backend logic", service: "Catalyst Functions",
        status: live(onPlatform), detail: "crime_api — Advanced I/O function, Node 18, 34 endpoints." },
      { capability: "Frontend / SPA hosting", service: "Catalyst Web Client Hosting",
        status: live(onPlatform), detail: "React 18 + Vite build served from client/dist." },
      { capability: "Relational database", service: "Catalyst Data Store",
        status: live(dsProbe.reachable),
        detail: "42-table schema generated from the real data with measured varchar widths. "
          + "The bundled CSV copy is retained as a resilience fallback and is byte-identical." },
      { capability: "Cache", service: "Catalyst Cache",
        status: process.env.USE_CATALYST_CACHE === "false" ? "disabled" : live(cacheProbe.working),
        detail: "GET responses cached by URL hash. Every response is precomputed, so it is a pure "
          + "function of its query string — safe to cache and shared across function instances." },
      { capability: "API routing, throttling and access rules", service: "Catalyst API Gateway",
        status: process.env.USE_API_GATEWAY === "true" ? "active" : "configured",
        detail: "Throttling at the edge. The in-process limiter stands down when the gateway is "
          + "fronting the function, so the endpoint is never left unprotected." },
      { capability: "PDF report generation", service: "Catalyst SmartBrowz",
        status: sbStatus,
        detail: "GET /report/briefing renders the intelligence briefing server-side, so it can be "
          + "scheduled and circulated rather than only printed from one analyst's browser." },
      { capability: "CI/CD", service: "Catalyst Pipelines",
        status: "configured",
        detail: "catalyst-pipelines.yaml. The automated test suite is a deploy gate, so a build "
          + "that breaks a fairness or data-integrity guarantee cannot reach production." },
      { capability: "Automated model training (tabular)", service: "Catalyst Zia AutoML",
        status: zia && zia.status === "complete" ? "active" : "configured",
        detail: "The case-outcome model is BENCHMARKED against Zia AutoML on a shared 2,000-row "
          + "holdout with identical training rows, and both numbers are published rather than one "
          + "being swapped in silently. Zia AutoML trains from the console only, so the datasets "
          + "and the scoring harness are generated by ml/zia_benchmark.py."
          + (zia && zia.verdict_note ? ` Result: ${zia.verdict_note}` : " Training pending.") },
      { capability: "Spatial clustering, forecasting, MO clustering, graph analysis",
        service: "custom Python (offline)", status: "no_catalyst_equivalent",
        detail: "KDE + DBSCAN, Holt-Winters, HDBSCAN, NetworkX + Louvain, association rules and "
          + "the PPRL linkage engine. Zia AutoML covers supervised tabular learning and QuickML "
          + "covers no-code pipelines; neither provides these algorithms. Models run offline and "
          + "the API serves only their precomputed outputs." },
      { capability: "Maps and charts", service: "React-Leaflet / Apache ECharts",
        status: "no_catalyst_equivalent",
        detail: "Catalyst offers no client-side geospatial or charting component." },
    ];

    res.sendOk({
      generated_at: meta.generated_at_utc,
      source_file: meta.source_file,
      coverage,
      limitations,
      fairness,
      models,
      catalyst_services,
      // Fidelity to KSP's own database design. Summarised here for the trust page; the full
      // 28-entity contract with every column is at GET /schema/er.
      er_conformance: er ? {
        source_document: er.source_document,
        entities_total: er.entities_total,
        by_status: er.by_status,
        by_blocker: er.by_blocker,
        columns_total: er.entities.reduce((a, e) => a + e.columns_total, 0),
        columns_populated: er.entities.reduce((a, e) => a + e.columns_populated, 0),
        blocker_reasons: Object.fromEntries(
          er.entities.filter((e) => e.blocker).map((e) => [e.blocker, e.blocker_reason])
        ),
        entities: er.entities.map((e) => ({
          er_entity: e.er_entity, status: e.status, our_table: e.our_table,
          row_count: e.row_count, columns_total: e.columns_total,
          columns_populated: e.columns_populated, blocker: e.blocker, summary: e.summary,
        })),
        honesty: er.honesty,
        detail_endpoint: "/schema/er",
      } : null,
      // The evidence behind the statuses above, so the claim is auditable rather than trusted.
      service_evidence: {
        datastore: dsProbe,
        cache: cacheProbe,
        smartbrowz: sb.attempted
          ? { attempted: true, ok: sb.ok, reason: sb.reason, at: sb.at }
          : { attempted: false, note: "No render attempted yet in this instance. Call "
              + "/report/briefing once; the status here then reflects what actually happened." },
      },
      runtime: {
        on_catalyst: onPlatform,
        note: onPlatform
          ? "Observed from a Catalyst-hosted function, so service statuses below are measured."
          : "Observed from a local Node process. Services that require a Catalyst request context "
            + "(Data Store, Cache, SmartBrowz) report Configured rather than Live — they are wired "
            + "and unit-tested against a mocked SDK, but nothing here claims they are running.",
      },
      // Zia AutoML vs LightGBM on one shared holdout. Published in full — including the protocol
      // and its stated limits — because a benchmark without its protocol is just two numbers.
      tabular_model_benchmark: zia ? {
        task: zia.task,
        status: zia.status,
        protocol: zia.protocol,
        baseline_majority_class_accuracy: zia.baseline_majority_class_accuracy,
        results: zia.results,
        verdict: zia.verdict || null,
        verdict_note: zia.verdict_note
          || "Zia AutoML training is a console step and has not been run yet. The LightGBM figures "
             + "above are already measured on the shared holdout and will not move once it is.",
        why: "The Catalyst services table names Zia AutoML for tabular model training. Rather than "
          + "swap or ignore, both models are scored on identical rows and both are reported.",
      } : null,
      ground_truth_validation: validation.results
        ? { tests: validation.results, honesty: validation.honesty }
        : null,
      data_classes: meta.data_class,
      guardrails: meta.guardrails,
      synthetic_data: "Confined to the person-network DEMO (syn_* tables, ~3.9k fabricated people). "
        + "Every payload built from it is data_class=\"synthetic\" and the UI carries a permanent "
        + "banner. It is never joined to a real table and never trains or validates any model — "
        + "asserted by automated tests. All other figures in this platform are real.",
    }, "real");
  }));
};
