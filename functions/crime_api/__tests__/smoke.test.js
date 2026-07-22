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
