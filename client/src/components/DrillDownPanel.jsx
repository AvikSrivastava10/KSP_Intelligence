import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { MapPin, X } from "lucide-react";
import { fetchDistrict } from "../api/client.js";
import { useFilters } from "../state/store.js";

const pct = (x) => `${((x || 0) * 100).toFixed(1)}%`;

function RatePill({ label, value }) {
  return (
    <div className="neo rounded-xl px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold text-indigo-600">{pct(value)}</div>
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
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
            <MapPin size={22} />
          </div>
          <div className="text-sm font-medium text-slate-700">No district selected</div>
          <div className="mx-auto mt-1 max-w-[220px] text-xs text-slate-500">
            District-level monthly trend, crime mix, and case outcomes appear here.
          </div>
        </div>
      </div>
    );
  if (isLoading) return <div className="p-5 text-sm text-slate-500">Loading {selected}…</div>;
  if (error) return <div className="p-5 text-sm text-rose-600">Error: {String(error.message)}</div>;

  const r = data.result;
  const monthly = r.monthly || [];
  const monthlyOption = {
    grid: { left: 44, right: 12, top: 14, bottom: 22 },
    tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,0.97)", borderColor: "rgba(15,23,42,0.12)", textStyle: { color: "#0f172a" } },
    xAxis: {
      type: "category",
      data: monthly.map((m) => m.ym),
      axisLabel: { color: "#94a3b8", interval: Math.ceil(monthly.length / 7), fontSize: 10 },
      axisLine: { lineStyle: { color: "rgba(15,23,42,0.15)" } },
      axisTick: { show: false },
    },
    yAxis: { type: "value", axisLabel: { color: "#94a3b8", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(15,23,42,0.07)" } } },
    series: [
      {
        type: "line", data: monthly.map((m) => m.count), smooth: true, showSymbol: false,
        lineStyle: { color: "#2563eb", width: 2 },
        areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(37,99,235,0.22)" }, { offset: 1, color: "rgba(37,99,235,0.02)" }] } },
      },
    ],
  };

  const cats = (r.categories || []).slice(0, 8).reverse();
  const catOption = {
    grid: { left: 8, right: 26, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "rgba(255,255,255,0.97)", borderColor: "rgba(15,23,42,0.12)", textStyle: { color: "#0f172a" } },
    xAxis: { type: "value", axisLabel: { color: "#94a3b8", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(15,23,42,0.07)" } } },
    yAxis: { type: "category", data: cats.map((c) => c.major_head), axisLabel: { color: "#475569", width: 128, overflow: "truncate", fontSize: 10 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [
      {
        type: "bar", data: cats.map((c) => c.count), barWidth: "58%",
        itemStyle: { borderRadius: [0, 4, 4, 0], color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: "#6366f1" }, { offset: 1, color: "#a855f7" }] } },
      },
    ],
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-bold text-slate-900">{r.district}</div>
          <div className="text-xs text-slate-500">
            {(r.outcomes?.total_cases || 0).toLocaleString()} FIRs
            {r.members && r.members.length > 1 ? ` · ${r.members.length} units` : ""} · kgis {r.kgis_code}
          </div>
        </div>
        <button onClick={() => selectDistrict(null)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-900/[0.05] hover:text-slate-700" title="Clear">
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
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Monthly FIRs · 2016–2024</div>
        <ReactECharts option={monthlyOption} style={{ height: 150 }} notMerge />
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Top crime heads</div>
        <ReactECharts option={catOption} style={{ height: 190 }} notMerge />
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Top police stations</div>
        <div className="space-y-1">
          {(r.top_units || []).slice(0, 5).map((u) => (
            <div key={u.unit_name} className="flex items-center justify-between rounded-lg bg-slate-900/[0.03] px-2.5 py-1.5 text-xs">
              <span className="truncate text-slate-700">{u.unit_name}</span>
              <span className="font-medium text-slate-500">{u.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
