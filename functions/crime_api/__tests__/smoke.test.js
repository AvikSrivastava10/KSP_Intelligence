"use strict";
const request = require("supertest");
const app = require("../src/index");

describe("crime_api smoke (CSV fallback)", () => {
  test("GET /health -> ok", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data_class).toBe("real");
    expect(r.body.request_id).toBeTruthy();
  });

  test("GET /meta -> provenance", async () => {
    const r = await request(app).get("/meta");
    expect(r.status).toBe(200);
    expect(r.body.result.total_rows_processed).toBe(1674734);
    expect(r.body.result.data_class).toBeTruthy();
  });

  test("GET /overview -> real KPIs", async () => {
    const r = await request(app).get("/overview");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data_class).toBe("real");
    expect(r.body.result.total_firs).toBe(1674734);
    expect(r.body.result.districts_covered).toBe(31);
    expect(r.body.result.rates.conviction_rate).toBeGreaterThan(0);
  });

  test("GET /districts -> 31 geographic districts joined on kgis_code", async () => {
    const r = await request(app).get("/districts");
    expect(r.body.result.count).toBe(31);
    const d = r.body.result.districts[0];
    expect(d.kgis_code).toBeTruthy();
    expect(d.total_cases).toBeGreaterThan(0);
  });

  test("GET /district/:id -> drill-down (Mysuru aggregates city + district)", async () => {
    const r = await request(app).get("/district/Mysuru");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.members.length).toBeGreaterThanOrEqual(2);
    expect(r.body.result.yearly.length).toBeGreaterThan(0);
    expect(r.body.result.categories.length).toBeGreaterThan(0);
    expect(r.body.result.outcomes.total_cases).toBeGreaterThan(0);
  });
});

describe("crime_api Phase 2 geospatial (CSV fallback)", () => {
  test("GET /hotspots?year=2023 -> real cells, NO district-centroid (accuracy guard)", async () => {
    const r = await request(app).get("/hotspots?year=2023");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data_class).toBe("real");
    expect(Array.isArray(r.body.result.cells)).toBe(true);
    expect(r.body.result.cells.length).toBeGreaterThan(0);
    const precs = new Set(r.body.result.cells.map((c) => c.geo_precision));
    expect(precs.has("district")).toBe(false);
    expect(precs.has("none")).toBe(false);
  });

  test("GET /hotspots?precision=point -> filter returns only that precision", async () => {
    const r = await request(app).get("/hotspots?year=2023&precision=point");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.cells.length).toBeGreaterThan(0);
    expect(r.body.result.cells.every((c) => c.geo_precision === "point")).toBe(true);
  });

  test("GET /hotspots/timed -> REAL time+location only, night/day separable", async () => {
    const r = await request(app).get("/hotspots/timed");
    expect(r.status).toBe(200);
    expect(r.body.data_class).toBe("real");
    expect(r.body.result.total_incidents).toBeGreaterThan(0);
    // both real buckets present, and ONLY real ones (no criminological-prior buckets)
    const buckets = Object.keys(r.body.result.by_bucket).sort();
    expect(buckets).toEqual(["Daytime", "Night"]);
    expect(r.body.result.coverage_note).toMatch(/2\.6%|assumption as observation/i);
  });

  test("GET /hotspots/timed?bucket=Night -> filtered to night incidents", async () => {
    const r = await request(app).get("/hotspots/timed?bucket=Night");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.cells.every((c) => c.time_bucket === "Night")).toBe(true);
    expect(r.body.result.cells.length).toBeGreaterThan(0);
  });

  test("GET /hotspots/clusters -> clusters with deployment notes", async () => {
    const r = await request(app).get("/hotspots/clusters?limit=10");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.clusters.length).toBeGreaterThan(0);
    expect(r.body.result.clusters[0].deployment_note).toBeTruthy();
    expect(r.body.result.clusters[0].total_count).toBeGreaterThan(0);
  });

  test("GET /stations?district=Mysuru -> station points with numeric coords", async () => {
    const r = await request(app).get("/stations?district=Mysuru");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.stations.length).toBeGreaterThan(0);
    expect(typeof r.body.result.stations[0].mean_lat).toBe("number");
  });

  test("GET /timeofday -> data_class MODELED + labelled buckets", async () => {
    const r = await request(app).get("/timeofday");
    expect(r.body.ok).toBe(true);
    expect(r.body.data_class).toBe("modeled");
    expect(r.body.result.buckets.length).toBeGreaterThan(0);
    expect(r.body.result.note).toMatch(/not observed/i);
  });
});

