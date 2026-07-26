"use strict";
/**
 * Catalyst Cache — response caching for the read-only API.
 *
 * WHY THIS EXISTS AS A SEPARATE MODULE
 * `lib/cache.js` is a synchronous in-process memo for *parsed CSV tables*. That is memoisation of
 * a file read inside one function instance, not a cache service, and it must stay synchronous
 * because `store.js` reads it on the hot path. Rewriting it async would ripple through every route.
 *
 * So Catalyst Cache is added where it actually belongs: in front of the *response*. A GET response
 * from this API is a pure function of its query string (every figure is precomputed offline), which
 * makes it ideal to cache, and it is shared across function instances rather than per-instance.
 *
 * FAILURE POLICY: a cache is an optimisation, never a dependency. Every path here is wrapped so a
 * missing segment, an unprovisioned Cache service, or local development (no Catalyst request
 * context) degrades to "compute it normally" rather than erroring. That is also why a read miss and
 * a read *error* are treated identically.
 */
const crypto = require("crypto");

const ENABLED = process.env.USE_CATALYST_CACHE !== "false";
const TTL_HOURS = Math.max(parseInt(process.env.CACHE_TTL_HOURS, 10) || 1, 1);

// Cache keys are strings, so the URL is hashed: query strings contain commas, %-escapes and
// spaces, and a hash keeps the key short, safe and fixed-length regardless of the request.
function cacheKey(req) {
  const url = req.originalUrl || req.url || "";
  const h = crypto.createHash("sha1").update(url).digest("hex").slice(0, 32);
  return `resp_${h}`;
}

/** The Catalyst cache segment for this request, or null when unavailable. */
function segmentFor(ctx) {
  if (!ENABLED || !ctx || !ctx.app) return null;
  try {
    return ctx.app.cache().segment();
  } catch (e) {
    return null;
  }
}

/**
 * Express middleware. Must be mounted AFTER envelope() (it wraps res.sendOk) and AFTER the
 * middleware that assigns req.ctx (it needs the Catalyst app instance).
 */
function responseCache({ ttlHours = TTL_HOURS } = {}) {
  return async (req, res, next) => {
    if (req.method !== "GET") return next();
    const seg = segmentFor(req.ctx);
    if (!seg) {
      res.setHeader("X-Cache", "bypass");   // local dev, or Cache not provisioned
      return next();
    }
    const key = cacheKey(req);

    try {
      const hit = await seg.getValue(key);
      if (hit) {
        const body = JSON.parse(hit);
        res.setHeader("X-Cache", "hit");
        // request_id is per-request tracing, so it is never served from the cache.
        return res.status(200).json({ ...body, request_id: req.request_id });
      }
    } catch (e) {
      // Treat an unhappy cache exactly like a miss.
    }

    res.setHeader("X-Cache", "miss");
    const sendOk = res.sendOk;
    res.sendOk = (result, data_class = "real", extra = {}) => {
      const out = sendOk.call(res, result, data_class, extra);
      // Write-behind: the client already has its response, so a slow or failing cache write
      // can never delay or break the request.
      Promise.resolve()
        .then(() => seg.put(key, JSON.stringify({ ok: true, data_class, result, ...extra }), ttlHours))
        .catch(() => {});
      return out;
    };
    return next();
  };
}

/** Reported by /health so the active caching layer is visible rather than assumed. */
function cacheInfo(ctx) {
  const live = !!segmentFor(ctx);
  return {
    service: "catalyst_cache",
    enabled: ENABLED,
    active: live,
    ttl_hours: TTL_HOURS,
    scope: "GET response bodies, keyed by URL hash",
    note: live
      ? "Responses are cached in the Catalyst Cache service, shared across function instances."
      : "Catalyst Cache needs a Catalyst request context, so it is inactive off-platform. "
        + "Responses are still served from the in-process table memo (lib/cache.js).",
  };
}

module.exports = { responseCache, cacheInfo, cacheKey };
