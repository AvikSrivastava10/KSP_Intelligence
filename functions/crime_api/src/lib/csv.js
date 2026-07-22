"use strict";
/**
 * Minimal, correct CSV parser (RFC-4180-ish): handles quoted fields, commas and
 * newlines inside quotes, and "" escaped quotes. Used to read the bundled
 * etl/out CSV fallback (some fields contain commas, e.g. "INDIAN MOTOR VEHICLES ACT, 1988").
 */
function parseCSV(text) {
  const rows = [];
  let i = 0;
  const n = text.length;
  if (n && text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM
  let field = "";
  let record = [];
  let inQuotes = false;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { record.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { record.push(field); rows.push(record); record = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || record.length > 0) { record.push(field); rows.push(record); }
  return rows;
}

/** Parse CSV text into an array of row objects keyed by the header row. */
function parseCSVObjects(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const rec = rows[r];
    if (rec.length === 1 && rec[0] === "") continue; // skip blank line
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = rec[c] !== undefined ? rec[c] : "";
    out.push(obj);
  }
  return out;
}

module.exports = { parseCSV, parseCSVObjects };
