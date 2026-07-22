"use strict";
const { getTable } = require("./store");

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const rate = (a, b) => (b ? +(a / b).toFixed(4) : 0);

/**
 * Build the geographic-district index from dim_district.
 * Groups the 37 geographic FIR units into their ~31 parent districts (city
 * commissionerates + K.G.F fold into their parent), each mapping to one kgis_code.
 * Non-geographic units (CID/Coastal/ISD/Railways) are excluded.
 */
async function loadDistrictIndex(ctx) {
  const rows = await getTable("dim_district", ctx);
  const geo = rows.filter((r) => String(r.is_geographic).toLowerCase() === "true");
  const membersByParent = {};
  const kgisByParent = {};
  const censusByParent = {};
  const parentByCanonical = {};
  for (const r of geo) {
    const parent = r.parent_district || r.canonical_name;
    (membersByParent[parent] = membersByParent[parent] || []).push(r.canonical_name);
    kgisByParent[parent] = r.kgis_code;
    if (r.census_code_2011) censusByParent[parent] = r.census_code_2011;
    parentByCanonical[r.canonical_name] = parent;
  }
  return { rows, geo, membersByParent, kgisByParent, censusByParent, parentByCanonical };
}

module.exports = { loadDistrictIndex, num, rate };
