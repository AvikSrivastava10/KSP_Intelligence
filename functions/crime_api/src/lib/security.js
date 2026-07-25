"use strict";
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

function securityHeaders() {
  return helmet({ contentSecurityPolicy: false }); // API only; CSP handled by the web client host
}

/** Origin-restricted CORS. localhost always allowed (dev); prod origins via ALLOWED_ORIGINS.
 *  With ALLOWED_ORIGINS unset the API answers any origin — a deliberate default for this
 *  public, read-only, credential-free dataset API (prod is same-origin on Catalyst anyway).
 *  Set ALLOWED_ORIGINS on the deployed function to lock it down. */
function corsPolicy() {
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // curl / same-origin / server-to-server
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      if (allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  });
}

function rateLimiter() {
  return rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/** Terminal error handler — consistent { ok:false, error, request_id } envelope.
 *  Honours the status Express/body-parser attach (e.g. 400 malformed URI, 413 too large)
 *  instead of flattening every client error into a 500. */
function errorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = (err && (err.status || err.statusCode)) || 500;
    const msg = status < 500 && err && err.message ? err.message : "internal error";
    res.status(status).json({ ok: false, error: msg, request_id: req.request_id });
  };
}

module.exports = { securityHeaders, corsPolicy, rateLimiter, errorHandler };
