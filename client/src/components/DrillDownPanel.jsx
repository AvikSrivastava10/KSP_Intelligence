import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { fetchDistrict } from "../api/client.js";
import { useFilters } from "../state/store.js";

const pct = (x) => `${((x || 0) * 100).toFixed(1)}%`;

function RatePill({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-lg font-semibold text-emerald-300">{pct(value)}</div>
    </div>
  );
}

export default function DrillDownPanel() {
  const selected = useFilters((s) => s.selectedDistrict);
  const { data, isLoading, error } = useQuery({
    queryKey: ["district", selected],
    queryFn: () => fetchDistrict(selected),
    enabled: !!selected,
  });

  if (!selected)
    return (
      <div className="grid h-full min-h-[300px] place-items-center p-6 text-center text-sm text-slate-500">
        Click a district on the map to see its monthly trend, crime mix, and case outcomes.
      </div>
    );
  if (isLoading) return <div className="p-4 text-sm text-slate-400">Loading {selected}…</div>;
  if (error) return <div className="p-4 text-sm text-rose-400">Error: {String(error.message)}</div>;

  const r = data.result;
  const monthly = r.monthly || [];
  const monthlyOption = {
    grid: { left: 48, right: 12, top: 16, bottom: 24 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: monthly.map((m) => m.ym),
      axisLabel: { color: "#64748b", interval: Math.ceil(monthly.length / 8) },
      axisLine: { lineStyle: { color: "#475569" } },
    },
    yAxis: { type: "value", axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#1e293b" } } },
    series: [{ type: "line", data: monthly.map((m) => m.count), smooth: true, showSymbol: false, lineStyle: { color: "#38bdf8" }, areaStyle: { color: "rgba(56,189,248,0.12)" } }],
  };

  const cats = (r.categories || []).slice(0, 8).reverse();
  const catOption = {
    grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", axisLabel: { color: "#64748b" }, splitLine: { lineStyle: { color: "#1e293b" } } },
    yAxis: { type: "category", data: cats.map((c) => c.major_head), axisLabel: { color: "#cbd5e1", width: 130, overflow: "truncate" } },
    series: [{ type: "bar", data: cats.map((c) => c.count), itemStyle: { color: "#6366f1" }, barWidth: "60%" }],
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="text-base font-semibold">{r.district}</div>
        <div className="text-xs text-slate-400">
          {(r.outcomes?.total_cases || 0).toLocaleString()} FIRs
          {r.members && r.members.length > 1 ? ` · ${r.members.length} units` : ""} · kgis {r.kgis_code}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RatePill label="Arrest rate" value={r.outcomes?.arrest_rate} />
        <RatePill label="Chargesheet rate" value={r.outcomes?.chargesheet_rate} />
        <RatePill label="Conviction rate" value={r.outcomes?.conviction_rate} />
        <RatePill label="Detection rate" value={r.outcomes?.detection_rate} />
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-slate-300">Monthly FIRs (2016–2024)</div>
        <ReactECharts option={monthlyOption} style={{ height: 160 }} notMerge />
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-slate-300">Top crime heads</div>
        <ReactECharts option={catOption} style={{ height: 200 }} notMerge />
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-slate-300">Top police stations</div>
        <div className="space-y-1">
          {(r.top_units || []).slice(0, 5).map((u) => (
            <div key={u.unit_name} className="flex items-center justify-between text-xs">
              <span className="truncate text-slate-300">{u.unit_name}</span>
              <span className="text-slate-500">{u.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
