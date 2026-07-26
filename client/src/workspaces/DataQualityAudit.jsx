import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck, Database, AlertOctagon, Scale, CheckCircle2, XCircle, Info, Printer, FlaskConical,
  Server,
} from "lucide-react";
import DataClassBadge from "../components/DataClassBadge.jsx";
import KpiCard from "../components/KpiCard.jsx";
import InfoDot from "../components/InfoDot.jsx";
import Reveal from "../components/Reveal.jsx";
import { fetchAudit, fetchValidation, reportBriefingUrl } from "../api/client.js";

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-IN") : n ?? "—");
const pctFixed = (x) => `${((x || 0) * 100).toFixed(2)}%`;
// Row order puts the two directly comparable models first; the shipped model is context, not a
// rival, and saying so in the table stops the strongest number being read as the fair result.
const BENCH_ROWS = [
  ["zia_automl", "Catalyst Zia AutoML", "The service. Trained in the console on the matched sample."],
  ["lightgbm_matched", "LightGBM (matched)", "Identical training rows AND holdout — the fair comparison."],
  ["lightgbm_shipped", "LightGBM (shipped)", "What the platform serves, trained on all 1.49M cases. Context only."],
];
// "%" reads naturally suffixed; a correlation should render as "ρ 0.971", not "0.971rho".
const fmtMetric = (v, unit) => (unit === "%" ? `${v}%` : unit === "rho" ? `ρ ${v}` : `${v} ${unit || ""}`.trim());
const STATUS = {
  "not possible": { cls: "border-rose-500/25 bg-rose-50/60", icon: XCircle, tone: "text-rose-600" },
  caveat: { cls: "border-amber-500/25 bg-amber-50/60", icon: Info, tone: "text-amber-600" },
};
const VERDICT = {
  beats_baseline: { label: "Beats baseline", cls: "bg-emerald-100 text-emerald-700" },
  matches_baseline: { label: "Matches baseline", cls: "bg-sky-100 text-sky-700" },
  below_baseline: { label: "Below baseline", cls: "bg-rose-100 text-rose-700" },
};
// "no_catalyst_equivalent" is deliberately neutral, not a warning — it is a justified engineering
// choice, and colouring it red would misrepresent it.
// "Declared, empty" is deliberately neutral slate, not a warning colour: an entity we cannot
// populate because the law forbids it is a correct outcome, not a defect.
const ER_STATUS = {
  populated: { label: "Populated", cls: "bg-emerald-100 text-emerald-700" },
  populated_subset: { label: "Partial", cls: "bg-sky-100 text-sky-700" },
  designed_only: { label: "Declared, empty", cls: "bg-slate-200 text-slate-600" },
};
const SERVICE_STATUS = {
  active: { label: "Live", cls: "bg-emerald-100 text-emerald-700" },
  configured: { label: "Configured", cls: "bg-sky-100 text-sky-700" },
  // A service that was called and failed is a real problem, so it reads as one. "Live" is now
  // earned by evidence: a Data Store read that returned rows, a cache value that round-tripped,
  // a PDF that actually rendered.
  unavailable: { label: "Not responding", cls: "bg-amber-100 text-amber-800" },
  disabled: { label: "Off", cls: "bg-slate-200 text-slate-600" },
  no_catalyst_equivalent: { label: "No equivalent", cls: "bg-violet-100 text-violet-700" },
};

