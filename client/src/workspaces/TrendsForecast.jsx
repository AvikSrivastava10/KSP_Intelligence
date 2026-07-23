import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { TrendingUp, AlertTriangle, Layers3 } from "lucide-react";
import DataClassBadge from "../components/DataClassBadge.jsx";
import Reveal from "../components/Reveal.jsx";
import { fetchForecast, fetchForecastOptions, fetchAlerts } from "../api/client.js";

const asset = (p) => `${import.meta.env.BASE_URL}${p}`;
const pad2 = (c) => String(c).padStart(2, "0");
const SEV = { red: "#dc2626", amber: "#f59e0b" };
const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);
const ymLabel = (p) => `${p.year}-${pad2(p.month)}`;

export default function TrendsForecast() {
  const [scope, setScope] = useState({ level: "state", key: "", category: "" });
  const [sevFilter, setSevFilter] = useState("all");

  const optionsQ = useQuery({ queryKey: ["fc-options"], queryFn: fetchForecastOptions });
  const fcQ = useQuery({
    queryKey: ["forecast", scope.level, scope.key, scope.category],
    queryFn: () => fetchForecast(scope.level, scope.key || undefined, scope.category || undefined),
  });
  const alertsQ = useQuery({ queryKey: ["alerts"], queryFn: () => fetchAlerts() });
  const geoQ = useQuery({ queryKey: ["geojson"], queryFn: async () => (await fetch(asset("karnataka_districts.geojson"))).json(), staleTime: Infinity });

  const districts = optionsQ.data?.result?.districts || [];
  const categories = optionsQ.data?.result?.categories || [];

  // Keep the selector in sync if options arrive after a tab switch (so the dropdown matches the chart).
  useEffect(() => {
    if (scope.level === "district" && !scope.key && districts.length) setScope((s) => ({ ...s, key: districts[0] }));
    if (scope.level === "category" && !scope.category && categories.length) setScope((s) => ({ ...s, category: categories[0] }));
  }, [scope.level, scope.key, scope.category, districts, categories]);
  const points = fcQ.data?.result?.points || [];
  const allAlerts = alertsQ.data?.result?.alerts || [];
  const alerts = useMemo(
    () => (sevFilter === "all" ? allAlerts : allAlerts.filter((a) => a.severity === sevFilter)),
    [allAlerts, sevFilter]
  );

  // worst-severity per district (kgis) for the red-zone choropleth
  const zoneByKgis = useMemo(() => {
    const m = {};
    for (const a of allAlerts) {
      const k = pad2(a.kgis_code);
      if (!m[k] || (m[k].severity === "amber" && a.severity === "red")) {
        m[k] = { severity: a.severity, district: a.canonical_name };
      }
    }
    return m;
  }, [allAlerts]);

  const chart = useMemo(() => {
    if (!points.length) return null;
    const labels = points.map(ymLabel);
    const split = points.findIndex((p) => p.is_forecast === 1);
    const actual = points.map((p) => (p.is_forecast === 0 ? p.y_actual : null));
    const yhat = points.map((p) => (p.is_forecast === 1 ? p.yhat : null));
    // CI band is defined at EVERY point (0-height over history -> invisible) so the stacked
    // area never has null gaps: base = ci-lower, height = band, top = ci-upper.
    const lower = points.map((p) => (p.is_forecast === 1 ? p.yhat_lower : p.y_actual));
    const band = points.map((p) => (p.is_forecast === 1 ? Math.max(0, p.yhat_upper - p.yhat_lower) : 0));
    if (split > 0) yhat[split - 1] = points[split - 1].y_actual; // connect dashed line to last actual
    return {
      grid: { left: 56, right: 18, top: 24, bottom: 40 },
      tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,0.97)", borderColor: "rgba(15,23,42,0.12)", textStyle: { color: "#0f172a" } },
      legend: { data: ["Actual", "Forecast"], right: 10, top: 0, textStyle: { color: "#475569", fontSize: 11 } },
      xAxis: {
        type: "category", data: labels, boundaryGap: false,
        axisLabel: { color: "#94a3b8", fontSize: 10, interval: (i) => i % 12 === 0, formatter: (v) => v.slice(0, 4) },
        axisLine: { lineStyle: { color: "rgba(15,23,42,0.15)" } },
      },
      yAxis: { type: "value", axisLabel: { color: "#94a3b8", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(15,23,42,0.07)" } } },
      series: [
        { name: "ci-lower", type: "line", data: lower, stack: "ci", lineStyle: { opacity: 0 }, symbol: "none", silent: true, z: 1 },
        { name: "Confidence", type: "line", data: band, stack: "ci", lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(124,58,237,0.16)" }, symbol: "none", silent: true, z: 1 },
        { name: "Actual", type: "line", data: actual, showSymbol: false, lineStyle: { color: "#4f46e5", width: 2 }, itemStyle: { color: "#4f46e5" }, z: 3 },
        { name: "Forecast", type: "line", data: yhat, showSymbol: false, lineStyle: { color: "#7c3aed", width: 2, type: "dashed" }, itemStyle: { color: "#7c3aed" }, z: 3 },
      ],
    };
  }, [points]);

  const scopeTitle =
    scope.level === "state" ? "Statewide" :
    scope.level === "category" ? scope.category :
    scope.key || "Select a district";

  const choroStyle = (f) => {
    const z = zoneByKgis[pad2(f.properties.kgis_code)];
    return { fillColor: z ? SEV[z.severity] : "#e5e7eb", fillOpacity: z ? 0.62 : 0.25, weight: 1, color: "#ffffff" };
  };
  const onEachDistrict = (f, layer) => {
    const z = zoneByKgis[pad2(f.properties.kgis_code)];
    const name = f.properties.district;
    layer.bindTooltip(`<b style="color:#4f46e5">${name}</b>${z ? `<br/><span style="color:${SEV[z.severity]}">${z.severity.toUpperCase()} zone</span>` : "<br/>no active alert"}`, { sticky: true, className: "ksp-tip" });
    layer.on({ click: () => districts.includes(f.properties.district) && setScope({ level: "district", key: f.properties.district, category: "" }) });
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Trends &amp; Forecast</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            12-month projection with confidence band + emerging-trend alerts <DataClassBadge kind="real" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="neo-inset flex gap-1 rounded-xl p-1">
            {[
              { k: "state", label: "Statewide" },
              { k: "district", label: "By district" },
              { k: "category", label: "By category" },
            ].map((s) => (
              <button
                key={s.k}
                onClick={() => setScope({ level: s.k, key: s.k === "district" ? (districts[0] || "") : "", category: s.k === "category" ? (categories[0] || "") : "" })}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${scope.level === s.k ? "neo text-indigo-600" : "text-slate-500 hover:text-slate-900"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {scope.level === "district" && (
            <select value={scope.key} onChange={(e) => setScope((s) => ({ ...s, key: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs">
              {districts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {scope.level === "category" && (
            <select value={scope.category} onChange={(e) => setScope((s) => ({ ...s, category: e.target.value }))} className="max-w-[220px] rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs">
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </div>

      {(fcQ.error || alertsQ.error) && (
        <div className="glass rounded-2xl border border-rose-300 p-3 text-sm text-rose-600">Could not load predictive data from crime_api.</div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Forecast chart */}
        <Reveal className="glass rounded-3xl p-5 lg:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp size={16} className="text-indigo-500" />
            <div>
              <div className="text-sm font-semibold text-slate-900">Monthly FIRs · {scopeTitle}</div>
              <div className="text-[11px] text-slate-500">Solid = actual (2016–2023) · dashed = projected 2024 · shaded = 95% confidence</div>
            </div>
          </div>
          {chart ? <ReactECharts option={chart} style={{ height: 340 }} notMerge /> : <div className="grid h-[340px] place-items-center text-sm text-slate-500">Loading projection…</div>}
          {fcQ.data?.result?.method && (
            <p className="mt-1 text-[11px] text-slate-400">Model: {fcQ.data.result.method === "ets" ? "Holt-Winters exponential smoothing" : "seasonal-naive"} · projection, not observed.</p>
          )}
        </Reveal>

        {/* Alerts */}
        <Reveal className="glass flex flex-col rounded-3xl p-4 lg:col-span-1">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><AlertTriangle size={15} className="text-rose-500" /> Emerging-trend alerts</div>
          </div>
          <div className="mb-2 flex gap-1">
            {["all", "red", "amber"].map((s) => (
              <button key={s} onClick={() => setSevFilter(s)} className={`rounded-lg px-2 py-1 text-[11px] font-medium capitalize transition-all ${sevFilter === s ? "bg-slate-900 text-white" : "bg-slate-900/[0.05] text-slate-500 hover:text-slate-900"}`}>
                {s}{s === "red" ? ` (${alertsQ.data?.result?.red ?? 0})` : s === "amber" ? ` (${alertsQ.data?.result?.amber ?? 0})` : ""}
              </button>
            ))}
          </div>
          <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
            {alerts.slice(0, 40).map((a, i) => (
              <button
                key={`${a.canonical_name}-${a.category}-${i}`}
                onClick={() => setScope({ level: "district", key: a.canonical_name, category: "" })}
                className="w-full rounded-xl border border-slate-900/10 bg-white/70 p-2.5 text-left transition-all hover:border-slate-900/25"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <span className="h-2 w-2 rounded-full" style={{ background: SEV[a.severity] }} />
                    {a.category}
                  </span>
                  <span className="text-xs font-bold" style={{ color: SEV[a.severity] }}>+{a.deviation_pct}%</span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">{a.canonical_name} · {fmt(a.actual)} vs {fmt(Math.round(a.baseline))} baseline</div>
              </button>
            ))}
            {!alerts.length && <div className="text-xs text-slate-500">No alerts at this severity.</div>}
          </div>
        </Reveal>
      </div>

      {/* Red-zone choropleth */}
      <Reveal className="glass overflow-hidden rounded-3xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers3 size={16} className="text-rose-500" />
            <div>
              <div className="text-sm font-semibold text-slate-900">Red-zone map · 2023 vs recent baseline</div>
              <div className="text-[11px] text-slate-500">Districts shaded by their most severe active alert</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV.red }} /> red</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV.amber }} /> amber</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> none</span>
          </div>
        </div>
        <div className="h-[440px]">
          <MapContainer center={[15.0, 76.2]} zoom={7} minZoom={5} style={{ height: "100%", width: "100%" }} scrollWheelZoom zoomControl>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="&copy; OpenStreetMap &copy; CARTO" />
            {geoQ.data && allAlerts.length > 0 && (
              <GeoJSON key={`rz-${allAlerts.length}`} data={geoQ.data} style={choroStyle} onEachFeature={onEachDistrict} />
            )}
          </MapContainer>
        </div>
      </Reveal>
    </div>
  );
}
