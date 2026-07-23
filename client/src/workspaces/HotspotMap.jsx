import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, useMap } from "react-leaflet";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { Layers, MapPin, Flame, Building2, Clock } from "lucide-react";
import HeatLayer from "../components/HeatLayer.jsx";
import DataClassBadge from "../components/DataClassBadge.jsx";
import Reveal from "../components/Reveal.jsx";
import { fetchDistricts, fetchHotspots, fetchClusters, fetchStations, fetchTimeofday } from "../api/client.js";

const asset = (p) => `${import.meta.env.BASE_URL}${p}`;
const YEARS = ["all", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"];
const pad2 = (c) => String(c).padStart(2, "0");
const CHORO = ["#fff7ec", "#fee8c8", "#fdd49e", "#fdbb84", "#fc8d59", "#ef6548", "#d7301f", "#990000"];
const TOD_COLOR = { Night: "#1e3a8a", Morning: "#0ea5e9", Daytime: "#f59e0b", Afternoon: "#f97316", Evening: "#7c3aed", Distributed: "#94a3b8" };

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target && target.lat) map.flyTo([target.lat, target.lng], 10, { duration: 0.8 });
  }, [target, map]);
  return null;
}

function choroScale(values) {
  const s = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return () => "#e5e7eb";
  const n = CHORO.length;
  const br = [];
  for (let i = 1; i < n; i++) br.push(s[Math.floor((i / n) * s.length)]);
  return (v) => {
    if (v == null) return "#e5e7eb";
    let i = 0;
    while (i < br.length && v > br[i]) i++;
    return CHORO[i];
  };
}