export default function DataQualityAudit() {
  const aq = useQuery({ queryKey: ["audit"], queryFn: fetchAudit });
  const vq = useQuery({ queryKey: ["validation"], queryFn: fetchValidation });
  const a = aq.data?.result;
  const v = vq.data?.result;
  const cov = a?.coverage;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Data Quality &amp; Fairness</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
            What this platform can and cannot tell you — stated before anyone has to ask.
            Every limitation, exclusion and validation number in one place. <DataClassBadge kind="real" />
          </p>
        </div>
        <a
          href={reportBriefingUrl()}
          target="_blank"
          rel="noreferrer"
          className="no-print neo flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:text-indigo-600"
        >
          <Printer size={14} /> Export briefing (PDF)
        </a>
      </div>

      {aq.error && <div className="glass rounded-2xl border border-rose-300 p-3 text-sm text-rose-600">Could not load the audit from crime_api.</div>}

      {a && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Reveal delay={0}>
              <KpiCard label="Records analysed" value={fmt(cov.total_records)}
                sub={cov.reconciles_to_source ? "reconciles exactly to source" : "reconciliation FAILED"}
                icon={Database} accent="sky" />
            </Reveal>
            <Reveal delay={70}>
              <KpiCard label="Mapped to a location" value={`${cov.geocoding.after_geocoding_pct}%`}
                sub={`only ${cov.geocoding.real_gps_pct}% had real GPS`} icon={ShieldCheck} accent="emerald" />
            </Reveal>
            <Reveal delay={140}>
              <KpiCard label="Real-data workspaces" value="8 of 9"
                sub="1 labelled synthetic demo" icon={CheckCircle2} accent="violet" />
            </Reveal>
            <Reveal delay={210}>
              <KpiCard label="Known limitations" value={a.limitations.length}
                sub="published, not hidden" icon={AlertOctagon} accent="rose" />
            </Reveal>
          </div>

          {/* Limitations — the most important panel on the page */}
          <Reveal className="glass rounded-3xl p-5">
            <div className="mb-1 flex items-center gap-2">
              <AlertOctagon size={16} className="text-rose-500" />
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                What this platform cannot do
                <InfoDot text="Every item here is a hard limit of the underlying data or of Indian law — not a feature that was skipped. Each names what is provided instead." />
              </div>
            </div>
            <p className="mb-3 max-w-4xl text-[11px] leading-relaxed text-slate-500">
              A crime-intelligence tool that advertises only its strengths cannot be trusted with
              deployment decisions. These are the boundaries.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {a.limitations.map((l) => {
                const s = STATUS[l.status] || STATUS.caveat;
                const Icon = s.icon;
                return (
                  <div key={l.item} className={`rounded-xl border p-3 ${s.cls}`}>
                    <div className="flex items-start gap-2">
                      <Icon size={14} className={`mt-0.5 shrink-0 ${s.tone}`} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800">{l.item}</div>
                        <div className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{l.why}</div>
                        <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                          <span className="font-semibold text-slate-600">Instead: </span>{l.instead}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Reveal>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* Fairness */}
            <Reveal className="glass rounded-3xl p-5 lg:col-span-3">
              <div className="mb-1 flex items-center gap-2">
                <Scale size={16} className="text-emerald-500" />
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  Fairness guarantees
                  <InfoDot text="These constraints are enforced in code and asserted by automated tests, not merely documented — the pipeline refuses to emit protected attributes as model features." />
                </div>
              </div>
              <div className="mt-2 space-y-2 text-[12px] leading-relaxed text-slate-600">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/50 p-3">
                  <div className="mb-1 text-xs font-semibold text-slate-800">Never used as model features</div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.fairness.excluded_from_all_models.map((x) => (
                      <span key={x} className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{x}</span>
                    ))}
                  </div>
                </div>
                <p><b className="text-slate-800">Victim counts:</b> {a.fairness.victim_counts}</p>
                <p><b className="text-slate-800">Where protected attributes do appear:</b> {a.fairness.where_protected_attributes_appear}</p>
                {a.fairness.finding && (
                  <p className="rounded-lg bg-slate-900/[0.03] px-3 py-2">
                    <b className="text-slate-800">Finding: </b>{a.fairness.finding}
                  </p>
                )}
                {a.fairness.leakage_control && <p><b className="text-slate-800">Leakage control:</b> {a.fairness.leakage_control}</p>}
                <p className="rounded-lg border border-amber-500/25 bg-amber-50/60 px-3 py-2">
                  <b className="text-slate-800">Predictive-policing caveat: </b>{a.fairness.predictive_policing_note}
                </p>
              </div>
            </Reveal>

            {/* Coverage */}
            <Reveal className="glass rounded-3xl p-5 lg:col-span-2">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Database size={15} className="text-sky-500" /> Location data quality
                <InfoDot text="How each incident got its coordinates. 'Point' is real GPS from the FIR; the rest are inferred, and district-centroid records are kept off the hotspot layers entirely." />
              </div>
              <div className="space-y-1.5">
                {Object.entries(cov.geocoding.by_precision || {}).map(([k, n]) => {
                  const share = (n / cov.total_records) * 100;
                  const label = { point: "Real GPS", station: "Police-station coords", place: "Geocoded village/place", district: "District centroid", none: "No location" }[k] || k;
                  return (
                    <div key={k}>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-600">{label}</span>
                        <span className="font-medium text-slate-500">{share.toFixed(1)}%</span>
                      </div>
                      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-900/[0.06]">
                        <div className="h-full rounded-full" style={{ width: `${share}%`, background: k === "point" ? "#10b981" : k === "district" ? "#f59e0b" : k === "none" ? "#ef4444" : "#6366f1" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{cov.geocoding.note}</p>
              <p className="mt-2 rounded-lg bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-800">
                {cov.partial_year.note} ({fmt(cov.partial_year.records)} records in {cov.partial_year.year})
              </p>
            </Reveal>
          </div>

          {/* Ground-truth validation */}
          {v && (
            <Reveal className="glass rounded-3xl p-5">
              <div className="mb-1 flex items-center gap-2">
                <FlaskConical size={16} className="text-violet-500" />
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  Ground-truth validation
                  <InfoDot text="Predictions scored against outcomes the models never trained on — real Jan–Feb 2024 records and an independent 2025 dataset — each compared to a naive baseline. Beating the baseline, not the raw number, is the bar." />
                </div>
              </div>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-500">{v.headline}</p>
              <div className="grid gap-2 md:grid-cols-3">
                {v.tests.map((t) => {
                  const vd = VERDICT[t.verdict] || VERDICT.matches_baseline;
                  return (
                    <div key={t.test} className="rounded-xl border border-slate-900/10 bg-white/70 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800">{t.test.replace(/^T\d+ /, "")}</span>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${vd.cls}`}>{vd.label}</span>
                      </div>
                      <div className="mt-1.5 text-lg font-bold text-slate-900">
                        {fmtMetric(t.value, t.unit)}
                      </div>
                      <div className="text-[10px] text-slate-500">vs {fmtMetric(t.baseline_value, t.unit)} — {t.baseline_name}</div>
                      <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{t.what_it_proves}</div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 rounded-lg bg-slate-900/[0.03] px-3 py-2 text-[11px] leading-relaxed text-slate-500">{v.honesty}</p>
            </Reveal>
          )}

          {/* Model cards */}
          <Reveal className="glass rounded-3xl p-5">
            <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <ShieldCheck size={15} className="text-indigo-500" /> Model cards
              <InfoDot text="Every model in the platform with the technique used and its headline validation number. Models run offline; the live app only serves their precomputed outputs." />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-900/10">
                    <th className="py-2 pr-3 font-semibold">Model</th>
                    <th className="py-2 pr-3 font-semibold">Technique</th>
                    <th className="py-2 pr-3 font-semibold">Validation</th>
                    <th className="py-2 font-semibold">Data class</th>
                  </tr>
                </thead>
                <tbody>
                  {a.models.map((m) => (
                    <tr key={m.model} className="border-b border-slate-900/5 last:border-0">
                      <td className="py-2 pr-3 font-medium text-slate-800">{m.model}</td>
                      <td className="py-2 pr-3 text-slate-500">{m.technique}</td>
                      <td className="py-2 pr-3 text-slate-600">{m.metric}</td>
                      <td className="py-2"><DataClassBadge kind={m.data_class} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{a.guardrails}</p>
          </Reveal>

          {/* Zia AutoML vs LightGBM. Shown with its protocol, because two accuracy numbers from
              different splits are not a comparison — and Zia's console report uses its own split. */}
          {a.tabular_model_benchmark && (
            <Reveal className="glass rounded-3xl p-5">
              <div className="mb-1 flex items-center gap-2">
                <Scale size={16} className="text-violet-500" />
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  Zia AutoML vs LightGBM — same holdout, same training rows
                  <InfoDot text="Catalyst names Zia AutoML for tabular model training, and ours use LightGBM. Rather than swap silently either way, every model is scored on one identical 2,000-row holdout that no model trained on. Only the first two rows are directly comparable — they share training rows as well as the holdout." />
                </div>
              </div>
              <p className="mb-3 max-w-4xl text-[11px] leading-relaxed text-slate-500">
                {a.tabular_model_benchmark.task} · {a.tabular_model_benchmark.why}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                    <tr className="border-b border-slate-900/10">
                      <th className="py-2 pr-3 font-semibold">Model</th>
                      <th className="py-2 pr-3 text-right font-semibold">ROC-AUC</th>
                      <th className="py-2 pr-3 text-right font-semibold">Accuracy</th>
                      <th className="py-2 pr-3 text-right font-semibold">F1</th>
                      <th className="py-2 font-semibold">Role in the comparison</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BENCH_ROWS.map(([key, label, role]) => {
                      const r = a.tabular_model_benchmark.results[key];
                      return (
                        <tr key={key} className="border-b border-slate-900/5 last:border-0">
                          <td className="py-2 pr-3 font-medium text-slate-800">{label}</td>
                          <td className="py-2 pr-3 text-right font-semibold text-slate-800">{r ? r.auc.toFixed(4) : "pending"}</td>
                          <td className="py-2 pr-3 text-right text-slate-600">{r ? pctFixed(r.accuracy) : "—"}</td>
                          <td className="py-2 pr-3 text-right text-slate-600">{r ? r.f1_detected.toFixed(3) : "—"}</td>
                          <td className="py-2 text-[11px] leading-relaxed text-slate-500">{role}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-slate-900/10">
                      <td className="py-2 pr-3 text-slate-500">Majority-class baseline</td>
                      <td className="py-2 pr-3 text-right text-slate-400">—</td>
                      <td className="py-2 pr-3 text-right text-slate-600">{pctFixed(a.tabular_model_benchmark.baseline_majority_class_accuracy)}</td>
                      <td className="py-2 pr-3 text-right text-slate-400">—</td>
                      <td className="py-2 text-[11px] text-slate-500">Guessing &ldquo;detected&rdquo; every time — the floor every model must clear.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 rounded-lg bg-slate-900/[0.03] px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                <b className="text-slate-800">Protocol: </b>
                {a.tabular_model_benchmark.protocol.shared_holdout_rows.toLocaleString()} held-out rows,
                {" "}{a.tabular_model_benchmark.protocol.train_sample_rows.toLocaleString()} matched training rows,
                {" "}{a.tabular_model_benchmark.protocol.stratified}. {a.tabular_model_benchmark.protocol.why_capped}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{a.tabular_model_benchmark.verdict_note}</p>
            </Reveal>
          )}

          {/* Fidelity to KSP's own database design. The ER diagram is the only artefact KSP
              provided, so a reviewer will want to compare it against what we built — this makes
              that comparison possible instead of asking them to take a claim on trust. */}
          {a.er_conformance && (
            <Reveal className="glass rounded-3xl p-5">
              <div className="mb-1 flex items-center gap-2">
                <Database size={16} className="text-indigo-500" />
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  KSP ER schema — conformance
                  <InfoDot text="The official KSP ER diagram is a database DESIGN document containing no data. All 28 of its entities are declared under their exact names and column names, so real SCRB data could be loaded without a translation layer. Where we populate nothing, the blocker is named rather than the table quietly omitted." />
                </div>
              </div>
              <p className="mb-3 max-w-4xl text-[11px] leading-relaxed text-slate-500">
                Our serving schema is analytical (aggregates and model outputs); KSP&apos;s is a
                normalised transactional design. Both are declared: all 28 ER entities exist as a
                loadable contract, and this table says exactly how much of it our de-identified
                extract can support.
              </p>

              <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                {[
                  ["Entities declared", a.er_conformance.entities_total, "all 28, exact ER names"],
                  ["Populated", (a.er_conformance.by_status.populated || 0) + (a.er_conformance.by_status.populated_subset || 0), "from the FIR extract"],
                  ["Declared, empty", a.er_conformance.by_status.designed_only || 0, "each names its blocker"],
                  ["Columns populated", `${a.er_conformance.columns_populated}/${a.er_conformance.columns_total}`, "column-level coverage"],
                ].map(([label, value, sub]) => (
                  <div key={label} className="neo-inset rounded-xl p-3">
                    <div className="text-lg font-bold text-slate-900">{value}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                    <tr className="border-b border-slate-900/10">
                      <th className="py-2 pr-3 font-semibold">ER entity</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 pr-3 font-semibold">Our table</th>
                      <th className="py-2 pr-3 text-right font-semibold">Cols</th>
                      <th className="py-2 pr-3 text-right font-semibold">Rows</th>
                      <th className="py-2 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.er_conformance.entities.map((e) => {
                      const st = ER_STATUS[e.status] || ER_STATUS.designed_only;
                      return (
                        <tr key={e.er_entity} className="border-b border-slate-900/5 last:border-0">
                          <td className="py-2 pr-3 font-mono text-[11px] font-medium text-slate-800">{e.er_entity}</td>
                          <td className="py-2 pr-3">
                            <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${st.cls}`}>{st.label}</span>
                          </td>
                          <td className="py-2 pr-3 font-mono text-[10px] text-slate-500">{e.our_table || "—"}</td>
                          <td className="py-2 pr-3 text-right text-slate-600">{e.columns_populated}/{e.columns_total}</td>
                          <td className="py-2 pr-3 text-right text-slate-600">{e.row_count ? fmt(e.row_count) : "—"}</td>
                          <td className="py-2 text-[11px] leading-relaxed text-slate-500">{e.summary}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Why the empty ones are empty — stated once, in full, rather than per row. */}
              <div className="mt-3 space-y-1.5">
                {Object.entries(a.er_conformance.blocker_reasons || {}).map(([k, v]) => (
                  <p key={k} className="text-[11px] leading-relaxed text-slate-500">
                    <b className="text-slate-700">{k.replace(/_/g, " ")}:</b> {v}
                  </p>
                ))}
              </div>
              <p className="mt-3 rounded-lg bg-slate-900/[0.03] px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                {a.er_conformance.honesty}
              </p>
            </Reveal>
          )}

          {/* Which platform service backs which capability — published for the same reason the
              limitations are: a reviewer should not have to reverse engineer it. */}
          {a.catalyst_services && (
            <Reveal className="glass rounded-3xl p-5">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Server size={15} className="text-sky-500" /> Built on Catalyst — service map
                <InfoDot text="Every capability in this platform and the Catalyst service that provides it. Where our own code is used instead, the reason is stated — in each case no Catalyst service covers that algorithm." />
              </div>
              <p className="mb-2 max-w-4xl text-[11px] leading-relaxed text-slate-500">
                Deployed entirely on Zoho Catalyst. A service reads <b>Live</b> only when it is
                observably serving this request, so the table reports the real configuration rather
                than an intention.
              </p>
              {a.runtime && (
                <p className="mb-3 max-w-4xl rounded-lg bg-slate-900/[0.03] px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                  <b className="text-slate-800">{a.runtime.on_catalyst ? "On Catalyst: " : "Off-platform: "}</b>
                  {a.runtime.note}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                    <tr className="border-b border-slate-900/10">
                      <th className="py-2 pr-3 font-semibold">Capability</th>
                      <th className="py-2 pr-3 font-semibold">Service</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 font-semibold">How it is used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.catalyst_services.map((s) => {
                      const st = SERVICE_STATUS[s.status] || SERVICE_STATUS.configured;
                      return (
                        <tr key={s.capability} className="border-b border-slate-900/5 last:border-0">
                          <td className="py-2 pr-3 font-medium text-slate-800">{s.capability}</td>
                          <td className="py-2 pr-3 text-slate-600">{s.service}</td>
                          <td className="py-2 pr-3">
                            <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${st.cls}`}>{st.label}</span>
                          </td>
                          <td className="py-2 text-[11px] leading-relaxed text-slate-500">{s.detail}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Reveal>
          )}

          <Reveal className="glass rounded-3xl p-5">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <FlaskConical size={15} className="text-fuchsia-500" /> Synthetic data — scope &amp; containment
              <InfoDot text="The platform contains exactly one synthetic dataset: the person-network demo, which exists because person-level analysis is impossible on the real extract. Everything else is computed from real FIR records." />
            </div>
            <p className="max-w-4xl text-[12px] leading-relaxed text-slate-600">{a.synthetic_data}</p>
          </Reveal>

          <footer className="pt-1 text-center text-[11px] text-slate-500">
            Source: {a.source_file} · pipeline run {String(a.generated_at).slice(0, 10)}
          </footer>
        </>
      )}
    </div>
  );
}