describe("crime_api Phase 3 predictive (CSV fallback)", () => {
  test("GET /forecast (state) -> history + forecast points with CI", async () => {
    const r = await request(app).get("/forecast?level=state");
    expect(r.status).toBe(200);
    expect(r.body.data_class).toBe("real");
    const pts = r.body.result.points;
    expect(pts.length).toBeGreaterThan(12);
    const hist = pts.filter((p) => p.is_forecast === 0);
    const fc = pts.filter((p) => p.is_forecast === 1);
    expect(hist.length).toBeGreaterThan(0);
    expect(fc.length).toBe(12);
    expect(fc[0].yhat).toBeGreaterThan(0);
    expect(fc[0].yhat_upper).toBeGreaterThanOrEqual(fc[0].yhat);
    expect(fc[0].yhat_lower).toBeLessThanOrEqual(fc[0].yhat);
    expect(hist[0].y_actual).toBeGreaterThan(0);
  });

  test("GET /forecast/options -> selectable districts + categories", async () => {
    const r = await request(app).get("/forecast/options");
    expect(r.body.result.districts.length).toBe(31);
    expect(r.body.result.categories.length).toBeGreaterThanOrEqual(10);
  });

  test("GET /forecast?level=district -> district projection", async () => {
    const r = await request(app).get("/forecast?level=district&key=Bengaluru%20Urban");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.points.filter((p) => p.is_forecast === 1).length).toBe(12);
  });

  test("GET /forecast?level=district with NO key -> resolves to a single series (12 fc pts)", async () => {
    const r = await request(app).get("/forecast?level=district");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.key).toBeTruthy(); // defaulted to first district
    expect(r.body.result.points.filter((p) => p.is_forecast === 1).length).toBe(12);
    // exactly one series -> at most one row per (year,month)
    const ym = r.body.result.points.map((p) => `${p.year}-${p.month}`);
    expect(new Set(ym).size).toBe(ym.length);
  });

  test("GET /alerts -> red-zones sorted, red before amber", async () => {
    const r = await request(app).get("/alerts");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.alerts.length).toBeGreaterThan(0);
    expect(r.body.result.red).toBeGreaterThan(0);
    const sevs = r.body.result.alerts.map((a) => a.severity);
    expect(sevs.indexOf("red")).toBeLessThanOrEqual(sevs.lastIndexOf("red"));
    if (sevs.includes("amber")) expect(sevs.lastIndexOf("red")).toBeLessThan(sevs.indexOf("amber"));
  });

  test("GET /risk -> 31 districts, tiers, sorted by score", async () => {
    const r = await request(app).get("/risk");
    expect(r.body.result.count).toBe(31);
    expect(r.body.result.districts[0].risk_score).toBeGreaterThanOrEqual(r.body.result.districts[1].risk_score);
    expect(r.body.result.districts[0].risk_tier).toBeTruthy();
  });

  test("GET /risk/:id -> drivers array (fairness-safe)", async () => {
    const r = await request(app).get("/risk/Bengaluru%20Urban");
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.result.drivers)).toBe(true);
    expect(r.body.result.drivers.length).toBeGreaterThan(0);
    // never expose protected-attribute drivers
    const joined = r.body.result.drivers.join(" ").toLowerCase();
    expect(joined).not.toMatch(/caste|religion|sex|sc_share|st_share/);
  });

  test("GET /anomalies -> flagged spikes sorted by score", async () => {
    const r = await request(app).get("/anomalies?limit=20");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.anomalies.length).toBeGreaterThan(0);
    expect(r.body.result.anomalies[0].count).toBeGreaterThan(r.body.result.anomalies[0].expected);
  });
});

