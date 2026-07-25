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
