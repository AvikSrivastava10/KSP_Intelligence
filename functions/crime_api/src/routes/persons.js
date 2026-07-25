"use strict";
const fs = require("fs");
const path = require("path");
const { getTable, DATA_DIR } = require("../lib/store");
const { num } = require("../lib/districts");

let _lm = null;
function readLinkageMetrics() {
  if (_lm) return _lm;
  _lm = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "linkage_metrics.json"), "utf8"));
  return _lm;
}

const SYN_BANNER =
  "SYNTHETIC DEMONSTRATION. Every person, name and relationship on this screen is fabricated — "
  + "generated from real aggregate case counts to demonstrate the capability. No real individual "
  + "is depicted. This data lives in a separate syn_* plane and never trains or feeds any model.";

const RENDER_NODE_CAP = 350;

/**
 * Person-network DEMO endpoints — data_class = "synthetic" on every payload.
 *
 * Why this exists: suspect<->victim mapping and repeat-offender tracking are impossible on the
 * real extract (no person data; confidential under Indian law). The demo shows the CAPABILITY:
 * the same graph pipeline that serves the real entity network, driven by clearly-labelled
 * synthetic people, plus the REAL PPRL linkage engine validated against known ground truth.
 *
 *   GET /network/persons            force-graph nodes+edges (repeat-offender neighbourhoods first)
 *   GET /network/persons/offenders  repeat-offender profiles (cases, districts, MO)
 *   GET /network/linkage            the PPRL engine model card (real engine, synthetic testbed)
 */
module.exports = (router, asyncH) => {
  router.get("/network/persons", asyncH(async (req, res) => {
    const [personRows, edgeRows] = await Promise.all([
      getTable("syn_persons", req.ctx),
      getTable("syn_network_edges", req.ctx),
    ]);

    const persons = new Map(personRows.map((p) => [p.person_id, p]));
    const isRepeat = (id) => {
      const p = persons.get(id);
      return p && String(p.is_repeat_offender).toLowerCase() === "true";
    };

    // Seed with repeat offenders, then BFS their neighbourhood over an ADJACENCY INDEX.
    // A single ordered pass over the edge list would fill the node cap with co_accused
    // neighbours before reaching any accused_victim rows (they are written later in the file),
    // silently dropping the suspect<->victim relationships this screen exists to show.
    const adj = new Map();
    for (const e of edgeRows) {
      if (!adj.has(e.src)) adj.set(e.src, []);
      if (!adj.has(e.dst)) adj.set(e.dst, []);
      adj.get(e.src).push([e.dst, e.edge_type]);
      adj.get(e.dst).push([e.src, e.edge_type]);
    }
    const seeds = personRows
      .filter((p) => String(p.is_repeat_offender).toLowerCase() === "true")
      .map((p) => p.person_id);
    const keep = new Set(seeds);
    // round-robin over edge types so both relationship kinds survive the cap
    for (const wantType of ["accused_victim", "co_accused"]) {
      for (const s of seeds) {
        if (keep.size >= RENDER_NODE_CAP) break;
        for (const [nb, type] of adj.get(s) || []) {
          if (type !== wantType) continue;
          keep.add(nb);
          if (keep.size >= RENDER_NODE_CAP) break;
        }
      }
    }

    const nodes = [...keep].map((id) => {
      const p = persons.get(id);
      if (!p) return null;
      return {
        id,
        name: p.name,
        node_type: id.startsWith("SYN-V") ? "victim" : "accused",
        gender: p.gender,
        age: num(p.age),
        home_district: p.home_district,
        is_repeat_offender: isRepeat(id),
        n_cases: num(p.n_cases),
      };
    }).filter(Boolean);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = edgeRows
      .filter((e) => ids.has(e.src) && ids.has(e.dst))
      .map((e) => ({ source: e.src, target: e.dst, edge_type: e.edge_type, case_id: e.case_id }));

    res.sendOk({
      banner: SYN_BANNER,
      counts: {
        persons_total: personRows.length,
        shown: nodes.length,
        edges_shown: edges.length,
        repeat_offenders: personRows.filter((p) => String(p.is_repeat_offender).toLowerCase() === "true").length,
      },
      nodes,
      edges,
      note: "Rendering repeat-offender neighbourhoods first (capped for the browser). "
        + "Volumes mirror the real district x crime-type distribution; the people do not exist.",
    }, "synthetic");
  }));

  router.get("/network/persons/offenders", asyncH(async (req, res) => {
    const rows = await getTable("syn_offender_profiles", req.ctx);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 150);
    const profiles = rows.map((r) => ({
      person_id: r.person_id,
      name: r.name,
      gender: r.gender,
      age: num(r.age),
      n_cases: num(r.n_cases),
      districts: String(r.districts || "").split(";").map((s) => s.trim()).filter(Boolean),
      n_districts: num(r.n_districts),
      mo_summary: r.mo_summary,
      years: r.years,
      case_ids: String(r.case_ids || "").split(";").map((s) => s.trim()).filter(Boolean),
    })).sort((a, b) => b.n_districts - a.n_districts || b.n_cases - a.n_cases);

    res.sendOk({
      banner: SYN_BANNER,
      total: profiles.length,
      cross_jurisdiction: profiles.filter((p) => p.n_districts > 1).length,
      profiles: profiles.slice(0, limit),
    }, "synthetic");
  }));

  router.get("/network/linkage", asyncH(async (req, res) => {
    const m = readLinkageMetrics();
    // The ENGINE is real and deployable; only its validation testbed is synthetic. The metric
    // is a genuine measurement, so the card is served as-is with that distinction stated.
    res.sendOk({
      engine: m.engine,
      threshold: m.threshold,
      weights: m.weights,
      records_linked: m.records_linked,
      pairwise_comparisons: m.pairwise_comparisons,
      validation: m.validation,
      deployment: m.deployment,
      fairness_note: m.fairness_note,
      what_this_is: "A real privacy-preserving record-linkage engine (the missing piece for "
        + "repeat-offender tracking), validated against synthetic ground truth with known "
        + "identities. Deploying it inside KSP's perimeter on the source system's person tables "
        + "would light up the person network with zero identity exposure.",
    }, "synthetic");
  }));
};