describe("crime_api Phase 4 patterns / MO / outcomes (CSV fallback)", () => {
  test("GET /patterns/mo-clusters -> clusters sorted by size, with descriptions + members", async () => {
    const r = await request(app).get("/patterns/mo-clusters");
    expect(r.status).toBe(200);
    expect(r.body.data_class).toBe("real");
    const cl = r.body.result.clusters;
    expect(cl.length).toBeGreaterThan(0);
    expect(cl[0].size).toBeGreaterThanOrEqual(cl[1].size); // sorted desc
    expect(cl[0].mo_description).toBeTruthy();
    expect(Array.isArray(cl[0].top_districts)).toBe(true);
    expect(Array.isArray(cl[0].members)).toBe(true);
    expect(r.body.result.note).toMatch(/modeled/i); // time-of-day honesty note
  });

  test("GET /patterns/temporal -> 84-cell dow x month grid + peak call-out", async () => {
    const r = await request(app).get("/patterns/temporal");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.cells.length).toBe(84); // 7 dow x 12 months
    expect(r.body.result.dow_labels.length).toBe(7);
    expect(r.body.result.month_labels.length).toBe(12);
    expect(r.body.result.peak.count).toBeGreaterThan(0);
    expect(r.body.result.callout).toMatch(/peak/i);
    expect(r.body.result.total).toBeGreaterThan(0);
  });

  test("GET /patterns/temporal?district=Mysuru -> filtered grid (smaller total)", async () => {
    const all = await request(app).get("/patterns/temporal");
    const one = await request(app).get("/patterns/temporal?district=Mysuru");
    expect(one.body.ok).toBe(true);
    expect(one.body.result.total).toBeGreaterThan(0);
    expect(one.body.result.total).toBeLessThan(all.body.result.total);
  });

  test("GET /outcomes -> 31 geographic districts + statewide roll-up", async () => {
    const r = await request(app).get("/outcomes");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.count).toBe(31);
    expect(r.body.result.districts[0].detection_rate).toBeGreaterThan(0);
    expect(r.body.result.statewide.conviction_rate).toBeGreaterThan(0);
  });

  test("GET /patterns/temporal?district=Mysuru City -> rolls up to parent Mysuru", async () => {
    const city = await request(app).get("/patterns/temporal?district=Mysuru%20City");
    const parent = await request(app).get("/patterns/temporal?district=Mysuru");
    expect(city.body.ok).toBe(true);
    expect(city.body.result.district).toBe("Mysuru");
    expect(city.body.result.total).toBe(parent.body.result.total);
  });

  test("GET /outcomes/drivers -> importances (associations) + honest AUC, no leakage/protected features", async () => {
    const r = await request(app).get("/outcomes/drivers");
    expect(r.body.ok).toBe(true);
    const d = r.body.result.drivers;
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].importance_detection_pct).toBeGreaterThanOrEqual(d[1].importance_detection_pct);
    // honest, non-leaky headline
    expect(r.body.result.binary_detection.auc_mean).toBeGreaterThan(0.5);
    expect(r.body.result.binary_detection.auc_mean).toBeLessThan(0.99);
    expect(r.body.result.leakage_check.flagged).toBe(false);
    // no outcome-derived or protected features exposed as drivers
    const feats = d.map((x) => x.feature).join(" ");
    expect(feats).not.toMatch(/arrested|chargesheet|conviction_count|v_male|v_female|v_boy|v_girl/);
  });
});

