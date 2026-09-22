"use strict";
/**
 * Catalyst service paths, exercised against a MOCKED zcatalyst-sdk-node.
 *
 * WHAT THIS PROVES, AND WHAT IT CANNOT
 * Data Store reads, Catalyst Cache and SmartBrowz all need a Catalyst request context, so off
 * platform they report their fallback state by design — which means the smoke suite never executes
 * a single line of the ON-platform branches. Those branches were therefore completely untested, and
 * the first time they would ever run was in front of a judge.
 *
 * This file stands in a fake SDK shaped like the documented one and drives the real branches:
 * pagination and column unwrapping, per-table fallback, cache hit/miss/error, PDF buffering and
 * streaming, and the render-failure degrade.
 *
 * It CANNOT prove the docs match Zoho's runtime — only a deploy does that. It proves that IF the
 * SDK behaves as documented, our code handles it, including the failure modes. That is the half of
 * the risk which is ours to own.
 *
 * Env is set BEFORE requiring the app because store.js reads USE_DATASTORE at module load, and jest
 * gives each test file its own module registry.
 */
// process.env is SHARED across test files under --runInBand, so these are captured and restored in
// afterAll. Without that, whichever suite runs second inherits an on-platform configuration it never
// asked for — and the off-platform assertions in smoke.test.js would pass or fail on file order.
const ENV_UNDER_TEST = {
  USE_DATASTORE: "true",
  USE_CATALYST_CACHE: "true",
  CACHE_TTL_HOURS: "1",
};
const ENV_BEFORE = Object.fromEntries(
  Object.keys(ENV_UNDER_TEST).map((k) => [k, process.env[k]])
);
Object.assign(process.env, ENV_UNDER_TEST);
afterAll(() => {
  for (const [k, v] of Object.entries(ENV_BEFORE)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// This suite loads the app with a mocked Catalyst SDK. Clear a previously loaded app module
// (for example, from smoke.test.js) so its module-level configuration cannot leak into this
// suite when Jest chooses a different test-file order.
jest.resetModules();

// --- the fake SDK, swappable per test ---
const state = {
  zcqlRows: {},          // table -> rows to serve
  zcqlThrowFor: new Set(),
  queries: [],           // every ZCQL string issued
  cacheStore: new Map(),
  cachePuts: [],
  cacheGetThrows: false,
  pdf: null,             // what convertToPdf resolves to
  pdfThrows: false,
  pdfCalls: [],
};

const fakeApp = {
  zcql: () => ({
    executeZCQLQuery: async (q) => {
      state.queries.push(q);
      const table = /FROM\s+(\w+)/i.exec(q)[1];
      if (state.zcqlThrowFor.has(table)) throw new Error("zcql exploded");
      const rows = state.zcqlRows[table] || [];
      const m = /LIMIT\s+(\d+),\s*(\d+)/i.exec(q);
      const offset = m ? +m[1] : 0;
      const size = m ? +m[2] : rows.length;
      // Mirror the real thing: each row's columns arrive wrapped under the table name.
      return rows.slice(offset, offset + size).map((r) => ({ [table]: r }));
    },
  }),
  cache: () => ({
    segment: () => ({
      getValue: async (k) => {
        if (state.cacheGetThrows) throw new Error("cache unreachable");
        return state.cacheStore.has(k) ? state.cacheStore.get(k) : null;
      },
      put: async (k, v, ttl) => { state.cachePuts.push({ k, v, ttl }); state.cacheStore.set(k, v); },
    }),
  }),
  smartbrowz: () => ({
    convertToPdf: async (source, opts) => {
      state.pdfCalls.push({ source, opts });
      if (state.pdfThrows) throw new Error("smartbrowz down");
      return state.pdf;
    },
  }),
};

// NOT { virtual: true }. That option is for modules which do not exist on disk, and
// zcatalyst-sdk-node is a real dependency. With `virtual` set, this file passed on its own and
// under parallel workers (one worker per file) but FAILED under `jest --runInBand` — the project's
// own npm test script and the Pipelines deploy gate. In a shared process smoke.test.js resolves the
// real module first, the virtual registration loses, initialize() throws on a non-Catalyst request,
// ctx.app becomes null, and every on-platform branch silently reverts to its off-platform fallback.
jest.mock("zcatalyst-sdk-node", () => ({ initialize: () => fakeApp }));

const request = require("supertest");
const app = require("../src/index");
const { getTable } = require("../src/lib/store");
const { cacheKey } = require("../src/lib/catalystCache");

const reset = () => {
  state.zcqlRows = {}; state.zcqlThrowFor = new Set(); state.queries = [];
  state.cacheStore = new Map(); state.cachePuts = []; state.cacheGetThrows = false;
  state.pdf = null; state.pdfThrows = false; state.pdfCalls = [];
};
beforeEach(reset);

describe("Catalyst Data Store read path", () => {
  const ctx = { app: fakeApp };

  test("unwraps ZCQL rows from their table envelope", async () => {
    state.zcqlRows.dim_district = [{ canonical_name: "Testville", kgis_code: "999" }];
    const rows = await getTable("dim_district", ctx);
    // If the unwrap were wrong we would get { dim_district: {...} } and every downstream
    // field read would silently be undefined rather than throwing.
    expect(rows[0].canonical_name).toBe("Testville");
    expect(rows[0].dim_district).toBeUndefined();
  });

  test("pages until a short page, without an infinite loop", async () => {
    state.zcqlRows.agg_outcomes = Array.from({ length: 700 }, (_, i) => ({ canonical_name: `D${i}` }));
    const rows = await getTable("agg_outcomes", ctx);
    expect(rows).toHaveLength(700);
    // 300 + 300 + 100 -> stops on the short page; a 4th query would mean the exit condition failed
    expect(state.queries).toHaveLength(3);
    expect(state.queries[0]).toMatch(/LIMIT 0, 300/);
    expect(state.queries[1]).toMatch(/LIMIT 300, 300/);
  });

  test("falls back to the bundled table PER TABLE when ZCQL throws", async () => {
    state.zcqlThrowFor.add("agg_outcomes");
    const rows = await getTable("agg_outcomes", ctx);
    // resilience over strictness: a Data Store hiccup must degrade to identical data
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].canonical_name).toBeTruthy();
  });

  test("an empty Data Store table falls back rather than serving nothing", async () => {
    state.zcqlRows.agg_outcomes = [];
    const rows = await getTable("agg_outcomes", ctx);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("CSV_ONLY tables never touch ZCQL", async () => {
    // Paging 140k hotspot cells 300 at a time would be ~470 queries per request.
    for (const t of ["hotspot_cells", "agg_hotspots", "agg_district_month", "forecasts"]) {
      const rows = await getTable(t, ctx);
      expect(rows.length).toBeGreaterThan(0);
    }
    expect(state.queries).toHaveLength(0);
  });

  test("/health reports catalyst_datastore only when a probe READ actually returns rows", async () => {
    // The probe reads dim_district. With nothing seeded it must NOT claim the Data Store — that
    // was the exact overclaim on the first live deploy: flag on, zero tables created, /health
    // still saying catalyst_datastore because both backends return identical rows.
    const empty = await request(app).get("/health");
    expect(empty.body.result.backend.storage).toBe("bundled_tables");
    expect(empty.body.result.datastore_probe.reachable).toBe(false);
    expect(empty.body.result.backend.datastore_note).toMatch(/falling back/i);

    state.zcqlRows.dim_district = [{ canonical_name: "Testville" }];
    const live = await request(app).get("/health");
    expect(live.body.result.backend.storage).toBe("catalyst_datastore");
    expect(live.body.result.backend.verified_by).toMatch(/probe/i);
    expect(live.body.result.datastore_probe.rows_returned).toBe(1);
    expect(live.body.result.backend.data_is_real).toBe(true);
  });

  test("/health is NEVER served from cache — a stale diagnostic misleads a deploy", async () => {
    const r = await request(app).get("/health");
    expect(r.headers["x-cache"]).toBe("no-store");
    expect(state.cachePuts.find((p) => p.k === cacheKey({ originalUrl: "/health" }))).toBeUndefined();
  });

  test("cache status is measured by a put+get round trip, not a segment handle", async () => {
    const ok = await request(app).get("/health");
    expect(ok.body.result.cache.active).toBe(true);
    expect(ok.body.result.cache.verified_by).toMatch(/probe/i);
    state.cacheGetThrows = true;
    const bad = await request(app).get("/health");
    expect(bad.body.result.cache.active).toBe(false);
    expect(bad.body.result.cache.note).toMatch(/not answering/i);
  });

  test("KPIs are IDENTICAL whether rows arrive via ZCQL or the bundle", async () => {
    // Seeding nothing would prove only that the fallback works. So the real bundled tables are
    // pushed through the fake ZCQL, which means the numbers below genuinely travelled the Data
    // Store code path — unwrapping, paging and all — and must land on the same values.
    const { readCsvTable } = require("../src/lib/store");
    for (const t of ["agg_outcomes", "agg_case_status", "dim_district"]) {
      state.zcqlRows[t] = readCsvTable(t);
    }
    const r = await request(app).get("/overview");
    expect(state.queries.some((q) => /FROM agg_outcomes/.test(q))).toBe(true);
    expect(r.body.result.districts_covered).toBe(31);
    // the published headline rates, to 4dp — any paging or unwrapping slip would move these
    expect(r.body.result.rates.conviction_rate).toBeCloseTo(0.2242, 4);
    expect(r.body.result.rates.detection_rate).toBeCloseTo(0.8857, 4);
  });
});

describe("Catalyst Cache path", () => {
  test("miss writes through with the configured TTL", async () => {
    const r = await request(app).get("/overview");
    expect(r.headers["x-cache"]).toBe("miss");
    // write-behind, so give the deferred put a tick to land
    await new Promise((res) => setImmediate(res));
    expect(state.cachePuts).toHaveLength(1);
    expect(state.cachePuts[0].ttl).toBe(1);
    expect(state.cachePuts[0].k).toBe(cacheKey({ originalUrl: "/overview" }));
    const cached = JSON.parse(state.cachePuts[0].v);
    expect(cached.ok).toBe(true);
    expect(cached.result.total_firs).toBe(1674734);
    // a cached request_id would make two different requests indistinguishable in the logs
    expect(cached.request_id).toBeUndefined();
  });

  test("hit serves the cached body but a FRESH request_id", async () => {
    const key = cacheKey({ originalUrl: "/overview" });
    state.cacheStore.set(key, JSON.stringify({ ok: true, data_class: "real", result: { sentinel: 42 } }));
    const r = await request(app).get("/overview").set("x-request-id", "trace-abc");
    expect(r.headers["x-cache"]).toBe("hit");
    expect(r.body.result.sentinel).toBe(42);   // proves it came from cache, not recomputed
    expect(r.body.request_id).toBe("trace-abc");
  });

  test("distinct query strings get distinct cache keys", async () => {
    await request(app).get("/hotspots/clusters?limit=5");
    await request(app).get("/hotspots/clusters?limit=9");
    await new Promise((res) => setImmediate(res));
    const keys = new Set(state.cachePuts.map((p) => p.k));
    expect(keys.size).toBe(2);
  });

  test("an unreachable cache behaves as a miss, never an error", async () => {
    state.cacheGetThrows = true;
    const r = await request(app).get("/overview");
    expect(r.status).toBe(200);
    expect(r.headers["x-cache"]).toBe("miss");
    expect(r.body.result.total_firs).toBe(1674734);
  });

  test("non-GET requests are not cached", async () => {
    await request(app).post("/overview");
    expect(state.cachePuts).toHaveLength(0);
  });
});

describe("SmartBrowz PDF path", () => {
  test("returns a real PDF when SmartBrowz resolves a Buffer", async () => {
    state.pdf = Buffer.from("%PDF-1.4 fake");
    const r = await request(app).get("/report/briefing");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/pdf/);
    expect(r.headers["x-report-renderer"]).toBe("catalyst-smartbrowz");
    expect(r.headers["content-disposition"]).toMatch(/attachment; filename="ksp-crime-briefing-\d{4}-\d{2}-\d{2}\.pdf"/);
    expect(r.body.toString().startsWith("%PDF")).toBe(true);
  });

  test("sends HTML source, not a URL — the SPA is never screenshotted", async () => {
    state.pdf = Buffer.from("%PDF-1.4");
    await request(app).get("/report/briefing");
    const { source, opts } = state.pdfCalls[0];
    // Pointing SmartBrowz at our own SPA would capture half-drawn canvases; guard that regression.
    expect(source).toMatch(/^<!doctype html>/i);
    expect(source).not.toMatch(/^https?:\/\//);
    expect(source).toMatch(/Crime Intelligence Briefing/);
    expect(opts.pdf_options.format).toBe("A4");
  });

  test("a stream response is piped through", async () => {
    const { Readable } = require("stream");
    state.pdf = Readable.from([Buffer.from("%PDF-stream")]);
    const r = await request(app).get("/report/briefing");
    expect(r.status).toBe(200);
    expect(r.body.toString()).toContain("%PDF-stream");
  });

  test("a SmartBrowz failure degrades to HTML instead of losing the briefing", async () => {
    state.pdfThrows = true;
    const r = await request(app).get("/report/briefing");
    expect(r.status).toBe(200);
    expect(r.headers["x-report-renderer"]).toBe("html-fallback");
    expect(r.headers["x-report-note"]).toMatch(/failed/i);
    expect(r.text).toMatch(/Crime Intelligence Briefing/);
  });

  test("the PDF is not cached as if it were a JSON envelope", async () => {
    state.pdf = Buffer.from("%PDF-1.4");
    await request(app).get("/report/briefing");
    await new Promise((res) => setImmediate(res));
    // report.js never calls res.sendOk, so the response cache must have nothing to store.
    expect(state.cachePuts).toHaveLength(0);
  });
});