export default function HotspotMap() {
  const [year, setYear] = useState("2023");
  const [layers, setLayers] = useState({ choropleth: true, heat: true, clusters: true, stations: false });
  const [prec, setPrec] = useState({ point: true, station: true, place: true });
  const [selected, setSelected] = useState(null); // { district, lat, lng }

  const precParam = useMemo(() => {
    const on = Object.entries(prec).filter(([, v]) => v).map(([k]) => k);
    if (on.length === 3) return ""; // all selected -> no filter
    if (on.length === 0) return "__none__"; // none selected -> match nothing (empty heat)
    return on.join(",");
  }, [prec]);

  const districtsQ = useQuery({ queryKey: ["districts", false], queryFn: () => fetchDistricts(false) });
  const geoQ = useQuery({ queryKey: ["geojson"], queryFn: async () => (await fetch(asset("karnataka_districts.geojson"))).json(), staleTime: Infinity });
  const hotspotsQ = useQuery({ queryKey: ["hotspots", year, precParam], queryFn: () => fetchHotspots(year, precParam) });
  const clustersQ = useQuery({ queryKey: ["clusters"], queryFn: () => fetchClusters(80) });
  const stationsQ = useQuery({ queryKey: ["stations", selected?.district || "all"], queryFn: () => fetchStations(selected?.district), enabled: layers.stations });
  const todQ = useQuery({ queryKey: ["timeofday", selected?.district || "state"], queryFn: () => fetchTimeofday(selected?.district) });

  const districts = districtsQ.data?.result?.districts || [];
  const byKgis = useMemo(() => {
    const m = {};
    for (const d of districts) m[pad2(d.kgis_code)] = d;
    return m;
  }, [districts]);
  const scale = useMemo(() => choroScale(districts.map((d) => d.total_cases)), [districts]);

  const cells = hotspotsQ.data?.result?.cells || [];
  const heatPoints = useMemo(() => {
    if (!cells.length) return [];
    let maxC = 0;
    for (const c of cells) if (c.count > maxC) maxC = c.count; // avoid Math.max(...bigArray) spread
    const denom = Math.log1p(maxC) || 1;
    return cells.map((c) => [c.lat, c.lng, Math.max(0.06, Math.log1p(c.count) / denom)]);
  }, [cells]);

  const clusters = clustersQ.data?.result?.clusters || [];
  const stations = useMemo(() => {
    const s = stationsQ.data?.result?.stations || [];
    return selected ? s : s.slice(0, 300); // cap statewide station render
  }, [stationsQ.data, selected]);

  // Drill-down: selecting a district loads its stations (auto-enables the station layer).
  const selectDistrict = (d) => {
    setSelected({ district: d.district, lat: d.mean_lat, lng: d.mean_lng });
    setLayers((s) => (s.stations ? s : { ...s, stations: true }));
  };

  const choroStyle = (f) => {
    const d = byKgis[pad2(f.properties.kgis_code)];
    const isSel = d && selected && selected.district === d.district;
    return { fillColor: d ? scale(d.total_cases) : "#e5e7eb", weight: isSel ? 2.5 : 1, color: isSel ? "#4f46e5" : "#ffffff", fillOpacity: layers.heat ? 0.3 : 0.7 };
  };
  const onEachDistrict = (f, layer) => {
    const d = byKgis[pad2(f.properties.kgis_code)];
    const name = (d && d.district) || f.properties.district;
    layer.bindTooltip(`<b style="color:#4f46e5">${name}</b>${d ? `<br/>${d.total_cases.toLocaleString()} FIRs` : ""}`, { sticky: true, className: "ksp-tip" });
    layer.on({ click: () => d && selectDistrict(d) });
  };

  const tod = todQ.data?.result;
  const todOption = tod && {
    grid: { left: 70, right: 16, top: 10, bottom: 24 },
    tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,0.97)", borderColor: "rgba(15,23,42,0.12)", textStyle: { color: "#0f172a" } },
    xAxis: { type: "value", axisLabel: { color: "#94a3b8", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(15,23,42,0.07)" } } },
    yAxis: { type: "category", data: tod.buckets.map((b) => b.bucket), axisLabel: { color: "#475569", fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: "bar", data: tod.buckets.map((b) => ({ value: b.count, itemStyle: { color: TOD_COLOR[b.bucket] || "#6366f1", borderRadius: [0, 4, 4, 0] } })), barWidth: "62%" }],
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Hotspot Map</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            District → station → grid geospatial intelligence <DataClassBadge kind="real" />
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Year
          <select value={year} onChange={(e) => setYear(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm">
            {YEARS.map((y) => <option key={y} value={y}>{y === "all" ? "All years" : y}</option>)}
          </select>
        </label>
      </div>

      {(hotspotsQ.error || clustersQ.error || districtsQ.error) && (
        <div className="glass rounded-2xl border border-rose-300 p-3 text-sm text-rose-600">
          Could not load map data from crime_api — is the API running?
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Map */}
        <Reveal className="glass overflow-hidden rounded-3xl lg:col-span-3">
          <div className="h-[620px]">
            <MapContainer center={[15.0, 76.2]} zoom={7} minZoom={5} style={{ height: "100%", width: "100%" }} scrollWheelZoom zoomControl>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="&copy; OpenStreetMap &copy; CARTO" />
              {layers.choropleth && geoQ.data && districts.length > 0 && (
                <GeoJSON key={`ch-${selected?.district || "none"}-${layers.heat}`} data={geoQ.data} style={choroStyle} onEachFeature={onEachDistrict} />
              )}
              {layers.heat && heatPoints.length > 0 && <HeatLayer points={heatPoints} />}
              {layers.clusters && clusters.map((c) => (
                <CircleMarker
                  key={`cl-${c.cluster_id}`}
                  center={[c.centroid_lat, c.centroid_lng]}
                  radius={Math.max(6, Math.min(40, Math.sqrt(c.total_count) / 16))}
                  pathOptions={{ color: "#7c2d12", weight: 1, fillColor: "#f97316", fillOpacity: 0.35 }}
                >
                  <Popup>
                    <div style={{ maxWidth: 240 }}>
                      <b>Hotspot cluster · {c.canonical_name}</b>
                      <div style={{ margin: "4px 0", fontSize: 12 }}>{c.total_count.toLocaleString()} FIRs · {c.n_points} cells · ~{c.radius_km} km</div>
                      <div style={{ fontSize: 12 }}>{c.deployment_note}</div>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
              {layers.stations && stations.map((s, i) => (
                <CircleMarker
                  key={`st-${i}-${s.unit_name}`}
                  center={[s.mean_lat, s.mean_lng]}
                  radius={4}
                  pathOptions={{ color: "#0f172a", weight: 1, fillColor: "#38bdf8", fillOpacity: 0.85 }}
                >
                  <Popup>
                    <div style={{ fontSize: 12 }}>
                      <b>{s.unit_name}</b><br />{s.canonical_name} · {s.count.toLocaleString()} FIRs
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
              <FlyTo target={selected} />
            </MapContainer>
          </div>
        </Reveal>

        {/* Controls + legend + selection */}
        <div className="space-y-4 lg:col-span-1">
          <div className="glass rounded-2xl p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><Layers size={15} /> Layers</div>
            {[
              { k: "choropleth", label: "District choropleth", icon: MapPin },
              { k: "heat", label: "Hotspot heat", icon: Flame },
              { k: "clusters", label: "DBSCAN clusters", icon: MapPin },
              { k: "stations", label: "Police stations", icon: Building2 },
            ].map((l) => (
              <label key={l.k} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-600">
                <input type="checkbox" checked={layers[l.k]} onChange={(e) => setLayers((s) => ({ ...s, [l.k]: e.target.checked }))} />
                <l.icon size={14} className="text-slate-400" /> {l.label}
              </label>
            ))}
            <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Precision filter (heat)</div>
            {[
              { k: "point", label: "point · real GPS" },
              { k: "station", label: "station · pinned to PS" },
              { k: "place", label: "place · geocoded" },
            ].map((p) => (
              <label key={p.k} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-slate-600">
                <input type="checkbox" checked={prec[p.k]} onChange={(e) => setPrec((s) => ({ ...s, [p.k]: e.target.checked }))} /> {p.label}
              </label>
            ))}
          </div>

          {/* Legend */}
          <div className="glass rounded-2xl p-4 text-xs text-slate-600">
            <div className="mb-2 text-sm font-semibold text-slate-900">Legend</div>
            <div className="mb-2 flex items-center gap-2">
              Low
              <span className="h-2 flex-1 rounded-full" style={{ background: "linear-gradient(90deg,#2563eb,#22c55e,#eab308,#f97316,#dc2626)" }} />
              High
            </div>
            <p className="leading-relaxed text-slate-500">
              Heat = incident density (log-scaled). <b className="text-slate-700">point</b> = real GPS ·
              <b className="text-slate-700"> station</b> = pinned to police-station coords ·
              <b className="text-slate-700"> place</b> = geocoded village. District-centroid points are
              <b className="text-slate-700"> excluded</b> from the heat/clusters and shown only on the choropleth (aggregate).
            </p>
          </div>

          {/* Selection */}
          <div className="glass rounded-2xl p-4">
            <div className="text-sm font-semibold text-slate-900">{selected ? selected.district : "Statewide"}</div>
            <div className="mt-1 text-xs text-slate-500">
              {selected ? "Click a station marker for its counts. " : "Click a district to zoom + load its stations. "}
              {layers.stations ? `${stations.length} stations shown${!selected ? " (top 300)" : ""}.` : "Enable the station layer to see stations."}
            </div>
            {selected && (
              <button onClick={() => setSelected(null)} className="mt-2 rounded-lg bg-slate-900/[0.05] px-2 py-1 text-xs text-slate-600 hover:bg-slate-900/10">
                Clear selection
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modeled time-of-day */}
      <Reveal className="glass rounded-3xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-violet-500" />
            <div>
              <div className="text-sm font-semibold text-slate-900">Time-of-day profile · {selected ? selected.district : "Statewide"}</div>
              <div className="text-[11px] text-slate-500">When crime happens, by estimated time bucket</div>
            </div>
          </div>
          <DataClassBadge kind="modeled" title="Estimated, not observed" />
        </div>
        {todOption ? (
          <>
            <ReactECharts option={todOption} style={{ height: 190 }} notMerge />
            <p className="mt-2 text-[11px] leading-relaxed text-amber-700">{tod.note}</p>
          </>
        ) : (
          <div className="text-sm text-slate-500">Loading time-of-day…</div>
        )}
      </Reveal>
    </div>
  );
}