describe("crime_api Phase 5 network + socio-economic (CSV fallback)", () => {
  test("GET /network/entity -> nodes + edges, no dangling edges", async () => {
    const r = await request(app).get("/network/entity?limit=120");
    expect(r.status).toBe(200);
    expect(r.body.data_class).toBe("real");
    const { nodes, edges } = r.body.result;
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.length).toBeLessThanOrEqual(120);
    expect(edges.length).toBeGreaterThan(0);
    // every edge endpoint must exist in the returned node set
    const ids = new Set(nodes.map((n) => n.id));
    expect(edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    // entity graph only — never persons
    expect(new Set(nodes.map((n) => n.node_type))).toEqual(new Set(["crime_head", "act"]));
    expect(r.body.result.scope).toMatch(/not a person network/i);
  });

  test("GET /network/entity?community= -> filtered to one community", async () => {
    const r = await request(app).get("/network/entity?community=0&limit=200");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.nodes.every((n) => n.community_id === 0)).toBe(true);
  });

  test("GET /network/communities -> meaningful modularity + themed clusters", async () => {
    const r = await request(app).get("/network/communities");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.modularity).toBeGreaterThan(0.3); // meaningful structure
    const c = r.body.result.communities;
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].total_cases).toBeGreaterThanOrEqual(c[1].total_cases);
    expect(c[0].description).toBeTruthy();
    expect(Array.isArray(c[0].members)).toBe(true);
  });

  test("GET /network/rules -> lift>1, sorted, both rule types present", async () => {
    const r = await request(app).get("/network/rules?limit=50");
    expect(r.body.ok).toBe(true);
    const rules = r.body.result.rules;
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((x) => x.lift > 1)).toBe(true);
    expect(rules[0].lift).toBeGreaterThanOrEqual(rules[1].lift);
    expect(r.body.result.by_type.co_occurrence).toBeGreaterThan(0);
    expect(r.body.result.by_type.spatial_affinity).toBeGreaterThan(0);
    expect(r.body.result.note).toMatch(/not.*people/i);
  });

  test("GET /network/rules?type=spatial_affinity -> filtered", async () => {
    const r = await request(app).get("/network/rules?type=spatial_affinity&limit=10");
    expect(r.body.result.rules.every((x) => x.rule_type === "spatial_affinity")).toBe(true);
  });

  test("GET /network/entities -> ALL entities browsable, searchable, sortable", async () => {
    const all = await request(app).get("/network/entities?limit=5");
    expect(all.body.result.total).toBe(483);           // every entity reachable, not a capped slice
    expect(all.body.result.entities.length).toBe(5);
    expect(all.body.result.type_counts.crime_head).toBeGreaterThan(0);
    expect(all.body.result.type_counts.act).toBeGreaterThan(0);
    const q = await request(app).get("/network/entities?q=cyber");
    expect(q.body.result.total).toBeGreaterThan(0);
    expect(q.body.result.entities.every((e) => /cyber/i.test(e.id))).toBe(true);
    const typed = await request(app).get("/network/entities?type=crime_head&limit=5");
    expect(typed.body.result.entities.every((e) => e.node_type === "crime_head")).toBe(true);
    const sorted = await request(app).get("/network/entities?sort=cases&limit=5");
    expect(sorted.body.result.entities[0].cases).toBeGreaterThanOrEqual(sorted.body.result.entities[1].cases);
  });

  test("GET /network/entity/:id -> full neighbours + rules (no truncated edge set)", async () => {
    const r = await request(app).get("/network/entity/CYBER%20CRIME");
    expect(r.status).toBe(200);
    const d = r.body.result;
    expect(d.cases).toBeGreaterThan(0);
    expect(d.neighbour_count).toBeGreaterThan(0);
    expect(d.neighbours[0].weight).toBeGreaterThanOrEqual(d.neighbours[1].weight);
    // the interpretable number: share of this entity's cases involving the neighbour
    expect(d.neighbours[0].share_of_entity).toBeGreaterThan(0);
    expect(d.neighbours[0].share_of_entity).toBeLessThanOrEqual(1);
    expect(d.rank_by_pagerank).toBeGreaterThan(0);
    expect(d.community).toBeTruthy();
    expect(Array.isArray(d.rules)).toBe(true);
  });

  test("every entity has neighbours (regression: edge CSV was truncated to top 400)", async () => {
    // 302/483 entities previously had zero edges shipped, so they could not be inspected at all
    for (const id of ["EXPLOSIVES", "CONSUMER", "DOWRY DEATHS"]) {
      const r = await request(app).get(`/network/entity/${encodeURIComponent(id)}`);
      expect(r.status).toBe(200);
      expect(r.body.result.neighbour_count).toBeGreaterThan(0);
    }
  });

  test("GET /network/entity?focus= -> ego network of one entity", async () => {
    const r = await request(app).get("/network/entity?focus=CYBER%20CRIME");
    expect(r.body.ok).toBe(true);
    const ids = r.body.result.nodes.map((n) => n.id);
    expect(ids).toContain("CYBER CRIME");
    expect(ids.length).toBeLessThan(60);               // focused, not the whole graph
  });

  test("GET /network/rules?q= -> searchable rules", async () => {
    const r = await request(app).get("/network/rules?q=cyber&limit=20");
    expect(r.body.ok).toBe(true);
    expect(r.body.result.rules.every((x) => /cyber/i.test(x.antecedent) || /cyber/i.test(x.consequent))).toBe(true);
  });

  test("GET /socio -> protected attributes segregated + caveated", async () => {
    const r = await request(app).get("/socio");
    expect(r.status).toBe(200);
    expect(r.body.data_class).toBe("real");
    const { socioeconomic, sensitive } = r.body.result.correlations;
    expect(socioeconomic.length).toBeGreaterThan(0);
    expect(sensitive.length).toBeGreaterThan(0);
    // no protected attribute may leak into the non-sensitive group
    expect(socioeconomic.every((x) => x.is_protected === false)).toBe(true);
    expect(sensitive.every((x) => x.is_protected === true)).toBe(true);
    // every sensitive indicator must ship a caveat
    expect(sensitive.every((x) => typeof x.caveat === "string" && x.caveat.length > 40)).toBe(true);
    expect(r.body.result.ethics.not_model_features).toMatch(/risk\.py/i);
    expect(r.body.result.districts.length).toBe(30);
  });

  test("GET /socio -> reporting caveat is stated (FIRs != offending)", async () => {
    const r = await request(app).get("/socio");
    expect(r.body.result.ethics.reporting_caveat).toMatch(/reported/i);
    expect(r.body.result.headline).toBeTruthy();
    expect(r.body.result.protected_attributes_finding).toBeTruthy();
  });
});

