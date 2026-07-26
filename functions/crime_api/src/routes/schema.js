"use strict";
/**
 * KSP ER schema conformance — GET /schema/er
 *
 * The ER diagram is the only artefact KSP actually provided, so fidelity to it is worth publishing.
 * A conformance audit found our schema shared ZERO table names and ZERO column names with it, and
 * the "designed-only" tables our own schema.md said were "kept in the schema" existed in prose only.
 *
 * This endpoint serves the machine-readable contract: all 28 ER entities under their exact ER names
 * and column names, what we populate, and for the rest exactly what blocks it. A reviewer can
 * compare the ER document to this response line by line instead of taking a claim on trust.
 *
 *   GET /schema/er                  full contract (28 entities, columns, relationships, deviations)
 *   GET /schema/er?entity=Victim    one entity
 *   GET /schema/er?status=designed_only   filter by conformance status
 */
const { readJson } = require("../lib/store");

module.exports = (router, asyncH) => {
  router.get("/schema/er", asyncH(async (req, res) => {
    const doc = readJson("er_conformance.json", null);
    if (!doc) return res.sendFail("ER conformance map unavailable", 503);

    const entity = typeof req.query.entity === "string" ? req.query.entity.toLowerCase() : "";
    const status = typeof req.query.status === "string" ? req.query.status : "";

    let entities = doc.entities;
    if (entity) entities = entities.filter((e) => e.er_entity.toLowerCase() === entity);
    if (status) entities = entities.filter((e) => e.status === status);

    res.sendOk({
      source_document: doc.source_document,
      entities_total: doc.entities_total,
      by_status: doc.by_status,
      by_blocker: doc.by_blocker,
      // Column-level totals make the "how much of KSP's design can this data support" question
      // answerable with a number rather than an impression.
      columns_total: doc.entities.reduce((a, e) => a + e.columns_total, 0),
      columns_populated: doc.entities.reduce((a, e) => a + e.columns_populated, 0),
      honesty: doc.honesty,
      deviations: doc.deviations,
      reserved_word_note: doc.reserved_word_note,
      relationships_declared: doc.relationships.length,
      relationships: doc.relationships,
      showing: entities.length,
      entities,
    }, "real");
  }));
};
