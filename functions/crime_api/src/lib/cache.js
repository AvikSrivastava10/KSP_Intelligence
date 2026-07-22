"use strict";
/** Tiny in-memory TTL cache (per warm function instance). Sync remember(). */
const store = new Map();
const ENABLED = process.env.USE_CACHE !== "false";

function get(key) {
  const e = store.get(key);
  if (!e) return undefined;
  if (e.exp && e.exp < Date.now()) { store.delete(key); return undefined; }
  return e.val;
}

function set(key, val, ttlSec = 300) {
  store.set(key, { val, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
  return val;
}

/** Return cached value or compute + cache it. ttlSec=0 means cache forever. */
function remember(key, ttlSec, fn) {
  if (!ENABLED) return fn();
  const hit = get(key);
  if (hit !== undefined) return hit;
  return set(key, fn(), ttlSec);
}

module.exports = { get, set, remember };
