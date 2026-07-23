"use strict";
const express = require("express");
const { asyncH } = require("../lib/http");
const { readMeta, backendInfo } = require("../lib/store");

function buildRouter() {
  const router = express.Router();

  // Liveness + which storage backend is active.
  router.get("/health", (req, res) => res.sendOk({ status: "healthy", backend: backendInfo(req.ctx) }, "real"));

  // Full provenance / data-class map (served straight from meta.json).
  router.get("/meta", (req, res) => res.sendOk(readMeta(), "real"));

  require("./overview")(router, asyncH);
  require("./districts")(router, asyncH);
  require("./hotspots")(router, asyncH);
  require("./timeofday")(router, asyncH);
  require("./predict")(router, asyncH);

  return router;
}

module.exports = { buildRouter };
