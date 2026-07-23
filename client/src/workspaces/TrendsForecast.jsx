import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { TrendingUp, TrendingDown, AlertTriangle, Layers3, CalendarClock, Flame } from "lucide-react";
import DataClassBadge from "../components/DataClassBadge.jsx";
import KpiCard from "../components/KpiCard.jsx";
import InfoDot from "../components/InfoDot.jsx";
import Reveal from "../components/Reveal.jsx";
import { fetchForecast, fetchForecastOptions, fetchAlerts } from "../api/client.js";

const asset = (p) => `${import.meta.env.BASE_URL}${p}`;
const pad2 = (c) => String(c).padStart(2, "0");
const SEV = { red: "#dc2626", amber: "#f59e0b" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);
const kfmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`);
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

  const scopeTitle =
    scope.level === "state" ? "Karnataka (statewide)" :
    scope.level === "category" ? scope.category :
    scope.key || "district";

  // headline numbers derived from the forecast series
  const summary = useMemo(() => {
    if (!points.length) return null;
    const fc = points.filter((p) => p.is_forecast === 1);
    const proj = fc.reduce((s, p) => s + (p.yhat || 0), 0);
    const actual2023 = points.filter((p) => p.is_forecast === 0 && p.year === 2023).reduce((s, p) => s + (p.y_actual || 0), 0);
    const change = actual2023 ? ((proj - actual2023) / actual2023) * 100 : null;
    let peak = null;
    for (const p of fc) if (!peak || p.yhat > peak.yhat) peak = p;
    return { proj, actual2023, change, peak, avgMonthly: proj / (fc.length || 1) };
  }, [points]);

  const zoneByKgis = useMemo(() => {
    const m = {};
    for (const a of allAlerts) {
      const k = pad2(a.kgis_code);
      if (!m[k] || (m[k].severity === "amber" && a.severity === "red")) m[k] = { severity: a.severity, district: a.canonical_name };
    }
    return m;
  }, [allAlerts]);

  const chart = useMemo(() => {
    if (!points.length) return null;
    const labels = points.map(ymLabel);
    const split = points.findIndex((p) => p.is_forecast === 1);
    const actual = points.map((p) => (p.is_forecast === 0 ? p.y_actual : null));
    const yhat = points.map((p) => (p.is_forecast === 1 ? p.yhat : null));
    const lower = points.map((p) => (p.is_forecast === 1 ? p.yhat_lower : p.y_actual));
    const band = points.map((p) => (p.is_forecast === 1 ? Math.max(0, p.yhat_upper - p.yhat_lower) : 0));
    if (split > 0) yhat[split - 1] = points[split - 1].y_actual;
    return {
      grid: { left: 56, right: 18, top: 24, bottom: 40 },
      tooltip: {
        trigger: "axis", backgroundColor: "rgba(255,255,255,0.97)", borderColor: "rgba(15,23,42,0.12)", textStyle: { color: "#0f172a" },
        formatter: (ps) => {
          const p = ps[0];
          const idx = p.dataIndex;
          const isF = points[idx].is_forecast === 1;
          const val = isF ? points[idx].yhat : points[idx].y_actual;
          const range = isF ? `<br/><span style="color:#7c3aed">likely ${fmt(Math.round(points[idx].yhat_lower))}–${fmt(Math.round(points[idx].yhat_upper))}</span>` : "";
          return `<b>${p.axisValue}</b><br/>${isF ? "Projected" : "Actual"}: <b>${fmt(Math.round(val))}</b> FIRs${range}`;
        },
      },
      legend: { data: ["Actual (recorded)", "Forecast (projected)"], right: 10, top: 0, textStyle: { color: "#475569", fontSize: 11 } },
      xAxis: {
        type: "category", data: labels, boundaryGap: false,
        axisLabel: { color: "#94a3b8", fontSize: 10, interval: (i) => i % 12 === 0, formatter: (v) => v.slice(0, 4) },
        axisLine: { lineStyle: { color: "rgba(15,23,42,0.15)" } },
      },
      yAxis: { type: "value", name: "FIRs / month", nameTextStyle: { color: "#94a3b8", fontSize: 10, align: "left" }, axisLabel: { color: "#94a3b8", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(15,23,42,0.07)" } } },
      series: [
        { name: "ci-lower", type: "line", data: lower, stack: "ci", lineStyle: { opacity: 0 }, symbol: "none", silent: true, z: 1 },
        { name: "Likely range", type: "line", data: band, stack: "ci", lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(124,58,237,0.16)" }, symbol: "none", silent: true, z: 1 },
        { name: "Actual (recorded)", type: "line", data: actual, showSymbol: false, lineStyle: { color: "#4f46e5", width: 2 }, itemStyle: { color: "#4f46e5" }, z: 3 },
        { name: "Forecast (projected)", type: "line", data: yhat, showSymbol: false, lineStyle: { color: "#7c3aed", width: 2, type: "dashed" }, itemStyle: { color: "#7c3aed" }, z: 3 },
      ],
    };
  }, [points]);

  const rising = summary && summary.change != null && summary.change >= 0;
  const changeColor = rising ? "#dc2626" : "#16a34a";

  const choroStyle = (f) => {
    const z = zoneByKgis[pad2(f.properties.kgis_code)];
    return { fillColor: z ? SEV[z.severity] : "#e5e7eb", fillOpacity: z ? 0.62 : 0.25, weight: 1, color: "#ffffff" };
  };
  const onEachDistrict = (f, layer) => {
    const z = zoneByKgis[pad2(f.properties.kgis_code)];
    const name = f.properties.district;
    layer.bindTooltip(`<b style="color:#4f46e5">${name}</b>${z ? `<br/><span style="color:${SEV[z.severity]}">${z.severity === "red" ? "Sharp rise" : "Moderate rise"}</span>` : "<br/>stable vs recent average"}`, { sticky: true, className: "ksp-tip" });
    layer.on({ click: () => districts.includes(f.properties.district) && setScope({ level: "district", key: f.properties.district, category: "" }) });
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Trends &amp; Forecast</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Where crime is heading over the next 12 months, and which districts are heating up. The forecast
            learns from 2016–2023 monthly patterns and projects the year ahead. <DataClassBadge kind="real" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">View</span>
          <div className="neo-inset flex gap-1 rounded-xl p-1">
            {[
              { k: "state", label: "Statewide" },
              { k: "district", label: "By district" },
              { k: "category", label: "By crime type" },
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

      {/* Headline numbers for the current view */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Reveal delay={0}><KpiCard label="Projected · next 12 mo" value={kfmt(summary.proj)} sub={`FIRs expected for ${scopeTitle}`} icon={CalendarClock} accent="violet" /></Reveal>
          <Reveal delay={70}>
            <div className="glass glass-hover rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Direction vs 2023</div>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: rising ? "rgba(220,38,38,0.12)" : "rgba(22,163,74,0.12)", color: changeColor }}>
                  {rising ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                </span>
              </div>
              <div className="mt-3 text-3xl font-bold tracking-tight" style={{ color: changeColor }}>
                {summary.change == null ? "—" : `${summary.change >= 0 ? "+" : ""}${summary.change.toFixed(1)}%`}
              </div>
              <div className="mt-1 text-xs text-slate-500">{rising ? "projected to rise" : "projected to ease"} vs last full year</div>
            </div>
          </Reveal>
          <Reveal delay={140}><KpiCard label="Busiest month ahead" value={summary.peak ? MONTHS[summary.peak.month - 1] : "—"} sub={summary.peak ? `~${fmt(Math.round(summary.peak.yhat))} FIRs projected` : ""} icon={Flame} accent="saffron" /></Reveal>
          <Reveal delay={210}><KpiCard label="Emerging-trend alerts" value={allAlerts.length} sub={`${alertsQ.data?.result?.red ?? 0} sharp · ${alertsQ.data?.result?.amber ?? 0} moderate`} icon={AlertTriangle} accent="rose" /></Reveal>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Forecast chart */}
        <Reveal className="glass rounded-3xl p-5 lg:col-span-2">
          <div className="mb-1 flex items-center gap-2">
            <TrendingUp size={16} className="text-indigo-500" />
            <div className="text-sm font-semibold text-slate-900">Monthly FIRs · {scopeTitle}</div>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded" style={{ background: "#4f46e5" }} /> actual (2016–2023)</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded border-t border-dashed" style={{ borderColor: "#7c3aed" }} /> projected (2024)</span>
            <span className="flex items-center gap-1"><span className="h-2 w-4 rounded" style={{ background: "rgba(124,58,237,0.25)" }} /> likely range <InfoDot text="95% confidence band: the actual value is expected to fall inside this shaded range about 19 times out of 20." /></span>
          </div>
          {chart ? <ReactECharts option={chart} style={{ height: 320 }} notMerge /> : <div className="grid h-[320px] place-items-center text-sm text-slate-500">Loading projection…</div>}
          {summary && summary.change != null && (
            <p className="mt-2 rounded-xl bg-slate-900/[0.03] px-3 py-2 text-xs leading-relaxed text-slate-600">
              <b className="text-slate-800">In plain terms:</b> {scopeTitle} recorded <b>{fmt(Math.round(summary.actual2023))}</b> FIRs in 2023.
              The model projects about <b>{fmt(Math.round(summary.proj))}</b> over the next 12 months — a
              <b style={{ color: changeColor }}> {summary.change >= 0 ? "rise" : "drop"} of ~{Math.abs(summary.change).toFixed(0)}%</b>.
              The shaded band shows the range the real figure is likely to land in.
            </p>
          )}
        </Reveal>

        {/* Alerts */}
        <Reveal className="glass flex flex-col rounded-3xl p-4 lg:col-span-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><AlertTriangle size={15} className="text-rose-500" /> Emerging-trend alerts</div>
          <p className="mb-2 mt-1 text-[11px] leading-relaxed text-slate-500">
            Crime types that climbed notably in 2023 versus a district's own recent average (2021–2022).
            <span className="text-rose-600"> Red</span> = sharp rise, <span className="text-amber-600">amber</span> = moderate.
          </p>
          <div className="mb-2 flex gap-1">
            {["all", "red", "amber"].map((s) => (
              <button key={s} onClick={() => setSevFilter(s)} className={`rounded-lg px-2 py-1 text-[11px] font-medium capitalize transition-all ${sevFilter === s ? "bg-slate-900 text-white" : "bg-slate-900/[0.05] text-slate-500 hover:text-slate-900"}`}>
                {s === "all" ? "All" : s}{s === "red" ? ` (${alertsQ.data?.result?.red ?? 0})` : s === "amber" ? ` (${alertsQ.data?.result?.amber ?? 0})` : ""}
              </button>
            ))}
          </div>
          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {alerts.slice(0, 40).map((a, i) => (
              <button
                key={`${a.canonical_name}-${a.category}-${i}`}
                title={`Show the ${a.canonical_name} forecast`}
                onClick={() => setScope({ level: "district", key: a.canonical_name, category: "" })}
                className="w-full rounded-xl border border-slate-900/10 bg-white/70 p-2.5 text-left transition-all hover:border-slate-900/30 hover:bg-white"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <span className="h-2 w-2 rounded-full" style={{ background: SEV[a.severity] }} />
                    {a.category}
                  </span>
                  <span className="text-xs font-bold" style={{ color: SEV[a.severity] }}>+{a.deviation_pct}%</span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">{a.canonical_name} · {fmt(a.actual)} in 2023 vs {fmt(Math.round(a.baseline))} usual</div>
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
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">Red-zone map <InfoDot text="Compares each district's 2023 volume against its own 2021–2022 average, so a small district in trouble shows up as clearly as a big one." /></div>
              <div className="text-[11px] text-slate-500">Districts coloured by how sharply crime rose in 2023 vs their recent norm</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV.red }} /> sharp rise</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV.amber }} /> moderate</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> stable</span>
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