describe("crime_api ground-truth validation (proof of concept)", () => {
  test("GET /validation -> every test scored against a baseline, none below it", async () => {
    const r = await request(app).get("/validation");
    expect(r.status).toBe(200);
    expect(r.body.data_class).toBe("real");
    const t = r.body.result.tests;
    expect(t.length).toBeGreaterThanOrEqual(3);
    // every test must name a baseline and carry a verdict
    expect(t.every((x) => x.baseline_name && x.verdict)).toBe(true);
    expect(t.every((x) => ["beats_baseline", "matches_baseline", "below_baseline"].includes(x.verdict))).toBe(true);
    // no shipped model may be BELOW its naive baseline
    expect(t.filter((x) => x.verdict === "below_baseline").length).toBe(0);
    expect(r.body.result.tests_at_or_above_baseline).toBe(t.length);
  });

  test("GET /validation -> forecast genuinely beats persistence on unseen 2024", async () => {
    const r = await request(app).get("/validation");
    const t1 = r.body.result.tests.find((x) => x.test.startsWith("T1"));
    expect(t1).toBeTruthy();
    expect(t1.verdict).toBe("beats_baseline");
    expect(t1.value).toBeLessThan(t1.baseline_value); // lower MAPE is better
    expect(t1.value).toBeLessThan(15);
  });

  test("GET /validation -> declares its ground-truth sources and exclusions", async () => {
    const r = await request(app).get("/validation");
    expect(r.body.result.ground_truth_sources.out_of_source).toMatch(/2025/);
    expect(r.body.result.exclusions_and_why.march_2024).toMatch(/truncat|cut mid/i);
    expect(r.body.result.honesty).toMatch(/baseline/i);
  });
});

