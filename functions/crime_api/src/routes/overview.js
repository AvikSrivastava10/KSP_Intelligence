"use strict";
const { getTable, readMeta } = require("../lib/store");
const { loadDistrictIndex, num, rate } = require("../lib/districts");

/**
 * GET /overview — statewide KPIs from precomputed tables.
 * State rates aggregate over GEOGRAPHIC units only (the 4 non-geographic special
 * units are excluded). 2024 is flagged partial. All values are `real`.
 */
module.exports = (router, asyncH) => {
  router.get("/overview", asyncH(async (req, res) => {
    const meta = readMeta();
    const idx = await loadDistrictIndex(req.ctx);
    const geoSet = new Set(idx.geo.map((r) => r.canonical_name));

    const outcomes = (await getTable("agg_outcomes", req.ctx)).filter((r) => geoSet.has(r.canonical_name));
    let total = 0, heinous = 0, accused = 0, arrested = 0, chargesheeted = 0, convicted = 0;
    for (const o of outcomes) {
      total += num(o.total_cases);
      heinous += num(o.heinous_cases);
      accused += num(o.accused);
      arrested += num(o.arrested);
      chargesheeted += num(o.chargesheeted);
      convicted += num(o.convicted);
    }

    const status = (await getTable("agg_case_status", req.ctx)).filter((r) => geoSet.has(r.canonical_name));
    let undetected = 0, statusTotal = 0;
    for (const s of status) {
      const c = num(s.count);
      statusTotal += c;
      if (s.status === "Undetected" || s.status === "Un Traced") undetected += c;
    }

    const topHeads = (await getTable("dim_crime_head", req.ctx))
      .slice(0, 10)
      .map((r) => ({ major_head: r.major_head, count: num(r.count) }));

    res.sendOk({
      total_firs: meta.total_rows_processed,
      fir_units: meta.districts.fir_units_total,
      districts_covered: Object.keys(idx.membersByParent).length,
      year_range: { start: 2016, end: 2024, partial_year: 2024 },
      per_year: meta.per_year_counts,
      note_2024_partial: meta.note_2024_partial,
      top_crime_heads: topHeads,
      heinous_share: rate(heinous, total),
      rates: {
        arrest_rate: rate(arrested, accused),
        chargesheet_rate: rate(chargesheeted, accused),
        conviction_rate: rate(convicted, chargesheeted),
        detection_rate: rate(statusTotal - undetected, statusTotal),
      },
      pct_geocoded: meta.coordinate_coverage.after_pct,
      coordinate_coverage: meta.coordinate_coverage,
      generated_at: meta.generated_at_utc,
    }, "real");
  }));
};
