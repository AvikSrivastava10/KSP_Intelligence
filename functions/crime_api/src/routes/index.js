"use strict";
const express = require("express");
const { asyncH } = require("../lib/http");
const { readMeta, backendInfo } = require("../lib/store");
const { cacheInfo } = require("../lib/catalystCache");
const { throttleInfo } = require("../lib/security");

function buildRouter() {
  const router = express.Router();

  // Liveness + which Catalyst services are actually serving this request. Reported rather than
  // claimed, so a misconfiguration shows up here instead of being discovered during a demo.
  router.get("/health", (req, res) => res.sendOk({
    status: "healthy",
    backend: backendInfo(req.ctx),
    cache: cacheInfo(req.ctx),
    throttling: throttleInfo(),
  }, "real"));

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

  return router;
}

module.exports = { buildRouter };
