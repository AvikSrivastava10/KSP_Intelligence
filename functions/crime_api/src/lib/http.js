"use strict";
const crypto = require("crypto");

/**
 * Envelope middleware: assigns a request_id and attaches res.sendOk / res.sendFail
 * so every response follows { ok, data_class, result, request_id } / { ok:false, error, request_id }.
 */
// Client-supplied request ids are honoured only if they look like ids (word chars,
// dot or dash, <=64 chars) — anything else gets a fresh UUID, so arbitrary content is
// never echoed back into headers/JSON.
const REQ_ID_OK = /^[\w.-]{1,64}$/;

function envelope() {
  return (req, res, next) => {
    const supplied = req.headers["x-request-id"];
    req.request_id = (typeof supplied === "string" && REQ_ID_OK.test(supplied))
      ? supplied : crypto.randomUUID();
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
