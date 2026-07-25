"use strict";
const fs = require("fs");
const path = require("path");
const { getTable, DATA_DIR } = require("../lib/store");
const { num } = require("../lib/districts");

// friendly labels for model features (drivers panel)
const FEATURE_LABELS = {
  crime_head: "Crime type (major head)", crime_subhead: "Crime sub-type",
  first_section: "Primary legal section", first_act: "Primary act",
  district: "District", accused_count: "Accused named (count)",
  victims: "Victims (total)", year: "Year filed", month: "Month filed",
  dow: "Day of week", season: "Season", gravity: "Gravity (heinous/not)",
  complaint_mode: "Complaint mode", has_coord: "Has GPS location",
};

let _om = null;
function readOutcomeMetrics() {
  if (_om) return _om;
  _om = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "outcome_metrics.json"), "utf8"));
  return _om;
}

/**
 * Phase 4 - case-outcome endpoints.
 *   GET /outcomes           per-district detection/conviction analytics + statewide roll-up
 *   GET /outcomes/drivers   model feature importances (ASSOCIATIONS) + binary/multiclass cards
 */
module.exports = (router, asyncH) => {
  router.get("/outcomes", asyncH(async (req, res) => {
    const rows = await getTable("outcomes_by_district", req.ctx);
    const districts = rows
      .filter((r) => r.kgis_code) // geographic districts only (non-geographic specials dropped)
      .map((r) => ({
        district: r.district, kgis_code: r.kgis_code, cases: num(r.cases),
        detected: num(r.detected), undetected: num(r.undetected),
        detection_rate: num(r.detection_rate),
        convicted: num(r.convicted), conviction_rate: num(r.conviction_rate),
      }))
      .sort((a, b) => b.cases - a.cases);

    let det = 0, undet = 0, conv = 0, cases = 0;
    for (const d of districts) { det += d.detected; undet += d.undetected; conv += d.convicted; cases += d.cases; }
    const statewide = {
      cases,
      detection_rate: det + undet ? +(det / (det + undet)).toFixed(4) : 0,
      conviction_rate: cases ? +(conv / cases).toFixed(4) : 0,
    };
    res.sendOk({ count: districts.length, statewide, districts }, "real");
  }));

  router.get("/outcomes/drivers", asyncH(async (req, res) => {
    const rows = await getTable("outcome_drivers", req.ctx);
    const m = readOutcomeMetrics();
    const drivers = rows
      .map((r) => ({
        feature: r.feature,
        label: FEATURE_LABELS[r.feature] || r.feature,
        importance_detection_pct: num(r.importance_detection_pct),
        importance_multiclass_pct: num(r.importance_multiclass_pct),
      }))
      .sort((a, b) => b.importance_detection_pct - a.importance_detection_pct);

    res.sendOk({
      drivers,
      binary_detection: m.binary_detection,
      multiclass: m.multiclass,
      leakage_check: m.leakage_check,
      fairness: m.fairness,
      interpretation: m.interpretation,
      note: "Importances are ASSOCIATIONS with the outcome, not causal effects.",
    }, "real");
  }));
};
