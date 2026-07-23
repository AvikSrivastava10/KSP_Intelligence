"use strict";
const { getTable } = require("../lib/store");
const { loadDistrictIndex, num } = require("../lib/districts");

// Bucket display order (Phase 0 emits: Night, Daytime, Morning, Afternoon, Evening, Distributed)
const ORDER = ["Night", "Morning", "Daytime", "Afternoon", "Evening", "Distributed"];
const NOTE =
  "Estimated time-of-day — MODELLED, not observed. The FIR extract has no clock time; " +
  "buckets are derived from the crime head's day/night signal + documented criminological " +
  "priors. Illustrative for the time×location view only; never used to train models.";

/**
 * GET /timeofday?district=&category=  — MODELLED time-of-day distribution (data_class=modeled).
 */
module.exports = (router, asyncH) => {
  router.get("/timeofday", asyncH(async (req, res) => {
    const rows = await getTable("agg_timeofday", req.ctx);
    const d = req.query.district ? decodeURIComponent(req.query.district) : null;
    const cat = req.query.category ? decodeURIComponent(req.query.category) : null;

    let memberSet = null;
    if (d) {
      const idx = await loadDistrictIndex(req.ctx);
      const members = idx.membersByParent[d] || (idx.parentByCanonical[d] ? idx.membersByParent[idx.parentByCanonical[d]] : null);
      if (members) memberSet = new Set(members);
    }

    const buckets = new Map();
    const methods = new Map();
    let total = 0;
    for (const r of rows) {
      if (memberSet && !memberSet.has(r.canonical_name)) continue;
      if (cat && r.major_head !== cat) continue;
      const c = num(r.count);
      total += c;
      buckets.set(r.modeled_time_of_day, (buckets.get(r.modeled_time_of_day) || 0) + c);
      methods.set(r.method, (methods.get(r.method) || 0) + c);
    }

    const bucketArr = [...buckets.entries()]
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => {
        const ia = ORDER.indexOf(a.bucket), ib = ORDER.indexOf(b.bucket);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.count - a.count;
      });
    const methodArr = [...methods.entries()].map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count);

    res.sendOk({ district: d, category: cat, total, buckets: bucketArr, by_method: methodArr, note: NOTE }, "modeled");
  }));
};
