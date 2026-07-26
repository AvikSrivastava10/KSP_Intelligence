"use strict";
/**
 * Intelligence briefing export — Catalyst SmartBrowz.
 *
 * REPLACES `window.print()`. Client-side printing produced a PDF only for the person sitting at the
 * browser; a server-rendered document can be scheduled by Cron, mailed to a district SP, or stored,
 * which is what makes it an operational artefact rather than a screenshot.
 *
 * WHY THE HTML IS COMPOSED HERE, NOT SCREENSHOTTED FROM THE SPA
 * SmartBrowz could point a headless browser at our own web client, but every workspace renders its
 * maps and charts to canvas *after* async API calls settle. Waiting on that is timing-dependent and
 * would intermittently capture half-drawn charts. Composing the briefing from the same precomputed
 * tables is deterministic — identical output every run — and a commander circulating a briefing
 * wants the figures and the shortlist, not a picture of a dashboard.
 *
 *   GET /report/briefing              -> application/pdf via SmartBrowz
 *   GET /report/briefing?format=html  -> the source HTML (debugging, and the off-platform fallback)
 *
 * Off-platform (local dev) SmartBrowz has no Catalyst context, so the route degrades to HTML with
 * an X-Report-Renderer header saying so — testable locally, and never a silent failure.
 */
const { getTable, readMeta } = require("../lib/store");
const { loadDistrictIndex, num, rate } = require("../lib/districts");

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => (Number.isFinite(+n) ? (+n).toLocaleString("en-IN") : "—");
const pct = (x) => `${((x || 0) * 100).toFixed(1)}%`;
const TIER = { Critical: "#991b1b", High: "#ef4444", Moderate: "#f59e0b", Low: "#16a34a" };

async function gather(ctx) {
  const [idx, outcomes, statuses, risk, alerts, anoms, clusters, validation] = await Promise.all([
    loadDistrictIndex(ctx),
    getTable("agg_outcomes", ctx),
    getTable("agg_case_status", ctx),
    getTable("risk_scores", ctx),
    getTable("alerts", ctx),
    getTable("anomalies", ctx),
    getTable("hotspot_clusters", ctx),
    getTable("validation_results", ctx),
  ]);
  const meta = readMeta();
  const geo = new Set(idx.geo.map((r) => r.canonical_name));

  let total = 0, convicted = 0, chargesheeted = 0;
  for (const o of outcomes) {
    if (!geo.has(o.canonical_name)) continue;
    total += num(o.total_cases);
    convicted += num(o.convicted);
    chargesheeted += num(o.chargesheeted);
  }
  let undet = 0, stTotal = 0;
  for (const s of statuses) {
    if (!geo.has(s.canonical_name)) continue;
    const c = num(s.count);
    stTotal += c;
    if (s.status === "Undetected" || s.status === "Un Traced") undet += c;
  }

  // Same convergence rule as /hub: a district counts only when all three independent models agree.
  const red = new Map(), anomCount = new Map();
  for (const a of alerts) if (a.severity === "red") red.set(a.canonical_name, (red.get(a.canonical_name) || 0) + 1);
  for (const a of anoms) anomCount.set(a.canonical_name, (anomCount.get(a.canonical_name) || 0) + 1);
  const converging = risk
    .filter((r) => (r.risk_tier === "Critical" || r.risk_tier === "High")
      && red.get(r.canonical_name) > 0 && anomCount.get(r.canonical_name) > 0)
    .map((r) => ({
      district: r.canonical_name, tier: r.risk_tier, score: num(r.risk_score),
      projected: num(r.predicted_next), red: red.get(r.canonical_name) || 0,
      anomalies: anomCount.get(r.canonical_name) || 0, drivers: r.top_drivers,
    }))
    .sort((a, b) => b.score - a.score);

  return {
    meta,
    kpis: {
      total_firs: num(meta.total_rows_processed),
      districts: Object.keys(idx.membersByParent).length,
      detection_rate: rate(stTotal - undet, stTotal),
      conviction_rate: rate(convicted, chargesheeted),
      geocoded: meta.coordinate_coverage ? meta.coordinate_coverage.after_pct : null,
    },
    converging,
    topAlerts: alerts.filter((a) => a.severity === "red")
      .map((a) => ({ d: a.canonical_name, c: a.category, dev: num(a.deviation_pct), reason: a.reason }))
      .sort((x, y) => y.dev - x.dev).slice(0, 8),
    deployments: clusters
      .map((c) => ({ d: c.canonical_name, n: num(c.total_count), r: num(c.radius_km), cat: c.top_category }))
      .sort((a, b) => b.n - a.n).slice(0, 6),
    validation: validation.map((v) => ({
      test: v.test, metric: v.metric, value: v.value, unit: v.unit,
      baseline: v.baseline_value, baseline_name: v.baseline_name, verdict: v.verdict,
    })),
  };
}

