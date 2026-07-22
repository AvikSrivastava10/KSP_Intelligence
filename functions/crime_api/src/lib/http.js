"use strict";
const crypto = require("crypto");

/**
 * Envelope middleware: assigns a request_id and attaches res.sendOk / res.sendFail
 * so every response follows { ok, data_class, result, request_id } / { ok:false, error, request_id }.
 */
function envelope() {
  return (req, res, next) => {
    req.request_id = req.headers["x-request-id"] || crypto.randomUUID();
    res.setHeader("X-Request-Id", req.request_id);
    res.sendOk = (result, data_class = "real", extra = {}) =>
      res.status(200).json({ ok: true, data_class, result, request_id: req.request_id, ...extra });
    res.sendFail = (error, code = 500) =>
      res.status(code).json({ ok: false, error: String(error && error.message ? error.message : error), request_id: req.request_id });
    next();
  };
}

/** Wrap an async route handler so rejections flow to the error handler. */
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { envelope, asyncH };
