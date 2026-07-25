"use strict";
const { getTable } = require("../lib/store");
const { loadDistrictIndex, num, rate } = require("../lib/districts");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TIER_WEIGHT = { Critical: 3, High: 2, Moderate: 1, Low: 0 };

/**
 * Phase 6 — Strategic Intelligence Hub.
 *
 * GET /hub  — ONE call that synthesises across models rather than re-serving each one.
 *
 * The value here is the CONVERGENCE list: districts independently flagged by more than one
 * model (high predicted risk AND a spiking crime category AND a historical anomaly). A district
 * that only one model flags is noise-prone; one that three models agree on is where a commander
 * should look first. That cross-model agreement exists in no single table, so it is computed here.
 */
module.exports = (router, asyncH) => {
  router.get("/hub", asyncH(async (req, res) => {
    const [riskRows, alertRows, anomRows, fcRows, clusterRows, outRows, idx] = await Promise.all([
      getTable("risk_scores", req.ctx),
      getTable("alerts", req.ctx),
      getTable("anomalies", req.ctx),
      getTable("forecasts", req.ctx),
      getTable("hotspot_clusters", req.ctx),
      getTable("outcomes_by_district", req.ctx),
      loadDistrictIndex(req.ctx),
    ]);

    // ---- per-district signal ledger (the synthesis) ----
    const sig = {};
    const touch = (d) => (sig[d] = sig[d] || {
      district: d, kgis_code: idx.kgisByParent[d] || "",
      risk_score: 0, risk_tier: null, predicted_next: 0,
      red_alerts: 0, amber_alerts: 0, top_alert: null,
      anomalies: 0, detection_rate: null, signals: 0,
    });

    for (const r of riskRows) {
      const s = touch(r.canonical_name);
      s.risk_score = num(r.risk_score);
      s.risk_tier = r.risk_tier;
      s.predicted_next = num(r.predicted_next);
      s.top_drivers = String(r.top_drivers || "").split(";").map((x) => x.trim()).filter(Boolean);
    }
    for (const a of alertRows) {
      const s = touch(a.canonical_name);
      if (a.severity === "red") s.red_alerts++; else s.amber_alerts++;
      const dev = num(a.deviation_pct);
      if (!s.top_alert || dev > s.top_alert.deviation_pct) {
        s.top_alert = { category: a.category, deviation_pct: dev, reason: a.reason };
      }
    }
    for (const an of anomRows) touch(an.canonical_name).anomalies++;
    for (const o of outRows) {
      if (sig[o.district]) sig[o.district].detection_rate = num(o.detection_rate);
    }

    // A "signal" = one model independently raising a flag for this district.
    const districts = Object.values(sig).map((s) => {
      let n = 0;
      if (s.risk_tier === "Critical" || s.risk_tier === "High") n++;
      if (s.red_alerts > 0) n++;
      if (s.anomalies > 0) n++;
      s.signals = n;
      s.priority = n * 100 + (TIER_WEIGHT[s.risk_tier] || 0) * 10 + Math.min(s.red_alerts, 9);
      return s;
    }).sort((a, b) => b.priority - a.priority || b.risk_score - a.risk_score);

    // "Converging" requires ALL THREE models to agree. A >=2 threshold flagged 27 of 31 districts
    // — too diluted to prioritise anything. All-three isolates 9, which is an actionable shortlist.
    const converging = districts.filter((d) => d.signals === 3);
    const breakdown = { three: 0, two: 0, one: 0, none: 0 };
    for (const d of districts) {
      breakdown[["none", "one", "two", "three"][d.signals]]++;
    }

    // ---- statewide forecast direction (next 12 months vs last full year) ----
    const stateFc = fcRows.filter((r) => r.level === "state" && r.category === "ALL");
    const projected = stateFc.filter((r) => num(r.is_forecast) === 1)
      .reduce((t, r) => t + num(r.yhat), 0);
    const last2023 = stateFc.filter((r) => num(r.is_forecast) === 0 && num(r.year) === 2023)
      .reduce((t, r) => t + num(r.y_actual), 0);
    const changePct = last2023 ? +(((projected - last2023) / last2023) * 100).toFixed(1) : null;
    const peak = stateFc.filter((r) => num(r.is_forecast) === 1)
      .sort((a, b) => num(b.yhat) - num(a.yhat))[0];

    // ---- top deployment recommendations (largest hotspot clusters) ----
    const deployments = clusterRows
      .map((c) => ({
        district: c.canonical_name, total_count: num(c.total_count),
        radius_km: num(c.radius_km), top_category: c.top_category,
        lat: num(c.centroid_lat), lng: num(c.centroid_lng),
        deployment_note: c.deployment_note,
      }))
      .sort((a, b) => b.total_count - a.total_count)
      .slice(0, 6);

    const redTotal = alertRows.filter((a) => a.severity === "red").length;
    res.sendOk({
      generated_for: "Karnataka State Crime Records Bureau",
      priority: {
        converging_count: converging.length,
        signal_breakdown: breakdown,
        total_districts: districts.length,
        note: "Converging = flagged by ALL THREE models independently (high risk tier + a spiking "
          + "crime category + a historical anomaly). Cross-model agreement is a stronger signal "
          + "than any single model, and a 2-of-3 threshold would flag most of the state.",
        districts: districts.slice(0, 10),
      },
      alerts: { red: redTotal, amber: alertRows.length - redTotal, total: alertRows.length },
      forecast: {
        projected_next_12mo: Math.round(projected),
        last_full_year: Math.round(last2023),
        change_pct: changePct,
        direction: changePct == null ? "unknown" : changePct >= 0 ? "rising" : "falling",
        busiest_month_ahead: peak ? MONTHS[num(peak.month) - 1] : null,
      },
      anomalies_total: anomRows.length,
      deployments,
      statewide_detection_rate: (() => {
        let det = 0, und = 0;
        for (const o of outRows) if (o.kgis_code) { det += num(o.detected); und += num(o.undetected); }
        return rate(det, det + und);
      })(),
    }, "real");
  }));
};
