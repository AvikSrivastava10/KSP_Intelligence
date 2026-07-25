"use strict";
const fs = require("fs");
const path = require("path");
const { getTable, DATA_DIR } = require("../lib/store");
const { num } = require("../lib/districts");

let _vm = null;
function readValidationMetrics() {
  if (_vm) return _vm;
  _vm = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "validation_metrics.json"), "utf8"));
  return _vm;
}

const VERDICT_LABEL = {
  beats_baseline: "Beats baseline",
  matches_baseline: "Matches baseline (within noise)",
  below_baseline: "Below baseline",
};

/**
 * GET /validation — ground-truth proof of concept.
 * Scores the shipped predictions against outcomes the models never trained on
 * (real Jan–Feb 2024 FIRs + an independent 2025 dataset), each against a naive baseline.
 */
module.exports = (router, asyncH) => {
  router.get("/validation", asyncH(async (req, res) => {
    const rows = await getTable("validation_results", req.ctx);
    const m = readValidationMetrics();

    const tests = rows.map((r) => ({
      test: r.test,
      what_it_proves: r.what_it_proves,
      metric: r.metric,
      value: num(r.value),
      unit: r.unit,
      baseline_name: r.baseline_name,
      baseline_value: num(r.baseline_value),
      verdict: r.verdict,
      verdict_label: VERDICT_LABEL[r.verdict] || r.verdict,
      extra: r.extra,
      n: num(r.n),
    }));

    const atOrAbove = tests.filter((t) => t.verdict !== "below_baseline").length;
    res.sendOk({
      tests_run: tests.length,
      tests_at_or_above_baseline: atOrAbove,
      headline: `${atOrAbove}/${tests.length} predictions held up against data the models never saw.`,
      tests,
      ground_truth_sources: m.ground_truth_sources,
      exclusions_and_why: m.exclusions_and_why,
      honesty: m.honesty,
      generated_at: m.generated_at_utc,
    }, "real");
  }));
};
