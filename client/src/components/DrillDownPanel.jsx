import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { MapPin, X } from "lucide-react";
import { fetchDistrict } from "../api/client.js";
import { useFilters } from "../state/store.js";

const pct = (x) => `${((x || 0) * 100).toFixed(1)}%`;

function RatePill({ label, value }) {
  return (
    <div className="neo rounded-xl px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-lg font-bold text-ksp-gold">{pct(value)}</div>
    </div>
  );
}

export default function DrillDownPanel() {
  const selected = useFilters((s) => s.selectedDistrict);
  const selectDistrict = useFilters((s) => s.selectDistrict);
  const { data, isLoading, error } = useQuery({
    queryKey: ["district", selected],
    queryFn: () => fetchDistrict(selected),
    enabled: !!selected,
  });

  if (!selected)
    return (
      <div className="grid h-full min-h-[340px] place-items-center p-8 text-center">
        <div>
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-ksp-gold">
            <MapPin size={22} />
          </div>
          <div className="text-sm font-medium text-slate-300">Select a district</div>
          <div className="mx-auto mt-1 max-w-[220px] text-xs text-slate-500">
            Click any district on the map to reveal its monthly trend, crime mix, and case outcomes.
          </div>
        </div>
      </div>
    );
  if (isLoading) return <div className="p-5 text-sm text-slate-400">Loading {selected}…</div>;
  if (error) return <div className="p-5 text-sm text-rose-400">Error: {String(error.message)}</div>;

  const r = data.result;
  const monthly = r.monthly || [];
  const monthlyOption = {
    grid: { left: 44, right: 12, top: 14, bottom: 22 },
    tooltip: { trigger: "axis", backgroundColor: "rgba(10,10,12,0.92)", borderColor: "rgba(255,255,255,0.3)", textStyle: { color: "#e5e5e8" } },
    xAxis: {
      type: "category",
      data: monthly.map((m) => m.ym),
      axisLabel: { color: "#64748b", interval: Math.ceil(monthly.length / 7), fontSize: 10 },
      axisLine: { lineStyle: { color: "rgba(148,163,184,0.3)" } },
      axisTick: { show: false },
    },
    yAxis: { type: "value", axisLabel: { color: "#94a3b8", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(148,163,184,0.1)" } } },
    series: [
      {
        type: "line", data: monthly.map((m) => m.count), smooth: true, showSymbol: false,
        lineStyle: { color: "#d4d4d8", width: 2 },
        areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(255,255,255,0.24)" }, { offset: 1, color: "rgba(255,255,255,0.02)" }] } },
      },
    ],
  };

  const cats = (r.categories || []).slice(0, 8).reverse();
  const catOption = {
    grid: { left: 8, right: 26, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "rgba(10,10,12,0.92)", borderColor: "rgba(255,255,255,0.3)", textStyle: { color: "#e5e5e8" } },
    xAxis: { type: "value", axisLabel: { color: "#64748b", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(148,163,184,0.1)" } } },
    yAxis: { type: "category", data: cats.map((c) => c.major_head), axisLabel: { color: "#cbd5e1", width: 128, overflow: "truncate", fontSize: 10 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [
      {
        type: "bar", data: cats.map((c) => c.count), barWidth: "58%",
        itemStyle: { borderRadius: [0, 4, 4, 0], color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: "#71717a" }, { offset: 1, color: "#e4e4e7" }] } },
      },
    ],
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-bold text-white">{r.district}</div>
          <div className="text-xs text-slate-400">
            {(r.outcomes?.total_cases || 0).toLocaleString()} FIRs
            {r.members && r.members.length > 1 ? ` · ${r.members.length} units` : ""} · kgis {r.kgis_code}
          </div>
        </div>
        <button onClick={() => selectDistrict(null)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white" title="Clear">
          <X size={15} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RatePill label="Arrest" value={r.outcomes?.arrest_rate} />
        <RatePill label="Chargesheet" value={r.outcomes?.chargesheet_rate} />
        <RatePill label="Conviction" value={r.outcomes?.conviction_rate} />
        <RatePill label="Detection" value={r.outcomes?.detection_rate} />
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Monthly FIRs · 2016–2024</div>
        <ReactECharts option={monthlyOption} style={{ height: 150 }} notMerge />
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Top crime heads</div>
        <ReactECharts option={catOption} style={{ height: 190 }} notMerge />
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Top police stations</div>
        <div className="space-y-1">
          {(r.top_units || []).slice(0, 5).map((u) => (
            <div key={u.unit_name} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs">
              <span className="truncate text-slate-300">{u.unit_name}</span>
              <span className="font-medium text-slate-400">{u.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
