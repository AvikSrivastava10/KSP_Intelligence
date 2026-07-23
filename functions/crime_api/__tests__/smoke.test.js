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
