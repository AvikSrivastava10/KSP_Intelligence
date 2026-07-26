import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Target, AlertTriangle, TrendingUp, TrendingDown, Activity, MapPin,
  Gavel, Printer, Layers, ArrowRight,
} from "lucide-react";
import DataClassBadge from "../components/DataClassBadge.jsx";
import KpiCard from "../components/KpiCard.jsx";
import InfoDot from "../components/InfoDot.jsx";
import Reveal from "../components/Reveal.jsx";
import { fetchHub, reportBriefingUrl } from "../api/client.js";

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-IN") : n ?? "—");
const pct = (x) => `${((x || 0) * 100).toFixed(1)}%`;
const TIER_COLOR = { Critical: "#991b1b", High: "#ef4444", Moderate: "#f59e0b", Low: "#22c55e" };

export default function StrategicHub() {
  const { data, isLoading, error } = useQuery({ queryKey: ["hub"], queryFn: fetchHub });
  const h = data?.result;
  const priority = h?.priority?.districts || [];
  const converging = priority.filter((d) => d.signals === 3);
  const rising = h?.forecast?.direction === "rising";

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Strategic Intelligence Hub</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
            One command view: where every model agrees attention is needed, what is rising, and
            where to deploy first. <DataClassBadge kind="real" />
          </p>
        </div>
        {/* Server-rendered via Catalyst SmartBrowz, not window.print(): a briefing that exists on
            the server can be scheduled and circulated to a district SP, and it renders identically
            for everyone instead of depending on one analyst's print dialog. */}
        <a
          href={reportBriefingUrl()}
          target="_blank"
          rel="noreferrer"
          className="no-print neo flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:text-indigo-600"
        >
          <Printer size={14} /> Export briefing (PDF)
        </a>
      </div>

      {error && <div className="glass rounded-2xl border border-rose-300 p-3 text-sm text-rose-600">Could not load the hub from crime_api.</div>}
      {isLoading && <div className="text-sm text-slate-500">Assembling statewide picture…</div>}

      {h && (
        <>
          {/* Headline */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Reveal delay={0}>
              <KpiCard label="Priority districts" value={h.priority.converging_count}
                sub={`flagged by all 3 models · of ${h.priority.total_districts}`} icon={Target} accent="rose" />
            </Reveal>
            <Reveal delay={70}>
              <KpiCard label="Active red-zones" value={h.alerts.red}
                sub={`${h.alerts.amber} moderate · ${h.alerts.total} total`} icon={AlertTriangle} accent="saffron" />
            </Reveal>
            <Reveal delay={140}>
              <KpiCard label="Projected · next 12 mo" value={fmt(h.forecast.projected_next_12mo)}
                sub={`${rising ? "▲" : "▼"} ${Math.abs(h.forecast.change_pct ?? 0)}% vs last full year`}
                icon={rising ? TrendingUp : TrendingDown} accent="violet" />
            </Reveal>
            <Reveal delay={210}>
              <KpiCard label="Detection rate" value={pct(h.statewide_detection_rate)}
                sub={`${fmt(h.anomalies_total)} anomalies on record`} icon={Gavel} accent="emerald" />
            </Reveal>
          </div>

          {/* The synthesis — this is what the Hub adds over the individual pages */}
          <Reveal className="glass rounded-3xl p-5">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target size={16} className="text-rose-500" />
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  Where the models agree
                  <InfoDot text="Three models run independently: predicted risk tier, emerging-trend alerts, and historical anomalies. A district listed here was flagged by all three. Agreement across independent methods is a far stronger signal than any single model, which is why this — not a single ranking — leads the hub." />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">{h.priority.signal_breakdown.three} all three</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{h.priority.signal_breakdown.two} two</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{h.priority.signal_breakdown.one} one</span>
              </div>
            </div>
            <p className="mb-3 max-w-4xl text-[11px] leading-relaxed text-slate-500">
              A two-of-three threshold would flag most of the state, so this list requires all three
              models to concur — {h.priority.converging_count} of {h.priority.total_districts} districts.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-900/10">
                    <th className="py-2 pr-3 font-semibold">District</th>
                    <th className="py-2 pr-3 font-semibold">Risk tier</th>
                    <th className="py-2 pr-3 text-right font-semibold">Red-zones</th>
                    <th className="py-2 pr-3 text-right font-semibold">Anomalies</th>
                    <th className="py-2 pr-3 text-right font-semibold">Detection</th>
                    <th className="py-2 font-semibold">Sharpest rise</th>
                  </tr>
                </thead>
                <tbody>
                  {(converging.length ? converging : priority).slice(0, 8).map((d) => (
                    <tr key={d.district} className="border-b border-slate-900/5 last:border-0">
                      <td className="py-2 pr-3 font-semibold text-slate-800">
                        <span className="flex items-center gap-1.5">
                          {d.signals === 3 && <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-rose-500" />}
                          {d.district}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                          style={{ background: TIER_COLOR[d.risk_tier] || "#94a3b8" }}>
                          {d.risk_tier || "—"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right font-medium text-rose-600">{d.red_alerts || "—"}</td>
                      <td className="py-2 pr-3 text-right text-violet-600">{d.anomalies || "—"}</td>
                      <td className="py-2 pr-3 text-right text-slate-600">{d.detection_rate != null ? pct(d.detection_rate) : "—"}</td>
                      <td className="py-2 text-slate-500">
                        {d.top_alert ? (
                          <span className="truncate">{d.top_alert.category.toLowerCase()} <span className="font-semibold text-rose-600">+{d.top_alert.deviation_pct}%</span></span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* Deployment recommendations */}
            <Reveal className="glass rounded-3xl p-5 lg:col-span-3">
              <div className="mb-1 flex items-center gap-2">
                <MapPin size={16} className="text-sky-500" />
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  Priority deployment areas
                  <InfoDot text="The largest spatial clusters found by the hotspot model (KDE + DBSCAN) on real GPS and station-pinned incidents. District-centroid records are excluded — they would form fake clusters at district centres." />
                </div>
              </div>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
                Highest-density incident clusters statewide, with their dominant crime type.
              </p>
              <div className="space-y-2">
                {h.deployments.map((d, i) => (
                  <div key={`${d.district}-${i}`} className="rounded-xl border border-slate-900/8 bg-white/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                        <span className="grid h-5 w-5 place-items-center rounded-md bg-sky-100 text-[10px] font-bold text-sky-700">{i + 1}</span>
                        {d.district}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-500">{fmt(d.total_count)} FIRs · ~{d.radius_km} km</span>
                    </div>
                    <div className="mt-1 pl-7 text-[11px] capitalize text-slate-500">
                      dominant: {String(d.top_category || "n/a").toLowerCase()}
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>

            {/* Jump-off links */}
            <Reveal className="glass rounded-3xl p-5 lg:col-span-2">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Layers size={15} className="text-violet-500" /> Drill deeper
              </div>
              <div className="space-y-2">
                {[
                  { to: "/risk", label: "Risk & Vulnerability", desc: "why each district ranks where it does", icon: Target },
                  { to: "/trends", label: "Trends & Forecast", desc: "the 12-month projection and red-zones", icon: TrendingUp },
                  { to: "/hotspots", label: "Hotspot Map", desc: "street-level clusters and stations", icon: MapPin },
                  { to: "/patterns", label: "Patterns & MO", desc: "recurring modus operandi, case outcomes", icon: Activity },
                  { to: "/audit", label: "Data Quality & Fairness", desc: "what this platform cannot tell you", icon: Gavel },
                ].map((l) => (
                  <Link key={l.to} to={l.to}
                    className="group flex items-center gap-3 rounded-xl border border-slate-900/8 bg-white/60 p-3 transition-colors hover:border-indigo-300 hover:bg-white">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900/[0.05] text-slate-500 group-hover:text-indigo-600">
                      <l.icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-slate-800">{l.label}</span>
                      <span className="block truncate text-[11px] text-slate-500">{l.desc}</span>
                    </span>
                    <ArrowRight size={14} className="shrink-0 text-slate-300 group-hover:text-indigo-500" />
                  </Link>
                ))}
              </div>
            </Reveal>
          </div>

          <footer className="pt-1 text-center text-[11px] text-slate-500">
            Synthesised across all models from {fmt(1674734)} real FIRs (2016–2024) · 2024 is a partial year.
          </footer>
        </>
      )}
    </div>
  );
}
