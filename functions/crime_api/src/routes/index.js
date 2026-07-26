"use strict";
const express = require("express");
const { asyncH } = require("../lib/http");
const { readMeta, backendInfo, probeDatastore } = require("../lib/store");
const { cacheInfo, probeCache } = require("../lib/catalystCache");
const { throttleInfo } = require("../lib/security");

function buildRouter() {
  const router = express.Router();

  // Liveness + which Catalyst services are actually serving this request.
  // The Data Store and Cache claims are MEASURED here by a live probe, not inferred from env vars:
  // the first deploy reported storage "catalyst_datastore" with zero tables created, because both
  // backends return byte-identical rows and the per-table fallback is silent by design.
  // This route is also excluded from the response cache — a cached health check would keep
  // reporting the pre-deploy picture for an hour.
  router.get("/health", asyncH(async (req, res) => {
    const [ds, ch] = await Promise.all([probeDatastore(req.ctx), probeCache(req.ctx)]);
    res.sendOk({
      status: "healthy",
      backend: backendInfo(req.ctx, ds),
      datastore_probe: ds,
      cache: cacheInfo(req.ctx, ch),
      throttling: throttleInfo(),
    }, "real");
  }));

  // Full provenance / data-class map (served straight from meta.json).
  router.get("/meta", (req, res) => res.sendOk(readMeta(), "real"));

  require("./overview")(router, asyncH);
  require("./districts")(router, asyncH);
  require("./hotspots")(router, asyncH);
  require("./timeofday")(router, asyncH);
  require("./predict")(router, asyncH);
  require("./patterns")(router, asyncH);
  require("./outcomes")(router, asyncH);
  require("./network")(router, asyncH);
  require("./socio")(router, asyncH);
  require("./validation")(router, asyncH);
  require("./hub")(router, asyncH);
  require("./audit")(router, asyncH);
  require("./persons")(router, asyncH);
  require("./report")(router, asyncH);
  require("./schema")(router, asyncH);

  return router;
}

module.exports = { buildRouter };
