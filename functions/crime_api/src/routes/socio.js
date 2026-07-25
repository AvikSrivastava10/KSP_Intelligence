"use strict";
const fs = require("fs");
const path = require("path");
const { getTable, DATA_DIR } = require("../lib/store");
const { num } = require("../lib/districts");

let _sm = null;
function readSocioMetrics() {
  if (_sm) return _sm;
  _sm = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "socio_metrics.json"), "utf8"));
  return _sm;
}

const bool = (v) => String(v).toLowerCase() === "true";
const numOrNull = (v) => (v === "" || v == null ? null : num(v));

/**
 * Phase 5 Module B - socio-economic correlation ("the why behind the where").
 *   GET /socio  correlations (socioeconomic + sensitive groups) + per-district scatter data
 *
 * Protected attributes (caste share, sex ratio) are returned in a SEPARATE `sensitive` group,
 * each flagged is_protected with a mandatory caveat. They exist for transparency/disparity
 * audit only — they are never model features and must never be used to rank or target.
 */
module.exports = (router, asyncH) => {
  router.get("/socio", asyncH(async (req, res) => {
    const [corrRows, distRows] = await Promise.all([
      getTable("socio_correlations", req.ctx),
      getTable("socio_districts", req.ctx),
    ]);
    const m = readSocioMetrics();

    const mapped = corrRows.map((r) => ({
      indicator: r.indicator,
      label: r.label,
      group: r.group,
      is_protected: bool(r.is_protected),
      n: num(r.n),
      pearson_r: num(r.pearson_r),
      p_value: num(r.p_value),
      spearman_r: num(r.spearman_r),
      significant: bool(r.significant),
      strength: r.strength,
      direction: r.direction,
      partial_r_ctrl_literacy: numOrNull(r.partial_r_ctrl_literacy),
      note: r.note,
      caveat: r.caveat,
    }));
    const byAbs = (a, b) => Math.abs(b.pearson_r) - Math.abs(a.pearson_r);
    const socioeconomic = mapped.filter((r) => !r.is_protected).sort(byAbs);
    const sensitive = mapped.filter((r) => r.is_protected).sort(byAbs);

    const districts = distRows.map((r) => ({
      census_code_2011: r.census_code_2011,
      district: r.district || r.district_2011_name,   // canonical name; census spelling as fallback
      district_2011_name: r.district_2011_name,
      population_2011: num(r.population_2011),
      crimes_per_100k: num(r.crimes_per_100k),
      total_crimes_all_years: num(r.total_crimes_all_years),
      literacy_rate: num(r.literacy_rate),
      urban_share: numOrNull(r.urban_share),
    })).sort((a, b) => b.crimes_per_100k - a.crimes_per_100k);

    const headline = socioeconomic.find((r) => r.significant && r.strength !== "negligible") || null;
    const anyProtectedSignificant = sensitive.some((r) => r.significant && r.strength !== "negligible");

    res.sendOk({
      n_districts: districts.length,
      method: m.method,
      census_vintage: m.census_vintage,
      significant_findings: m.significant_findings,
      headline: headline
        ? `${headline.label} shows the strongest link to recorded crime `
          + `(r=${headline.pearson_r.toFixed(2)}, p=${headline.p_value.toFixed(3)}) — most likely `
          + `reflecting reporting propensity rather than more offending.`
        : "No socio-economic indicator reaches a significant, non-negligible association.",
      protected_attributes_finding: anyProtectedSignificant
        ? "At least one protected attribute shows a statistically significant area-level "
          + "association. Interpret only as a prompt to audit reporting/enforcement disparity — "
          + "never as a targeting signal."
        : "No protected attribute (caste share, sex ratio) shows a significant, non-negligible "
          + "association with recorded crime in this data.",
      correlations: { socioeconomic, sensitive },
      districts,
      ethics: m.ethics,
      interpretation: m.interpretation,
    }, "real");
  }));
};
