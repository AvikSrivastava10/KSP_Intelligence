"use strict";
const { getTable } = require("../lib/store");
const { loadDistrictIndex, num, safeDecode } = require("../lib/districts");

const numOrNull = (v) => (v === "" || v == null ? null : num(v));
const SEV_ORDER = { red: 0, amber: 1 };

/**
 * Phase 3 - predictive endpoints. All read precomputed ml/out tables via store.js.
 * Predictions are derived from real data -> data_class=real; the UI presents them as
 * projections (dashed + CI) / flagged alerts.
 *   GET /forecast?level=state|district|category&key=&category=   history + 12-mo forecast (+CI)
 *   GET /forecast/options                                        selectable districts + categories
 *   GET /alerts?severity=                                        emerging-trend red-zones
 *   GET /risk                                                    per-district risk scores + tiers
 *   GET /risk/:id                                                one district's score + drivers
 *   GET /anomalies?district=&category=&year=&limit=              flagged spike anomalies
 */
module.exports = (router, asyncH) => {
  router.get("/forecast", asyncH(async (req, res) => {
    const rows = await getTable("forecasts", req.ctx);
    const level = ["state", "district", "category", "district_category"].includes(String(req.query.level))
      ? String(req.query.level) : "state";
    const key = safeDecode(req.query.key);
    const category = safeDecode(req.query.category);

    let want = rows.filter((r) => r.level === level);
    if (level === "state") {
      want = want.filter((r) => r.category === "ALL");
    } else if (level === "district") {
      want = want.filter((r) => r.category === "ALL" && (!key || r.key === key));
    } else if (level === "category") {
      want = want.filter((r) => !category || r.category === category);
    } else {
      want = want.filter((r) => (!key || r.key === key) && (!category || r.category === category));
    }

    const points = want
      .map((r) => ({
        year: num(r.year), month: num(r.month),
        y_actual: numOrNull(r.y_actual),
        yhat: numOrNull(r.yhat),
        yhat_lower: numOrNull(r.yhat_lower),
        yhat_upper: numOrNull(r.yhat_upper),
        is_forecast: num(r.is_forecast),
      }))
      .sort((a, b) => a.year - b.year || a.month - b.month);
    const method = (want.find((r) => num(r.is_forecast) === 1) || {}).method || null;

    const resolvedKey = level === "state" || level === "category" ? "Karnataka" : (key || null);
    res.sendOk({
      level, key: resolvedKey, category: level === "state" || level === "district" ? "ALL" : (category || null),
      method, horizon_months: points.filter((p) => p.is_forecast === 1).length, points,
      note: "Projection from historical FIR data (Holt-Winters); shaded band = 95% confidence interval.",
    }, "real");
  }));

  router.get("/forecast/options", asyncH(async (req, res) => {
    const rows = await getTable("forecasts", req.ctx);
    const districts = [...new Set(rows.filter((r) => r.level === "district").map((r) => r.key))].sort();
    const categories = [...new Set(rows.filter((r) => r.level === "category").map((r) => r.category))];
    res.sendOk({ districts, categories }, "real");
  }));

  router.get("/alerts", asyncH(async (req, res) => {
    const rows = await getTable("alerts", req.ctx);
    const sev = safeDecode(req.query.severity);
    let alerts = rows.map((r) => ({
      canonical_name: r.canonical_name, kgis_code: r.kgis_code, category: r.category,
      period: r.period, actual: num(r.actual), baseline: num(r.baseline),
      deviation_pct: num(r.deviation_pct), severity: r.severity, reason: r.reason,
    }));
    if (sev) alerts = alerts.filter((a) => a.severity === sev);
    alerts.sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || (b.deviation_pct - a.deviation_pct));
    res.sendOk({
      count: alerts.length,
      red: alerts.filter((a) => a.severity === "red").length,
      amber: alerts.filter((a) => a.severity === "amber").length,
      alerts,
    }, "real");
  }));

  router.get("/risk", asyncH(async (req, res) => {
    const rows = await getTable("risk_scores", req.ctx);
    const districts = rows.map((r) => ({
      canonical_name: r.canonical_name, kgis_code: r.kgis_code,
      population: numOrNull(r.population), predicted_next: num(r.predicted_next),
      risk_score: num(r.risk_score), risk_tier: r.risk_tier, top_drivers: r.top_drivers,
    })).sort((a, b) => b.risk_score - a.risk_score);
    const tiers = {};
    for (const d of districts) tiers[d.risk_tier] = (tiers[d.risk_tier] || 0) + 1;
    res.sendOk({ count: districts.length, tiers, districts }, "real");
  }));

  router.get("/risk/:id", asyncH(async (req, res) => {
    const id = safeDecode(req.params.id);
    if (!id) return res.sendFail("district id required", 400);
    const rows = await getTable("risk_scores", req.ctx);
    const idx = await loadDistrictIndex(req.ctx);
    const parent = idx.parentByCanonical[id] || id;
    const r = rows.find((x) => x.canonical_name === parent) || rows.find((x) => x.canonical_name === id);
    if (!r) return res.sendFail(`risk not found: ${id}`, 404);
    res.sendOk({
      canonical_name: r.canonical_name, kgis_code: r.kgis_code,
      population: numOrNull(r.population), predicted_next: num(r.predicted_next),
      risk_score: num(r.risk_score), risk_tier: r.risk_tier,
      drivers: String(r.top_drivers || "").split(";").map((s) => s.trim()).filter(Boolean),
    }, "real");
  }));

  router.get("/anomalies", asyncH(async (req, res) => {
    const rows = await getTable("anomalies", req.ctx);
    const d = safeDecode(req.query.district);
    const cat = safeDecode(req.query.category);
    const year = req.query.year ? String(req.query.year) : null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    let memberSet = null;
    if (d) {
      const idx = await loadDistrictIndex(req.ctx);
      const parent = idx.parentByCanonical[d] || d;
      memberSet = new Set([d, parent]);
    }
    let list = rows
      .filter((r) => (!memberSet || memberSet.has(r.canonical_name)))
      .filter((r) => (!cat || r.category === cat))
      .filter((r) => (!year || String(r.year) === year))
      .map((r) => ({
        canonical_name: r.canonical_name, kgis_code: r.kgis_code,
        year: num(r.year), month: num(r.month), category: r.category,
        count: num(r.count), expected: num(r.expected),
        anomaly_score: num(r.anomaly_score), reason: r.reason,
      }))
      .sort((a, b) => b.anomaly_score - a.anomaly_score);
    const total = list.length;
    res.sendOk({ total, showing: Math.min(limit, total), anomalies: list.slice(0, limit) }, "real");
  }));
};
