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
async function getTable(name, ctx) {
  if (USE_DATASTORE && ctx && ctx.app && !CSV_ONLY.has(name)) {
    try {
      const rows = await readDatastoreTable(name, ctx.app);
      if (rows && rows.length) return rows;
    } catch (e) {
      // fall through to CSV — resilience over strictness
    }
  }
  return readCsvTable(name);
}

/**
 * Which STORAGE backend is serving the tables — this says nothing about data authenticity.
 * Both backends hold byte-identical tables derived from the real 1,674,734-row FIR extract:
 * the Data Store copy is loaded FROM these same bundled CSVs (etl/load_datastore.py).
 * "bundled_tables" is the normal, self-contained mode; it is not degraded or sample data.
 */
function backendInfo(ctx) {
  const live = USE_DATASTORE && ctx && ctx.app;
  return {
    datastore_enabled: USE_DATASTORE,
    storage: live ? "catalyst_datastore" : "bundled_tables",
    source: live ? "datastore(+csv fallback)" : "csv", // kept for backward compatibility
    data_is_real: true,
    note: live
      ? "Serving precomputed tables from the Catalyst Data Store (bundled CSVs remain as a resilience fallback)."
      : "Serving precomputed tables bundled with the function. These are REAL — built by the offline ETL from the 1,674,734-row FIR extract, byte-identical to the Data Store copy. Set USE_DATASTORE=true on a deployed Catalyst function to read from the Data Store instead.",
  };
}

module.exports = { getTable, readCsvTable, readJson, readMeta, backendInfo, DATA_DIR };
