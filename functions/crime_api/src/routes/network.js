"use strict";
const fs = require("fs");
const path = require("path");
const { getTable, DATA_DIR } = require("../lib/store");
const { num, safeDecode } = require("../lib/districts");

let _nm = null;
function readNetworkMetrics() {
  if (_nm) return _nm;
  _nm = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "network_metrics.json"), "utf8"));
  return _nm;
}

const bool = (v) => String(v).toLowerCase() === "true";

/**
 * Phase 5 Module A - entity link analysis (REAL, entity-level, never persons).
 *   GET /network/entity?community=&limit=   force-graph nodes + edges (+ graph stats)
 *   GET /network/communities                Louvain "crime ecosystem" summaries
 *   GET /network/rules?type=&limit=         association rules (co-occurrence | spatial_affinity)
 */
module.exports = (router, asyncH) => {
  router.get("/network/entity", asyncH(async (req, res) => {
    const [nodeRows, edgeRows] = await Promise.all([
      getTable("network_nodes", req.ctx),
      getTable("network_edges", req.ctx),
    ]);
    const m = readNetworkMetrics();
    const community = req.query.community != null && req.query.community !== ""
      ? String(req.query.community) : null;
    const focus = safeDecode(req.query.focus);   // centre the graph on one entity + its neighbours
    const type = safeDecode(req.query.type);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 250, 10), 500);

    let nodes = nodeRows.map((r) => ({
      id: r.node,
      node_type: r.node_type,
      degree: num(r.degree),
      weighted_degree: num(r.weighted_degree),
      cases: num(r.cases),
      community_id: num(r.community_id),
      pagerank: num(r.pagerank),
      betweenness: num(r.betweenness),
      is_hub: bool(r.is_hub),
      top_districts: String(r.top_districts || "").split(";").map((s) => s.trim()).filter(Boolean),
    }));
    if (community !== null) nodes = nodes.filter((n) => String(n.community_id) === community);
    if (type) nodes = nodes.filter((n) => n.node_type === type);
    if (focus) {
      // ego-network: the focused entity plus everything it actually shares cases with
      const linked = new Set([focus]);
      for (const e of edgeRows) {
        if (e.src === focus) linked.add(e.dst);
        else if (e.dst === focus) linked.add(e.src);
      }
      nodes = nodes.filter((n) => linked.has(n.id));
    }
    nodes.sort((a, b) => b.pagerank - a.pagerank);
    nodes = nodes.slice(0, limit);

    // keep only edges whose BOTH endpoints survived the filter (no dangling links)
    const keep = new Set(nodes.map((n) => n.id));
    const edges = edgeRows
      .filter((e) => keep.has(e.src) && keep.has(e.dst))
      .map((e) => ({
        source: e.src, target: e.dst,
        src_type: e.src_type, dst_type: e.dst_type,
        weight: num(e.weight), log_weight: num(e.log_weight),
      }))
      .sort((a, b) => b.weight - a.weight);

    res.sendOk({
      community: community === null ? "all" : num(community),
      counts: { nodes: nodes.length, edges: edges.length },
      graph_stats: m.graph,
      community_stats: m.communities,
      nodes,
      edges,
      scope: m.scope,
      interpretation: m.interpretation,
    }, "real");
  }));

  /**
   * GET /network/entities?q=&type=&community=&sort=&limit=&offset=
   * The FULL entity list as a browsable, searchable table — the graph view is capped for
   * legibility, so this is how a user reaches every one of the 483 entities and sorts them
   * by the metric they care about.
   */
  router.get("/network/entities", asyncH(async (req, res) => {
    const rows = await getTable("network_nodes", req.ctx);
    const q = (safeDecode(req.query.q) || "").trim().toLowerCase();
    const type = safeDecode(req.query.type);
    const community = req.query.community != null && req.query.community !== ""
      ? String(req.query.community) : null;
    const sortKey = ["pagerank", "cases", "degree", "weighted_degree", "betweenness", "node"]
      .includes(String(req.query.sort)) ? String(req.query.sort) : "pagerank";
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let list = rows.map((r) => ({
      id: r.node, node_type: r.node_type,
      degree: num(r.degree), weighted_degree: num(r.weighted_degree),
      cases: num(r.cases), community_id: num(r.community_id),
      pagerank: num(r.pagerank), betweenness: num(r.betweenness),
      is_hub: bool(r.is_hub),
      top_districts: String(r.top_districts || "").split(";").map((s) => s.trim()).filter(Boolean),
    }));
    if (q) list = list.filter((n) => n.id.toLowerCase().includes(q));
    if (type) list = list.filter((n) => n.node_type === type);
    if (community !== null) list = list.filter((n) => String(n.community_id) === community);

    list.sort((a, b) => (sortKey === "node"
      ? String(a.id).localeCompare(String(b.id))
      : b[sortKey] - a[sortKey]));

    res.sendOk({
      total: list.length,
      offset,
      showing: Math.min(limit, Math.max(list.length - offset, 0)),
      sort: sortKey,
      entities: list.slice(offset, offset + limit),
      type_counts: rows.reduce((acc, r) => {
        acc[r.node_type] = (acc[r.node_type] || 0) + 1;
        return acc;
      }, {}),
    }, "real");
  }));

  /**
   * GET /network/entity/:id — everything known about ONE entity.
   * Answers "what is actually happening in these connections?": who it links to and how
   * strongly, which association rules involve it, where it concentrates, and how central it is.
   */
  router.get("/network/entity/:id", asyncH(async (req, res) => {
    const id = safeDecode(req.params.id);
    if (!id) return res.sendFail("entity id required", 400);

    const [nodeRows, edgeRows, ruleRows, commRows] = await Promise.all([
      getTable("network_nodes", req.ctx),
      getTable("network_edges", req.ctx),
      getTable("association_rules", req.ctx),
      getTable("network_communities", req.ctx),
    ]);
    const node = nodeRows.find((n) => n.node === id);
    if (!node) return res.sendFail(`entity not found: ${id}`, 404);

    const byId = new Map(nodeRows.map((n) => [n.node, n]));
    const neighbours = [];
    for (const e of edgeRows) {
      const other = e.src === id ? e.dst : e.dst === id ? e.src : null;
      if (!other) continue;
      const o = byId.get(other);
      neighbours.push({
        id: other,
        node_type: o ? o.node_type : (e.src === id ? e.dst_type : e.src_type),
        weight: num(e.weight),
        community_id: o ? num(o.community_id) : null,
        // share of THIS entity's cases that also involve the neighbour — the interpretable number
        share_of_entity: num(node.cases) ? +(num(e.weight) / num(node.cases)).toFixed(4) : null,
      });
    }
    neighbours.sort((a, b) => b.weight - a.weight);

    const rules = ruleRows
      .filter((r) => r.antecedent === id || r.consequent === id)
      .map((r) => ({
        rule_type: r.rule_type, antecedent: r.antecedent, consequent: r.consequent,
        cases: num(r.cases), confidence: num(r.confidence), lift: num(r.lift), reading: r.reading,
        direction: r.antecedent === id ? "from" : "to",
      }))
      .sort((a, b) => b.lift - a.lift);

    const comm = commRows.find((c) => String(c.community_id) === String(node.community_id));

    res.sendOk({
      id, node_type: node.node_type,
      cases: num(node.cases),
      degree: num(node.degree), weighted_degree: num(node.weighted_degree),
      pagerank: num(node.pagerank), betweenness: num(node.betweenness),
      is_hub: bool(node.is_hub),
      rank_by_pagerank: nodeRows
        .map((n) => ({ id: n.node, p: num(n.pagerank) }))
        .sort((a, b) => b.p - a.p)
        .findIndex((n) => n.id === id) + 1,
      total_entities: nodeRows.length,
      top_districts: String(node.top_districts || "").split(";").map((s) => s.trim()).filter(Boolean),
      community: comm ? {
        community_id: num(comm.community_id), theme: comm.theme,
        description: comm.description, size: num(comm.size),
      } : null,
      neighbour_count: neighbours.length,
      neighbours: neighbours.slice(0, 40),
      rules,
      interpretation: `${id} appears in ${num(node.cases).toLocaleString()} FIRs and shares cases with `
        + `${neighbours.length} other entities. Connection strength = number of FIRs in which both appear.`,
    }, "real");
  }));

  /**
   * GET /network/matrix?rows=&cols=
   * Crime type x legal act grid — the readable alternative to the force graph.
   *
   * A force layout cannot render this data well: IPC 1860 appears in 77.8% of all FIRs with 292
   * connections, so every physics layout collapses into a starburst around it and labels collide.
   * A matrix has none of those problems — fixed positions, zero overlap, identical every load, and
   * it answers the operational question directly: "for THIS offence, which acts usually apply?"
   *
   * Cell value = share of that crime type's cases which also cite that act.
   */
  router.get("/network/matrix", asyncH(async (req, res) => {
    const [nodeRows, edgeRows] = await Promise.all([
      getTable("network_nodes", req.ctx),
      getTable("network_edges", req.ctx),
    ]);
    const nRows = Math.min(Math.max(parseInt(req.query.rows, 10) || 16, 4), 40);
    const nCols = Math.min(Math.max(parseInt(req.query.cols, 10) || 12, 4), 30);

    const byId = new Map(nodeRows.map((n) => [n.node, n]));
    const heads = nodeRows.filter((n) => n.node_type === "crime_head")
      .sort((a, b) => num(b.cases) - num(a.cases)).slice(0, nRows);
    const acts = nodeRows.filter((n) => n.node_type === "act")
      .sort((a, b) => num(b.cases) - num(a.cases)).slice(0, nCols);

    const headSet = new Set(heads.map((h) => h.node));
    const actSet = new Set(acts.map((a) => a.node));

    // pair weights, direction-agnostic
    const pair = new Map();
    for (const e of edgeRows) {
      let head = null, act = null;
      if (headSet.has(e.src) && actSet.has(e.dst)) { head = e.src; act = e.dst; }
      else if (headSet.has(e.dst) && actSet.has(e.src)) { head = e.dst; act = e.src; }
      if (head) pair.set(`${head}|${act}`, num(e.weight));
    }

    const cells = [];
    heads.forEach((h, ri) => {
      acts.forEach((a, ci) => {
        const w = pair.get(`${h.node}|${a.node}`) || 0;
        const hc = num(h.cases);
        cells.push({
          row: ri, col: ci,
          crime_head: h.node, act: a.node,
          cases: w,
          share: hc ? +(w / hc).toFixed(4) : 0,   // share of THIS crime's cases citing the act
        });
      });
    });

    res.sendOk({
      rows: heads.map((h) => ({ id: h.node, cases: num(h.cases) })),
      cols: acts.map((a) => ({ id: a.node, cases: num(a.cases) })),
      cells,
      coverage: {
        crime_heads_shown: heads.length,
        acts_shown: acts.length,
        note: "Rows and columns are the highest-volume crime types and acts. Cell shading = the "
          + "share of that crime type's FIRs which also cite that act.",
      },
    }, "real");
  }));

  router.get("/network/communities", asyncH(async (req, res) => {
    const rows = await getTable("network_communities", req.ctx);
    const m = readNetworkMetrics();
    const communities = rows
      .map((r) => ({
        community_id: num(r.community_id),
        size: num(r.size),
        n_crime_heads: num(r.n_crime_heads),
        n_acts: num(r.n_acts),
        total_cases: num(r.total_cases),
        top_entity: r.top_entity,
        theme: r.theme,
        description: r.description,
        members: String(r.members || "").split(";").map((s) => s.trim()).filter(Boolean),
        top_districts: String(r.top_districts || "").split(";").map((s) => s.trim()).filter(Boolean),
      }))
      .sort((a, b) => b.total_cases - a.total_cases);
    res.sendOk({
      count: communities.length,
      modularity: m.communities.modularity,
      algorithm: m.communities.algorithm,
      communities,
    }, "real");
  }));

  router.get("/network/rules", asyncH(async (req, res) => {
    const rows = await getTable("association_rules", req.ctx);
    const type = safeDecode(req.query.type);
    const q = (safeDecode(req.query.q) || "").trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 300);
    let rules = rows.map((r) => ({
      rule_type: r.rule_type,
      antecedent: r.antecedent, antecedent_type: r.antecedent_type,
      consequent: r.consequent, consequent_type: r.consequent_type,
      cases: num(r.cases),
      support: num(r.support),
      confidence: num(r.confidence),
      lift: num(r.lift),
      reading: r.reading,
    }));
    if (type) rules = rules.filter((r) => r.rule_type === type);
    if (q) {
      rules = rules.filter((r) => r.antecedent.toLowerCase().includes(q)
        || r.consequent.toLowerCase().includes(q));
    }
    rules.sort((a, b) => b.lift - a.lift || b.cases - a.cases);
    res.sendOk({
      total: rules.length,
      showing: Math.min(limit, rules.length),
      by_type: {
        co_occurrence: rules.filter((r) => r.rule_type === "co_occurrence").length,
        spatial_affinity: rules.filter((r) => r.rule_type === "spatial_affinity").length,
      },
      rules: rules.slice(0, limit),
      note: "Association rules are statistical co-occurrence between CASE ATTRIBUTES — "
        + "not causal links and not relationships between people.",
    }, "real");
  }));
};
