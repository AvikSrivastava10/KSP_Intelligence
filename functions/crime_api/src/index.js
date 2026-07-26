"use strict";
/**
 * crime_api — Catalyst Advanced I/O function (Node + Express).
 * Thin serving layer: reads precomputed tables (Data Store -> bundled CSV fallback)
 * and returns { ok, data_class, result, request_id }. No ML at request time.
 *
 * Mounted at /server/crime_api (Catalyst) and / (local dev + `catalyst serve`).
 */
const express = require("express");
const { envelope } = require("./lib/http");
const SEC = require("./lib/security");
const { responseCache } = require("./lib/catalystCache");
const { buildRouter } = require("./routes");

// Optional — only present/needed when deployed with USE_DATASTORE=true.
const catalystSdk = (() => {
  try { return require("zcatalyst-sdk-node"); } catch (e) { return null; }
})();

const app = express();
app.disable("x-powered-by");
app.use(SEC.securityHeaders());
app.use(SEC.corsPolicy());
app.use(express.json({ limit: process.env.MAX_BODY || "256kb" }));
app.use(envelope());
app.use(SEC.rateLimiter());

// Per-request Catalyst context. The SDK instance backs BOTH the Data Store reader and the Cache
// service, so it is initialised whenever either is switched on — not only for the Data Store.
app.use((req, res, next) => {
  req.ctx = { app: null };
  const wantsSdk = process.env.USE_DATASTORE === "true"
    || process.env.USE_CATALYST_CACHE !== "false";
  if (wantsSdk && catalystSdk) {
    try { req.ctx.app = catalystSdk.initialize(req); } catch (e) { req.ctx.app = null; }
  }
  next();
});

// Catalyst Cache in front of GET responses (after req.ctx, so the SDK instance is available).
app.use(responseCache());

const router = buildRouter();
app.use("/server/crime_api", router); // Catalyst Advanced I/O base path
app.use("/", router);                 // local dev + `catalyst serve`

app.use((req, res) => res.status(404).json({ ok: false, error: "not found", path: req.path, request_id: req.request_id }));
app.use(SEC.errorHandler());

module.exports = app;

// Local dev server (not used when Catalyst require()s this module).
if (require.main === module) {
  const PORT = process.env.PORT || 9000;
  app.listen(PORT, () => {
    const mode = process.env.USE_DATASTORE === "true" ? "datastore(+csv fallback)" : "csv fallback";
    // eslint-disable-next-line no-console
    console.log(`crime_api listening on http://localhost:${PORT}  [${mode}]`);
  });
}
