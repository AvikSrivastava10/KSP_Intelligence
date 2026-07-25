import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck, Database, AlertOctagon, Scale, CheckCircle2, XCircle, Info, Printer, FlaskConical,
} from "lucide-react";
import DataClassBadge from "../components/DataClassBadge.jsx";
import KpiCard from "../components/KpiCard.jsx";
import InfoDot from "../components/InfoDot.jsx";
import Reveal from "../components/Reveal.jsx";
import { fetchAudit, fetchValidation } from "../api/client.js";

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-IN") : n ?? "—");
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
        <button
          onClick={() => window.print()}
          className="no-print neo flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:text-indigo-600"
        >
          <Printer size={14} /> Export audit
        </button>
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
