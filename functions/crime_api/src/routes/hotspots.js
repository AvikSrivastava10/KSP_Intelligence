"use strict";
const { getTable } = require("../lib/store");
const { loadDistrictIndex, num, safeDecode } = require("../lib/districts");

const HEAT_CAP = 25000; // cap cells returned for browser heat-layer performance

/**
 * Geospatial endpoints (Phase 2). All read precomputed tables via store.js.
 *   GET /hotspots?year=&precision=   heat-layer cells (real precision only; NO district-centroid)
 *   GET /hotspots/clusters?limit=    DBSCAN cluster summaries + deployment notes
 *   GET /stations?district=          police-station points (agg_unit) for the station layer
 */
module.exports = (router, asyncH) => {
  router.get("/hotspots", asyncH(async (req, res) => {
    const rows = await getTable("hotspot_cells", req.ctx);
    const year = req.query.year ? String(req.query.year) : null;
    const precFilter = req.query.precision ? new Set(String(req.query.precision).split(",")) : null;

    let cells;
    if (year && year !== "all") {
      cells = [];
      for (const r of rows) {
        if (String(r.year) !== year) continue;
        if (precFilter && !precFilter.has(r.geo_precision)) continue;
        cells.push({ lat: num(r.lat), lng: num(r.lng), count: num(r.count), density: num(r.density), geo_precision: r.geo_precision });
      }
    } else {
      // aggregate over all years per cell
      const m = new Map();
      for (const r of rows) {
        if (precFilter && !precFilter.has(r.geo_precision)) continue;
        const k = `${r.lat},${r.lng}`;
        const e = m.get(k);
        if (e) e.count += num(r.count);
        else m.set(k, { lat: num(r.lat), lng: num(r.lng), count: num(r.count), density: num(r.density), geo_precision: r.geo_precision });
      }
      cells = [...m.values()];
    }

    let capped = false;
    if (cells.length > HEAT_CAP) {
      cells.sort((a, b) => b.count - a.count);
      cells = cells.slice(0, HEAT_CAP);
      capped = true;
    }
    res.sendOk({ year: year || "all", count: cells.length, capped, note_precision: "point = real GPS; station = pinned to police-station coords; place = geocoded village/place. District-centroid points are excluded (shown only on the choropleth).", cells }, "real");
  }));

  router.get("/hotspots/clusters", asyncH(async (req, res) => {
    const rows = await getTable("hotspot_clusters", req.ctx);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 500);
    const clusters = rows
      .map((r) => ({
        cluster_id: num(r.cluster_id),
        centroid_lat: num(r.centroid_lat),
        centroid_lng: num(r.centroid_lng),
        n_points: num(r.n_points),
        total_count: num(r.total_count),
        canonical_name: r.canonical_name,
        radius_km: num(r.radius_km),
        top_category: r.top_category,
        deployment_note: r.deployment_note,
      }))
      .sort((a, b) => b.total_count - a.total_count);
    res.sendOk({ total_clusters: clusters.length, showing: Math.min(limit, clusters.length), clusters: clusters.slice(0, limit) }, "real");
  }));

  router.get("/stations", asyncH(async (req, res) => {
    const rows = await getTable("agg_unit", req.ctx);
    const d = safeDecode(req.query.district);
    let memberSet = null;
    if (d) {
      const idx = await loadDistrictIndex(req.ctx);
      const members = idx.membersByParent[d] || (idx.parentByCanonical[d] ? idx.membersByParent[idx.parentByCanonical[d]] : null);
      if (members) memberSet = new Set(members);
    }
    const stations = rows
      .filter((r) => r.mean_lat !== "" && r.mean_lng !== "" && num(r.n_with_coord) > 0)
      .filter((r) => !memberSet || memberSet.has(r.canonical_name))
      .map((r) => ({
        unit_name: r.unit_name,
        canonical_name: r.canonical_name,
        parent_district: r.parent_district,
        kgis_code: r.kgis_code,
        count: num(r.count),
        mean_lat: num(r.mean_lat),
        mean_lng: num(r.mean_lng),
      }))
      .sort((a, b) => b.count - a.count);
    res.sendOk({ district: d, count: stations.length, stations }, "real");
  }));
};