describe("crime_api Phase 6 Strategic Hub + audit", () => {
  test("GET /hub -> cross-model synthesis, priority sorted, converging districts flagged", async () => {
    const r = await request(app).get("/hub");
    expect(r.status).toBe(200);
    expect(r.body.data_class).toBe("real");
    const p = r.body.result.priority;
    expect(p.districts.length).toBeGreaterThan(0);
    // sorted by priority (signals dominate)
    expect(p.districts[0].signals).toBeGreaterThanOrEqual(p.districts[1].signals);
    // converging = flagged by ALL THREE models; must be a usable shortlist, not most of the state
    expect(p.converging_count).toBeGreaterThan(0);
    expect(p.converging_count).toBeLessThan(p.total_districts * 0.6);
    expect(p.signal_breakdown.three).toBe(p.converging_count);
    expect(p.districts[0].kgis_code).toBeTruthy();
    expect(r.body.result.forecast.direction).toMatch(/rising|falling|unknown/);
    expect(r.body.result.deployments.length).toBeGreaterThan(0);
    expect(r.body.result.deployments[0].deployment_note).toBeTruthy();
  });

  test("GET /audit -> publishes limitations, fairness exclusions and model cards", async () => {
    const r = await request(app).get("/audit");
    expect(r.status).toBe(200);
    expect(r.body.result.coverage.reconciles_to_source).toBe(true);
    expect(r.body.result.coverage.total_records).toBe(1674734);
    // must state what it cannot do
    expect(r.body.result.limitations.length).toBeGreaterThanOrEqual(4);
    expect(r.body.result.limitations.some((l) => /person/i.test(l.item))).toBe(true);
    // fairness exclusions must name the protected attributes
    const excl = r.body.result.fairness.excluded_from_all_models.join(" ").toLowerCase();
    expect(excl).toMatch(/caste/);
    expect(excl).toMatch(/religion/);
    expect(excl).toMatch(/sex/);
    // every model carries a metric + data class
    expect(r.body.result.models.length).toBeGreaterThanOrEqual(10);
    expect(r.body.result.models.every((m) => m.metric && m.data_class)).toBe(true);
    expect(r.body.result.models.some((m) => m.data_class === "modeled")).toBe(true);
    // synthetic data now exists (person demo) — the audit must scope it, not deny it
    expect(r.body.result.synthetic_data).toMatch(/syn_|synthetic/i);
    expect(r.body.result.synthetic_data).toMatch(/never trains|never joined/i);
  });
});

