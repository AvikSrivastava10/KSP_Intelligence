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
