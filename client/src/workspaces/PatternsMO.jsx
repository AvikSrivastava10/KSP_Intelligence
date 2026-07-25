import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { Network, CalendarClock, Gavel, Layers, Fingerprint, Clock, MapPin, X, Sparkles } from "lucide-react";
import DataClassBadge from "../components/DataClassBadge.jsx";
import KpiCard from "../components/KpiCard.jsx";
import InfoDot from "../components/InfoDot.jsx";
import Reveal from "../components/Reveal.jsx";
import { fetchMoClusters, fetchTemporal, fetchOutcomes, fetchOutcomeDrivers } from "../api/client.js";

const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n ?? "—");
const pct = (x) => `${((x || 0) * 100).toFixed(1)}%`;
const PALETTE = ["#6366f1", "#0ea5e9", "#f59e0b", "#ef4444", "#10b981", "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#64748b"];
const clusterColor = (i) => PALETTE[i % PALETTE.length];

export default function PatternsMO() {
  const [district, setDistrict] = useState("");   // "" = statewide
  const [selected, setSelected] = useState(null);  // selected MO cluster_id

  const moQ = useQuery({ queryKey: ["mo-clusters"], queryFn: fetchMoClusters });
  const tempQ = useQuery({ queryKey: ["temporal", district || "all"], queryFn: () => fetchTemporal(district || undefined) });
  const outQ = useQuery({ queryKey: ["outcomes"], queryFn: fetchOutcomes });
  const drvQ = useQuery({ queryKey: ["outcome-drivers"], queryFn: fetchOutcomeDrivers });

  const clusters = moQ.data?.result?.clusters || [];
  const temporal = tempQ.data?.result;
  const outcomes = outQ.data?.result;
  const drivers = drvQ.data?.result;
  const selectedCluster = clusters.find((c) => c.cluster_id === selected) || null;
  const districtNames = useMemo(() => (outcomes?.districts || []).map((d) => d.district).sort(), [outcomes]);

  // ---- temporal heatmap option ----
  const heatOption = useMemo(() => {
    if (!temporal) return null;
    const { cells, dow_labels, month_labels } = temporal;
    const max = Math.max(1, ...cells.map((c) => c.count));
    return {
      tooltip: {
        position: "top",
        formatter: (p) => `${dow_labels[p.value[1]]} · ${month_labels[p.value[0]]}<br/><b>${p.value[2].toLocaleString()}</b> FIRs`,
      },
      grid: { left: 42, right: 12, top: 8, bottom: 58 },
      xAxis: { type: "category", data: month_labels, splitArea: { show: true }, axisLabel: { fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: "category", data: dow_labels, splitArea: { show: true }, axisLabel: { fontSize: 10 }, axisTick: { show: false }, inverse: true },
      visualMap: {
        min: 0, max, calculable: true, orient: "horizontal", left: "center", bottom: 4, itemHeight: 90,
        inRange: { color: ["#eef2ff", "#c7d2fe", "#fcd34d", "#fb923c", "#ef4444", "#b10026"] },
        textStyle: { fontSize: 10, color: "#64748b" },
      },
      series: [{
        type: "heatmap", name: "FIRs",
        data: cells.map((c) => [c.month - 1, c.dow, c.count]),
        emphasis: { itemStyle: { shadowBlur: 6, borderColor: "#0f172a", borderWidth: 1.2 } },
        itemStyle: { borderColor: "#ffffff", borderWidth: 1 },
        progressive: 0,
      }],
    };
  }, [temporal]);

  // ---- detection drivers bar ----
  const driverOption = useMemo(() => {
    if (!drivers) return null;
    const top = drivers.drivers.slice(0, 8).reverse();
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p) => `${p[0].name}<br/><b>${p[0].value}%</b> of model signal` },
      grid: { left: 138, right: 24, top: 6, bottom: 22 },
      xAxis: { type: "value", axisLabel: { formatter: "{value}%", fontSize: 10 }, splitLine: { lineStyle: { color: "#eef2f7" } } },
      yAxis: { type: "category", data: top.map((d) => d.label), axisLabel: { fontSize: 10, color: "#475569" }, axisTick: { show: false } },
      series: [{
        type: "bar", data: top.map((d) => d.importance_detection_pct),
        itemStyle: { color: "#6366f1", borderRadius: [0, 4, 4, 0] }, barWidth: "60%",
      }],
    };
  }, [drivers]);

  const kpiBusiest = temporal ? temporal.peak_dow : "—";
  const topMo = clusters[0];

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Patterns &amp; MO</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Recurring modus-operandi patterns, when crime clusters through the week and year, and what
            separates cases that get solved from those that don&apos;t. <DataClassBadge kind="real" />
          </p>
        </div>
      </div>

      {(moQ.error || outQ.error) && (
        <div className="glass rounded-2xl border border-rose-300 p-3 text-sm text-rose-600">Could not load pattern data from crime_api.</div>
      )}

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Reveal delay={0}><KpiCard label="MO clusters" value={clusters.length || "—"} sub="distinct crime-profile groups" icon={Layers} accent="violet" /></Reveal>
        <Reveal delay={70}><KpiCard label="Largest MO pattern" value={topMo ? topMo.top_crime_head.toLowerCase() : "—"} sub={topMo ? `${topMo.share_pct}% of clustered incidents` : ""} icon={Fingerprint} accent="saffron" /></Reveal>
        <Reveal delay={140}><KpiCard label="Busiest weekday" value={kpiBusiest} sub={temporal ? `peak: ${temporal.peak?.label || "—"}` : "day-of-week × month"} icon={CalendarClock} accent="sky" /></Reveal>
        <Reveal delay={210}><KpiCard label="Detection rate" value={outcomes ? pct(outcomes.statewide.detection_rate) : "—"} sub="of closed cases (detected vs undetected)" icon={Gavel} accent="emerald" /></Reveal>
      </div>

      {/* Temporal heatmap + MO explorer */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Heatmap */}
        <Reveal className="glass rounded-3xl lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-900/10 px-4 py-3">
            <div className="flex items-start gap-2">
              <CalendarClock size={16} className="mt-0.5 text-sky-500" />
              <div>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  When crime happens — day of week × month
                  <InfoDot text="Each cell counts FIRs filed on that weekday in that month, 2016–2024. Darker = more incidents. Reveals weekly and seasonal rhythm; note the FIR extract has no clock time, so time-of-day is not shown here." />
                </div>
                <div className="text-[11px] text-slate-500">Darker cells = more FIRs. Based on the recorded incident date.</div>
              </div>
            </div>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              aria-label="Filter heatmap by district"
              className="neo-inset rounded-lg bg-transparent px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none"
            >
              <option value="">All Karnataka</option>
              {districtNames.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="px-3 pt-3">
            {heatOption ? <ReactECharts option={heatOption} style={{ height: 300 }} notMerge /> : <div className="grid h-[300px] place-items-center text-sm text-slate-500">Loading heatmap…</div>}
          </div>
          {temporal && (
            <div className="mx-4 mb-4 flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-50/70 px-3 py-2 text-[12px] text-slate-600">
              <Sparkles size={14} className="mt-0.5 shrink-0 text-sky-500" />
              <span>{temporal.callout}</span>
            </div>
          )}
        </Reveal>

        {/* MO cluster explorer */}
        <div className="lg:col-span-2">
          {selectedCluster ? (
            <div className="glass rounded-3xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: clusterColor(clusters.indexOf(selectedCluster)) }} />
                  {selectedCluster.top_crime_head.toLowerCase()}
                </div>
                <button title="Back to clusters" onClick={() => setSelected(null)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-900/[0.05] hover:text-slate-700"><X size={15} /></button>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-600">{selectedCluster.mo_description}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label="incidents" value={fmt(selectedCluster.size)} />
                <Stat label="share" value={`${selectedCluster.share_pct}%`} />
                <Stat label="heinous" value={pct(selectedCluster.heinous_share)} />
              </div>
              <div className="mt-3 space-y-1.5 text-[12px] text-slate-600">
                <Row icon={Fingerprint} label="Sub-type" value={`${selectedCluster.top_crime_subhead} · u/s ${selectedCluster.top_section}`} />
                <Row icon={MapPin} label="Concentrated in" value={selectedCluster.top_districts.slice(0, 3).join(", ")} />
                <Row icon={Clock} label="Est. time" value={<>{selectedCluster.time_profile} <span className="text-[10px] text-amber-600">· modeled</span></>} />
              </div>
              {selectedCluster.members?.length > 0 && (
                <div className="mt-3 border-t border-slate-900/5 pt-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recurring sub-heads in this MO</div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCluster.members.slice(0, 8).map((m) => (
                      <span key={m.crime_subhead} className="rounded-full bg-slate-900/[0.05] px-2 py-0.5 text-[10px] text-slate-600">{m.crime_subhead}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="glass rounded-3xl p-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Network size={15} className="text-violet-500" /> MO clusters
                <InfoDot text="Incidents grouped by modus operandi — crime type, legal section, area and season — using HDBSCAN clustering (silhouette 0.68). Each group is a recurring pattern. Ordered by size." />
              </div>
              <div className="max-h-[360px] space-y-1.5 overflow-y-auto pr-1">
                {clusters.slice(0, 24).map((c, i) => (
                  <button key={c.cluster_id} onClick={() => setSelected(c.cluster_id)} title={c.mo_description} className="w-full rounded-xl border border-slate-900/8 bg-white/60 p-2.5 text-left transition-colors hover:bg-white">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: clusterColor(i) }} />
                        <span className="truncate text-xs font-semibold text-slate-800">{c.top_crime_head.toLowerCase()}</span>
                      </span>
                      <span className="shrink-0 text-[11px] font-medium text-slate-500">{fmt(c.size)}</span>
                    </div>
                    <div className="mt-0.5 truncate pl-4 text-[10px] text-slate-500">{c.top_crime_subhead} · {c.top_districts[0]} · {c.time_profile}</div>
                  </button>
                ))}
              </div>
              {clusters.length > 24 && <div className="mt-2 text-[10px] text-slate-400">Showing the 24 largest of {clusters.length} MO clusters.</div>}
            </div>
          )}
        </div>
      </div>

      {/* Outcome analytics */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Drivers of detection */}
        <Reveal className="glass rounded-3xl lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900/10 px-4 py-3">
            <div className="flex items-start gap-2">
              <Gavel size={16} className="mt-0.5 text-emerald-500" />
              <div>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  What&apos;s associated with a case being solved
                  <InfoDot text="A LightGBM model predicts whether a case ends detected (offender identified) vs undetected. Bars show which filing-time factors carry the most signal — associations, NOT causes. No caste, religion, sex, or post-filing outcome fields are used." />
                </div>
                <div className="text-[11px] text-slate-500">Relative influence on the detected-vs-undetected model. Associations, not causation.</div>
              </div>
            </div>
            <DataClassBadge kind="real" />
          </div>
          <div className="px-3 pt-3">
            {driverOption ? <ReactECharts option={driverOption} style={{ height: 240 }} notMerge /> : <div className="grid h-[240px] place-items-center text-sm text-slate-500">Loading drivers…</div>}
          </div>
          {drivers?.binary_detection && drivers?.multiclass && (
            <div className="grid grid-cols-3 gap-2 px-4 pb-4">
              <ModelStat label="Detection AUC" value={(drivers.binary_detection.auc_mean ?? 0).toFixed(3)} sub={`vs ${pct(1 - drivers.binary_detection.undetected_base_rate)} baseline`} tip="Area under ROC for the detected/undetected model (3-fold CV). 0.5 = chance, 1.0 = perfect. Honest given the ~13% undetected base rate." />
              <ModelStat label="Detection acc." value={pct(drivers.binary_detection.accuracy)} sub={`baseline ${pct(drivers.binary_detection.baseline_accuracy)}`} tip="Share of cases correctly classified as detected/undetected, vs always guessing the majority (detected)." />
              <ModelStat label="Stage model" value={pct(drivers.multiclass.accuracy)} sub={`13-class · F1 ${(drivers.multiclass.macro_f1 ?? 0).toFixed(2)}`} tip="Multi-class model predicting the full FIR stage (13 classes). Accuracy + macro-F1 vs a 29.8% majority baseline." />
            </div>
          )}
        </Reveal>

        {/* Per-district outcomes */}
        <Reveal className="glass rounded-3xl p-4 lg:col-span-2">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Gavel size={15} className="text-emerald-500" /> Detection by district
            <InfoDot text="Share of closed cases where the offender was identified (detected vs undetected). Cases still under investigation, false cases and transfers are excluded here — so this can differ slightly from the Dashboard's detection KPI, which counts every status. Conviction rate = convictions ÷ all cases." />
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {(outcomes?.districts || []).slice(0, 16).map((d) => (
              <div key={d.district}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{d.district}</span>
                  <span className="font-semibold text-emerald-600">{pct(d.detection_rate)}</span>
                </div>
                <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-900/[0.06]">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${d.detection_rate * 100}%` }} />
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">{fmt(d.cases)} cases · {pct(d.conviction_rate)} convicted</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>

      <footer className="pt-1 text-center text-[11px] text-slate-500">
        MO clustering (HDBSCAN) &amp; case-outcome models (LightGBM) run offline on real FIR data · time-of-day is modeled.
      </footer>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="neo-inset rounded-xl p-2">
      <div className="text-base font-bold text-slate-900">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={13} className="mt-0.5 shrink-0 text-slate-400" />
      <span className="text-slate-400">{label}:</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}
function ModelStat({ label, value, sub, tip }) {
  return (
    <div className="neo-inset rounded-xl p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-base font-bold text-slate-900">{value}<InfoDot text={tip} /></div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-[10px] text-slate-400">{sub}</div>
    </div>
  );
}