describe("crime_api person network (SYNTHETIC demo plane)", () => {
  test("GET /network/persons -> data_class synthetic + banner, ids are SYN-*", async () => {
    const r = await request(app).get("/network/persons");
    expect(r.status).toBe(200);
    // the single most important assertion in this file: this data must NEVER read as real
    expect(r.body.data_class).toBe("synthetic");
    expect(r.body.result.banner).toMatch(/synthetic/i);
    expect(r.body.result.banner).toMatch(/no real individual/i);
    const { nodes, edges } = r.body.result;
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => n.id.startsWith("SYN-"))).toBe(true);
    // no dangling edges
    const ids = new Set(nodes.map((n) => n.id));
    expect(edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    // both PS relationship types present: co-accused AND accused<->victim
    const kinds = new Set(edges.map((e) => e.edge_type));
    expect(kinds.has("co_accused")).toBe(true);
    expect(kinds.has("accused_victim")).toBe(true);
  });

  test("GET /network/persons/offenders -> repeat offenders across jurisdictions", async () => {
    const r = await request(app).get("/network/persons/offenders?limit=10");
    expect(r.body.data_class).toBe("synthetic");
    const p = r.body.result.profiles;
    expect(p.length).toBeGreaterThan(0);
    expect(p[0].n_cases).toBeGreaterThanOrEqual(2);          // "repeat" means >1 case
    expect(r.body.result.cross_jurisdiction).toBeGreaterThan(0);
    expect(p[0].mo_summary).toBeTruthy();                     // MO across jurisdictions
    expect(p[0].n_districts).toBeGreaterThanOrEqual(p[1].n_districts);
  });

  test("GET /network/linkage -> real PPRL engine card, honest about its testbed", async () => {
    const r = await request(app).get("/network/linkage");
    expect(r.body.ok).toBe(true);
    const v = r.body.result.validation;
    expect(v.pairwise_precision).toBeGreaterThan(0.9);
    expect(v.pairwise_recall).toBeGreaterThan(0.9);
    expect(v.ground_truth).toMatch(/synthetic/i);             // must not overclaim
    expect(r.body.result.deployment).toMatch(/perimeter/i);   // identities never leave KSP
  });

  test("synthetic plane never leaks into REAL endpoints", async () => {
    // any real payload containing a SYN- id would mean the planes got mixed
    for (const url of ["/network/entity", "/districts", "/hub", "/patterns/mo-clusters", "/outcomes"]) {
      const r = await request(app).get(url);
      expect(r.body.data_class).not.toBe("synthetic");
      expect(JSON.stringify(r.body.result)).not.toMatch(/SYN-/);
    }
  });
});

describe("crime_api hardening (audit regressions)", () => {
  test("malformed percent-encoding -> 400 (not 500)", async () => {
    const r = await request(app).get("/district/%ZZ");
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
  });

  test("oversized x-request-id is NOT echoed back (fresh UUID instead)", async () => {
    const big = "A".repeat(5000);
    const r = await request(app).get("/health").set("x-request-id", big);
    expect(r.status).toBe(200);
    expect(r.headers["x-request-id"]).not.toBe(big);
    expect(r.headers["x-request-id"].length).toBeLessThanOrEqual(64);
  });

  test("well-formed x-request-id IS honoured", async () => {
    const r = await request(app).get("/health").set("x-request-id", "trace-123.abc");
    expect(r.headers["x-request-id"]).toBe("trace-123.abc");
    expect(r.body.request_id).toBe("trace-123.abc");
  });

  test("injection-ish query params are inert (JS-side filtering only)", async () => {
    const r = await request(app).get("/patterns/temporal?district=%27%3B%20DROP%20TABLE%20x%3B--");
    expect(r.status).toBe(200);
    expect(r.body.result.total).toBe(0);
    expect(r.body.result.callout).toMatch(/no records/i);
  });

  test("limit params clamp: huge -> capped, negative -> 1, NaN -> default", async () => {
    const huge = await request(app).get("/anomalies?limit=999999");
    expect(huge.body.result.showing).toBeLessThanOrEqual(500);
    const neg = await request(app).get("/anomalies?limit=-5");
    expect(neg.body.result.showing).toBe(1);
    const nan = await request(app).get("/hotspots/clusters?limit=abc");
    expect(nan.body.result.showing).toBeLessThanOrEqual(60);
  });
});

describe("Catalyst service integration", () => {
  test("GET /health declares which Catalyst service serves each concern", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    const s = r.body.result;
    // storage, cache and throttling must each be REPORTED, so a misconfigured deploy is visible
    // here rather than discovered mid-demo.
    expect(s.backend.storage).toMatch(/^(bundled_tables|catalyst_datastore)$/);
    expect(s.backend.data_is_real).toBe(true);
    expect(s.cache.service).toBe("catalyst_cache");
    expect(typeof s.cache.active).toBe("boolean");
    expect(s.throttling.enforced_by).toMatch(/^(catalyst_api_gateway|in_process)$/);
  });

  test("response cache never serves a stale request_id", async () => {
    // request_id is per-request tracing; caching it would make two different requests
    // indistinguishable in the logs.
    const a = await request(app).get("/overview");
    const b = await request(app).get("/overview");
    expect(a.body.request_id).not.toBe(b.body.request_id);
    expect(a.body.result.total_firs).toBe(b.body.result.total_firs);
  });

  test("throttling is never simply absent — one layer always owns it", async () => {
    const r = await request(app).get("/health");
    const t = r.body.result.throttling;
    // If the gateway is not fronting the function, the in-process limiter must still be active.
    if (t.enforced_by === "in_process") expect(t.requests_per_window).toBeGreaterThan(0);
  });
});

