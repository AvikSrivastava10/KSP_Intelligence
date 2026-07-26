"use strict";
/**
 * Storage-agnostic data-access layer.
 *   - Tries the Catalyst Data Store (ZCQL) when USE_DATASTORE=true AND a request-scoped
 *     Catalyst app is available (i.e. deployed).
 *   - Falls back to the bundled CSV copies in src/data/ otherwise — so the API runs
 *     locally and NEVER hard-fails even with zero Catalyst services configured.
 */
const fs = require("fs");
const path = require("path");
const { parseCSVObjects } = require("./csv");
const cache = require("./cache");

const DATA_DIR = path.join(__dirname, "..", "data");
const USE_DATASTORE = process.env.USE_DATASTORE === "true";

let _meta = null;
function readMeta() {
  if (_meta) return _meta;
  _meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "meta.json"), "utf8"));
  return _meta;
}

/** Read a bundled JSON sidecar (model cards, ER conformance map). Missing/corrupt -> fallback,
 *  because a metadata file failing to parse must never take an endpoint down. */
function readJson(name, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
  } catch (e) {
    return fallback;
  }
}

function readCsvTable(name) {
  return cache.remember(`csv:${name}`, 0, () => {
    const p = path.join(DATA_DIR, `${name}.csv`);
    return parseCSVObjects(fs.readFileSync(p, "utf8"));
  });
}

async function readDatastoreTable(name, app) {
  const zcql = app.zcql();
  const out = [];
  const pageSize = 300;
  let offset = 0;
  for (;;) {
    const rows = await zcql.executeZCQLQuery(`SELECT * FROM ${name} LIMIT ${offset}, ${pageSize}`);
    if (!rows || rows.length === 0) break;
    for (const r of rows) out.push(r[name] || r); // ZCQL wraps columns under the table name
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

// Large tables (tens of thousands of rows) are always served from the bundled CSV — paging
// them via ZCQL 300-at-a-time would mean hundreds of queries per request. Small dimension/
// aggregate tables can still use the Data Store when USE_DATASTORE=true.
const CSV_ONLY = new Set(["hotspot_cells", "agg_hotspots", "agg_district_month", "forecasts"]);

/**
 * Get a table as an array of plain row objects.
 * @param {string} name table/file base name (no extension)
 * @param {{app: any}} ctx per-request context; ctx.app is the Catalyst instance or null
 */
// Where each table LAST actually came from. The fallback is per table and silent by design, so
// without this there is no way to tell a working Data Store from a completely empty one — the
// served numbers are identical either way. Instance-scoped, so it also reveals partial loads.
const SOURCE_SEEN = new Map();   // table -> "catalyst_datastore" | "bundled_tables"

async function getTable(name, ctx) {
  if (USE_DATASTORE && ctx && ctx.app && !CSV_ONLY.has(name)) {
    try {
      const rows = await readDatastoreTable(name, ctx.app);
      if (rows && rows.length) {
        SOURCE_SEEN.set(name, "catalyst_datastore");
        return rows;
      }
    } catch (e) {
      // fall through to CSV — resilience over strictness
    }
  }
  if (!CSV_ONLY.has(name)) SOURCE_SEEN.set(name, "bundled_tables");
  return readCsvTable(name);
}

/**
 * Actively probe the Data Store with one cheap read.
 *
 * WHY: backendInfo used to report `storage: "catalyst_datastore"` purely because USE_DATASTORE was
 * true and a Catalyst context existed. On the first live deploy that produced a flat overclaim —
 * the flag was on, zero tables had been created, every read was silently falling back to the
 * bundle, and /health still said Data Store. From outside it is indistinguishable, because both
 * backends serve byte-identical rows. So the claim has to be measured, not inferred.
 */
async function probeDatastore(ctx) {
  if (!USE_DATASTORE) return { reachable: false, reason: "USE_DATASTORE is not true" };
  if (!ctx || !ctx.app) {
    return { reachable: false, reason: "no Catalyst request context (off-platform)" };
  }
  try {
    const rows = await ctx.app.zcql()
      .executeZCQLQuery("SELECT canonical_name FROM dim_district LIMIT 0, 1");
    const n = Array.isArray(rows) ? rows.length : 0;
    return n > 0
      ? { reachable: true, probe_table: "dim_district", rows_returned: n }
      : { reachable: false, probe_table: "dim_district",
          reason: "the table exists but returned no rows — has etl/load_datastore.py --load run?" };
  } catch (e) {
    return {
      reachable: false,
      probe_table: "dim_district",
      reason: `ZCQL read failed: ${String((e && e.message) || e).slice(0, 160)}`,
    };
  }
}

/**
 * Which STORAGE backend is serving the tables — this says nothing about data authenticity.
 * Both backends hold byte-identical tables derived from the real 1,674,734-row FIR extract:
 * the Data Store copy is loaded FROM these same bundled CSVs (etl/load_datastore.py).
 * "bundled_tables" is the normal, self-contained mode; it is not degraded or sample data.
 */
function backendInfo(ctx, probe = null) {
  // `storage` now reflects a MEASURED read when a probe is supplied, and falls back to the
  // configuration-only view (clearly labelled as unverified) when one is not.
  const observed = [...SOURCE_SEEN.values()];
  const fromStore = observed.filter((v) => v === "catalyst_datastore").length;
  const live = probe ? probe.reachable : Boolean(USE_DATASTORE && ctx && ctx.app);
  const info = {
    datastore_enabled: USE_DATASTORE,
    storage: live ? "catalyst_datastore" : "bundled_tables",
    source: live ? "datastore(+csv fallback)" : "csv", // kept for backward compatibility
    data_is_real: true,
    verified_by: probe ? "live ZCQL probe" : "configuration only (not probed)",
    tables_observed: observed.length,
    tables_from_datastore: fromStore,
    tables_from_bundle: observed.length - fromStore,
    note: live
      ? "Serving precomputed tables from the Catalyst Data Store (bundled CSVs remain as a resilience fallback)."
      : "Serving precomputed tables bundled with the function. These are REAL — built by the offline ETL from the 1,674,734-row FIR extract, byte-identical to the Data Store copy. Nothing here is sample or degraded data.",
  };
  if (probe && !probe.reachable) {
    // The single most useful line during deployment: the flag is on but nothing is coming back,
    // and here is why.
    info.datastore_note = `USE_DATASTORE=${USE_DATASTORE} but the Data Store is not serving rows: `
      + `${probe.reason}. Every table is falling back to the bundled copy, which is why the figures `
      + `are still correct.`;
  }
  return info;
}

module.exports = {
  getTable, readCsvTable, readJson, readMeta, backendInfo, probeDatastore, DATA_DIR,
};
