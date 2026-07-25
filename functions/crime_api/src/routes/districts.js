"use strict";
const { z } = require("zod");
const { getTable } = require("../lib/store");
const { loadDistrictIndex, num, rate, safeDecode } = require("../lib/districts");

const listQuery = z.object({ per_capita: z.enum(["true", "false"]).optional() });

/**
 * GET /districts  — one row per geographic district (joined to the choropleth on kgis_code).
 * GET /district/:id — drill-down for a district (id = parent district name or a member unit).
 */
module.exports = (router, asyncH) => {
  router.get("/districts", asyncH(async (req, res) => {
    const q = listQuery.safeParse(req.query);
    const perCapita = q.success && q.data.per_capita === "true";

    const idx = await loadDistrictIndex(req.ctx);
    const outcomes = indexByCanon(await getTable("agg_outcomes", req.ctx));
    const units = await getTable("agg_unit", req.ctx);
    const socio = {};
    for (const s of await getTable("agg_socioeconomic", req.ctx)) socio[s.census_code_2011] = s;

    // count-weighted mean coords per parent district (for centroid markers / labels)
    const coordByParent = {};
    for (const u of units) {
      const parent = idx.parentByCanonical[u.canonical_name];
      if (!parent) continue;
      const nc = num(u.n_with_coord);
      if (nc <= 0) continue;
      const c = (coordByParent[parent] = coordByParent[parent] || { slat: 0, slon: 0, w: 0 });
      c.slat += num(u.mean_lat) * nc;
      c.slon += num(u.mean_lng) * nc;
      c.w += nc;
    }

    const districts = Object.keys(idx.membersByParent).map((parent) => {
      let total = 0;
      for (const m of idx.membersByParent[parent]) if (outcomes[m]) total += num(outcomes[m].total_cases);
      const census = idx.censusByParent[parent];
      const s = census ? socio[census] : null;
      const c = coordByParent[parent];
      return {
        district: parent,
        kgis_code: idx.kgisByParent[parent],
        total_cases: total,
        crimes_per_100k: s ? num(s.crimes_per_100k) : null,
        population_2011: s ? num(s.population_2011) : null,
        mean_lat: c ? +(c.slat / c.w).toFixed(5) : null,
        mean_lng: c ? +(c.slon / c.w).toFixed(5) : null,
      };
    });
    districts.sort((a, b) => b.total_cases - a.total_cases);

    res.sendOk({
      metric: perCapita ? "crimes_per_100k" : "total_cases",
      count: districts.length,
      districts,
    }, "real");
  }));

  router.get("/district/:id", asyncH(async (req, res) => {
    const id = (safeDecode(req.params.id) || "").trim();
    if (!id) return res.sendFail("district id required", 400);

    const idx = await loadDistrictIndex(req.ctx);
    let members = idx.membersByParent[id];
    if (!members && idx.parentByCanonical[id]) members = idx.membersByParent[idx.parentByCanonical[id]];
    if (!members) return res.sendFail(`district not found: ${id}`, 404);
    const set = new Set(members);
    const parent = idx.parentByCanonical[members[0]];

    // monthly / yearly / category series from agg_district_month
    const dm = (await getTable("agg_district_month", req.ctx)).filter((r) => set.has(r.canonical_name));
    const mMap = new Map(), yMap = new Map(), catMap = new Map();
    for (const r of dm) {
      const y = num(r.year), mo = num(r.month), c = num(r.count);
      const mk = `${y}-${String(mo).padStart(2, "0")}`;
      mMap.set(mk, (mMap.get(mk) || 0) + c);
      yMap.set(y, (yMap.get(y) || 0) + c);
      catMap.set(r.major_head, (catMap.get(r.major_head) || 0) + c);
    }
    const monthly = [...mMap.entries()].sort().map(([ym, count]) => ({ ym, count }));
    const yearly = [...yMap.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count, partial: year === 2024 }));
    const categories = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([major_head, count]) => ({ major_head, count }));

    // outcomes (summed over member units) + rates
    const outRows = (await getTable("agg_outcomes", req.ctx)).filter((r) => set.has(r.canonical_name));
    const o = { total_cases: 0, heinous_cases: 0, victims: 0, accused: 0, arrested: 0, chargesheeted: 0, convicted: 0 };
    for (const r of outRows) for (const k of Object.keys(o)) o[k] += num(r[k]);

    // case-status split + detection rate
    const stRows = (await getTable("agg_case_status", req.ctx)).filter((r) => set.has(r.canonical_name));
    const stMap = new Map();
    let undetected = 0, stTotal = 0;
    for (const r of stRows) {
      const c = num(r.count);
      stMap.set(r.status, (stMap.get(r.status) || 0) + c);
      stTotal += c;
      if (r.status === "Undetected" || r.status === "Un Traced") undetected += c;
    }
    const status = [...stMap.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count }));

    // top police stations
    const topUnits = (await getTable("agg_unit", req.ctx))
      .filter((r) => set.has(r.canonical_name))
      .map((u) => ({
        unit_name: u.unit_name,
        count: num(u.count),
        mean_lat: u.mean_lat !== "" ? num(u.mean_lat) : null,
        mean_lng: u.mean_lng !== "" ? num(u.mean_lng) : null,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.sendOk({
      district: parent || id,
      members,
      kgis_code: idx.kgisByParent[parent],
      monthly,
      yearly,
      categories,
      outcomes: {
        ...o,
        arrest_rate: rate(o.arrested, o.accused),
        chargesheet_rate: rate(o.chargesheeted, o.accused),
        conviction_rate: rate(o.convicted, o.chargesheeted),
        detection_rate: rate(stTotal - undetected, stTotal),
      },
      status,
      top_units: topUnits,
    }, "real");
  }));
};

function indexByCanon(rows) {
  const m = {};
  for (const r of rows) m[r.canonical_name] = r;
  return m;
}