describe("intelligence briefing export (SmartBrowz)", () => {
  test("GET /report/briefing renders a briefing and names its renderer", async () => {
    const r = await request(app).get("/report/briefing");
    expect(r.status).toBe(200);
    // Off-platform SmartBrowz is unavailable, so the route must degrade to source HTML rather
    // than 500 — and must say which renderer produced the output either way.
    expect(r.headers["x-report-renderer"]).toMatch(/^(catalyst-smartbrowz|html-fallback)$/);
  });

  test("briefing carries the figures, the shortlist AND the caveats", async () => {
    const r = await request(app).get("/report/briefing?format=html");
    expect(r.headers["x-report-renderer"]).toBe("html-source");
    const html = r.text;
    expect(html).toMatch(/Crime Intelligence Briefing/);
    expect(html).toMatch(/Priority districts/);
    expect(html).toMatch(/Priority deployment areas/);
    expect(html).toMatch(/Ground-truth validation/);
    // a briefing that omits its own limits is the failure mode this project guards against
    expect(html).toMatch(/reported<\/i> crime|measure <i>reported/);
    expect(html).toMatch(/never used as model features/);
    expect(html).toMatch(/2024 is a partial year/);
  });

  test("briefing convergence shortlist agrees with /hub (same rule, one source of truth)", async () => {
    const hub = await request(app).get("/hub");
    const html = (await request(app).get("/report/briefing?format=html")).text;
    const rows = (html.match(/<td><b>[A-Za-z .]+<\/b><\/td>/g) || []).length;
    expect(rows).toBe(hub.body.result.priority.converging_count);
  });

  test("briefing escapes interpolated table content", async () => {
    const html = (await request(app).get("/report/briefing?format=html")).text;
    // no unescaped angle brackets inside cell text (would mean an injection path into the PDF)
    expect(html).not.toMatch(/<td>[^<]*<script/i);
  });
});

describe("Catalyst service map (published on /audit)", () => {
  test("GET /audit lists each capability, its service and a live status", async () => {
    const r = await request(app).get("/audit");
    const svc = r.body.result.catalyst_services;
    expect(Array.isArray(svc)).toBe(true);
    expect(svc.length).toBeGreaterThanOrEqual(8);
    expect(svc.every((s) => s.capability && s.service && s.status && s.detail)).toBe(true);
    expect(svc.every((s) => ["active", "configured", "disabled", "no_catalyst_equivalent"].includes(s.status))).toBe(true);
    // the four core services must be named explicitly
    const names = svc.map((s) => s.service).join(" | ");
    expect(names).toMatch(/Catalyst Functions/);
    expect(names).toMatch(/Web Client Hosting/);
    expect(names).toMatch(/Data Store/);
    expect(names).toMatch(/Catalyst Cache/);
    expect(names).toMatch(/SmartBrowz/);
  });

  test("custom components declare WHY no Catalyst service applies", async () => {
    const r = await request(app).get("/audit");
    const custom = r.body.result.catalyst_services.filter((s) => s.status === "no_catalyst_equivalent");
    expect(custom.length).toBeGreaterThan(0);
    // an unexplained substitution is the thing a reviewer would object to, so each must argue itself
    for (const c of custom) expect(c.detail.length).toBeGreaterThan(60);
    expect(custom.map((c) => c.detail).join(" ")).toMatch(/AutoML|QuickML|no client-side/i);
  });
});
