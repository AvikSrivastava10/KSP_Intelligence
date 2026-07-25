"use strict";
const { getTable } = require("../lib/store");
const { loadDistrictIndex, num, safeDecode } = require("../lib/districts");

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Phase 4 - pattern discovery endpoints (all precomputed tables via store.js).
 *   GET /patterns/mo-clusters            HDBSCAN MO cluster summaries (+ member sub-heads)
 *   GET /patterns/temporal?district=     day-of-week x month heatmap grid + auto peak call-out
 */
module.exports = (router, asyncH) => {
  router.get("/patterns/mo-clusters", asyncH(async (req, res) => {
    const rows = await getTable("mo_clusters", req.ctx);
    const assignments = await getTable("mo_assignments", req.ctx);

    const members = {};
    for (const a of assignments) {
      const cid = String(a.cluster_id);
      (members[cid] = members[cid] || []).push({ crime_subhead: a.crime_subhead, n: num(a.n) });
    }
    for (const k of Object.keys(members)) members[k].sort((x, y) => y.n - x.n);

    const clusters = rows
      .map((r) => ({
        cluster_id: num(r.cluster_id),
        size: num(r.size),
        share_pct: num(r.share_pct),
        top_crime_head: r.top_crime_head,
        head_purity: num(r.head_purity),
        top_crime_subhead: r.top_crime_subhead,
        top_section: r.top_section,
        top_districts: String(r.top_districts || "").split(";").map((s) => s.trim()).filter(Boolean),
        heinous_share: num(r.heinous_share),
        season_profile: r.season_profile,
        time_profile: r.time_profile,
        mo_description: r.mo_description,
        members: (members[String(r.cluster_id)] || []).slice(0, 8),
      }))
      .sort((a, b) => b.size - a.size);

    res.sendOk({
      count: clusters.length,
      clusters,
      note: "MO clusters (HDBSCAN on incident profiles, crime-identity weighted). time_profile is "
        + "MODELED time-of-day (descriptive, not observed).",
    }, "real");
  }));

  router.get("/patterns/temporal", asyncH(async (req, res) => {
    const rows = await getTable("agg_temporal", req.ctx);
    const d = safeDecode(req.query.district);

    let district = null;
    if (d) {
      const idx = await loadDistrictIndex(req.ctx);
      district = idx.parentByCanonical[d] || d; // agg_temporal keys on the parent-district name
    }

    // aggregate to a dow x month grid
    const grid = Array.from({ length: 7 }, () => new Array(12).fill(0));
    const byDow = new Array(7).fill(0);
    const byMonth = new Array(12).fill(0);
    let total = 0;
    for (const r of rows) {
      if (district && r.district !== district) continue;
      const dow = num(r.dow), mo = num(r.month), c = num(r.count);
      if (dow < 0 || dow > 6 || mo < 1 || mo > 12) continue;
      grid[dow][mo - 1] += c;
      byDow[dow] += c;
      byMonth[mo - 1] += c;
      total += c;
    }

    // flat cells (ECharts heatmap: [monthIndex, dowIndex, value]) + peak cell
    const cells = [];
    let peak = { dow: 0, month: 1, count: -1 };
    for (let dw = 0; dw < 7; dw++) {
      for (let m = 0; m < 12; m++) {
        const v = grid[dw][m];
        cells.push({ month: m + 1, dow: dw, count: v });
        if (v > peak.count) peak = { dow: dw, month: m + 1, count: v };
      }
    }
    const peakDow = byDow.indexOf(Math.max(...byDow));
    const peakMonth = byMonth.indexOf(Math.max(...byMonth));
    const callout = total
      ? `FIRs peak on ${DOW[peak.dow]} in ${MONTHS[peak.month - 1]} `
        + `(busiest weekday: ${DOW[peakDow]}; busiest month: ${MONTHS[peakMonth]}).`
      : "No records for this selection.";

    res.sendOk({
      district: district || "Karnataka (all)",
      total,
      dow_labels: DOW,
      month_labels: MONTHS,
      cells,
      by_dow: DOW.map((label, i) => ({ label, count: byDow[i] })),
      by_month: MONTHS.map((label, i) => ({ label, count: byMonth[i] })),
      peak: { ...peak, label: total ? `${DOW[peak.dow]} · ${MONTHS[peak.month - 1]}` : null },
      peak_dow: DOW[peakDow],
      peak_month: MONTHS[peakMonth],
      callout,
    }, "real");
  }));
};