function buildHtml(d) {
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>KSP Crime Intelligence Briefing</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:#0f172a; font-size:10.5pt; line-height:1.45; }
  h1 { font-size:18pt; margin:0 0 2mm; } h2 { font-size:12pt; margin:7mm 0 2mm; border-bottom:1px solid #cbd5e1; padding-bottom:1.5mm; }
  .sub { color:#475569; font-size:9pt; margin-bottom:5mm; }
  table { width:100%; border-collapse:collapse; font-size:9pt; }
  th { text-align:left; font-size:8pt; text-transform:uppercase; letter-spacing:.04em; color:#475569; border-bottom:1px solid #cbd5e1; padding:1.5mm 2mm; }
  td { padding:1.5mm 2mm; border-bottom:1px solid #e2e8f0; vertical-align:top; }
  .kpis { display:flex; gap:3mm; margin-bottom:2mm; }
  .kpi { flex:1; border:1px solid #cbd5e1; border-radius:2mm; padding:2.5mm; }
  .kpi b { display:block; font-size:14pt; } .kpi span { font-size:8pt; color:#475569; text-transform:uppercase; letter-spacing:.04em; }
  .pill { display:inline-block; padding:.4mm 2mm; border-radius:3mm; color:#fff; font-size:8pt; font-weight:600; }
  .note { background:#f8fafc; border-left:2px solid #94a3b8; padding:2.5mm 3mm; font-size:8.5pt; color:#334155; margin-top:3mm; }
  tr { page-break-inside:avoid; } h2 { page-break-after:avoid; }
</style></head><body>
<h1>Crime Intelligence Briefing</h1>
<div class="sub">Karnataka State Police &middot; State Crime Records Bureau &middot; generated ${esc(now)} UTC</div>

<div class="kpis">
  <div class="kpi"><b>${fmt(d.kpis.total_firs)}</b><span>FIRs analysed</span></div>
  <div class="kpi"><b>${d.kpis.districts}</b><span>Districts</span></div>
  <div class="kpi"><b>${pct(d.kpis.detection_rate)}</b><span>Detection rate</span></div>
  <div class="kpi"><b>${pct(d.kpis.conviction_rate)}</b><span>Conviction rate</span></div>
  <div class="kpi"><b>${d.kpis.geocoded ?? "—"}%</b><span>Mapped to location</span></div>
</div>

<h2>Priority districts — flagged by all three models</h2>
<div class="sub">Predicted risk tier, an active emerging-trend alert, and a historical anomaly all
concur. A two-of-three threshold flags most of the state, so this list requires all three.</div>
<table><thead><tr><th>District</th><th>Risk tier</th><th>Index</th><th>Projected FIRs</th><th>Red zones</th><th>Anomalies</th><th>Why it ranks here</th></tr></thead><tbody>
${d.converging.length
  ? d.converging.map((c) => row([
    `<b>${esc(c.district)}</b>`,
    `<span class="pill" style="background:${TIER[c.tier] || "#64748b"}">${esc(c.tier)}</span>`,
    `${c.score}/100`, fmt(c.projected), c.red, c.anomalies, esc(c.drivers || "—"),
  ])).join("")
  : row(["No district is currently flagged by all three models.", "", "", "", "", "", ""])}
</tbody></table>

<h2>Sharpest emerging trends</h2>
<table><thead><tr><th>District</th><th>Crime type</th><th>Rise</th><th>Detail</th></tr></thead><tbody>
${d.topAlerts.map((a) => row([esc(a.d), esc(String(a.c).toLowerCase()), `+${a.dev}%`, esc(a.reason)])).join("")}
</tbody></table>

<h2>Priority deployment areas</h2>
<table><thead><tr><th>#</th><th>District</th><th>Incidents in cluster</th><th>Radius</th><th>Dominant crime type</th></tr></thead><tbody>
${d.deployments.map((x, i) => row([i + 1, esc(x.d), fmt(x.n), `~${x.r} km`, esc(String(x.cat || "n/a").toLowerCase())])).join("")}
</tbody></table>

<h2>Does it work? Ground-truth validation</h2>
<div class="sub">Every prediction scored against data excluded from all training, each against a naive
baseline. Beating the baseline — not the raw number — is the bar.</div>
<table><thead><tr><th>Test</th><th>Metric</th><th>Result</th><th>Baseline</th><th>Verdict</th></tr></thead><tbody>
${d.validation.map((v) => row([
  esc(v.test), esc(v.metric),
  `<b>${esc(v.value)}${v.unit === "%" ? "%" : ""}</b>`,
  `${esc(v.baseline)}${v.unit === "%" ? "%" : ""} (${esc(v.baseline_name)})`,
  esc(String(v.verdict).replace(/_/g, " ")),
])).join("")}
</tbody></table>

<div class="note">
  <b>Scope and limits.</b> FIR counts measure <i>reported</i> crime, not offending — better-policed,
  more literate districts report more. Risk scores rank <i>areas</i> for resource planning, never
  individuals. Caste, religion and sex are never used as model features. 2024 is a partial year and
  is excluded from every training baseline. Per-capita figures use Census 2011 population against
  2016&ndash;2024 crime, so they are indicative. Full detail on the Data Quality &amp; Fairness screen.
</div>
<div class="note">Derived from ${fmt(d.kpis.total_firs)} real FIRs (${esc(d.meta.source_file || "FIR extract")}).
Predictions are statistical projections, not determinations.</div>
</body></html>`;
}

module.exports = (router, asyncH) => {
  router.get("/report/briefing", asyncH(async (req, res) => {
    const data = await gather(req.ctx);
    const html = buildHtml(data);

    if (String(req.query.format) === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Report-Renderer", "html-source");
      return res.status(200).send(html);
    }

    const app = req.ctx && req.ctx.app;
    if (!app) {
      // Off-platform: SmartBrowz needs a Catalyst context. Serve the source rather than a 500 so
      // the route stays exercisable locally, and say plainly which renderer produced it.
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Report-Renderer", "html-fallback");
      res.setHeader("X-Report-Note", "SmartBrowz unavailable off-platform; returning source HTML.");
      return res.status(200).send(html);
    }

    try {
      const pdf = await app.smartbrowz().convertToPdf(html, {
        pdf_options: { format: "A4", print_background: true, margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" } },
        navigation_options: { wait_until: "domcontentloaded", timeout: 30000 },
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("X-Report-Renderer", "catalyst-smartbrowz");
      res.setHeader("Content-Disposition",
        `attachment; filename="ksp-crime-briefing-${new Date().toISOString().slice(0, 10)}.pdf"`);
      if (Buffer.isBuffer(pdf)) return res.status(200).end(pdf);
      if (pdf && typeof pdf.pipe === "function") return pdf.pipe(res);   // stream response
      return res.status(200).end(Buffer.from(pdf));
    } catch (e) {
      // A rendering service being down must not cost the user their briefing.
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Report-Renderer", "html-fallback");
      res.setHeader("X-Report-Note", "SmartBrowz render failed; returning source HTML.");
      return res.status(200).send(html);
    }
  }));
};
