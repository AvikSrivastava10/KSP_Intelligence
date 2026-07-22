import { useMemo } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import { useFilters } from "../state/store.js";

// sequential low -> high palette
const PALETTE = ["#1e3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#fbbf24", "#f97316", "#ef4444", "#991b1b"];
const NO_DATA = "#334155";

function makeScale(values) {
  const sorted = values.filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!sorted.length) return () => NO_DATA;
  const n = PALETTE.length;
  const breaks = [];
  for (let i = 1; i < n; i++) breaks.push(sorted[Math.floor((i / n) * sorted.length)]);
  return (v) => {
    if (v == null || Number.isNaN(v)) return NO_DATA;
    let idx = 0;
    while (idx < breaks.length && v > breaks[idx]) idx++;
    return PALETTE[idx];
  };
}

const pad2 = (c) => String(c).padStart(2, "0");
const valueOf = (d, metric) => (d ? (metric === "crimes_per_100k" ? d.crimes_per_100k : d.total_cases) : null);

export default function DistrictChoropleth({ districts, metric, geojson }) {
  const selectDistrict = useFilters((s) => s.selectDistrict);
  const selected = useFilters((s) => s.selectedDistrict);

  const byKgis = useMemo(() => {
    const m = {};
    for (const d of districts) m[pad2(d.kgis_code)] = d;
    return m;
  }, [districts]);

  const scale = useMemo(
    () => makeScale(districts.map((d) => valueOf(d, metric))),
    [districts, metric]
  );

  const style = (feature) => {
    const d = byKgis[pad2(feature.properties.kgis_code)];
    const isSel = d && selected === d.district;
    return {
      fillColor: scale(valueOf(d, metric)),
      weight: isSel ? 3 : 1,
      color: isSel ? "#e2e8f0" : "#0b1220",
      fillOpacity: 0.82,
    };
  };

  const onEachFeature = (feature, layer) => {
    const d = byKgis[pad2(feature.properties.kgis_code)];
    const name = (d && d.district) || feature.properties.district;
    let line;
    if (!d) line = "no FIR data";
    else if (metric === "crimes_per_100k")
      line = d.crimes_per_100k != null ? `${d.crimes_per_100k.toLocaleString()} / 100k` : "per-capita N/A";
    else line = `${d.total_cases.toLocaleString()} FIRs`;
    layer.bindTooltip(`<b>${name}</b><br/>${line}`, { sticky: true });
    layer.on({ click: () => d && selectDistrict(d.district) });
  };

  // Re-key GeoJSON so styles recompute when the metric or selection changes.
  const geoKey = `${metric}:${selected || "none"}`;

  return (
    <MapContainer center={[15.0, 76.2]} zoom={6} minZoom={5} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap contributors &copy; CARTO'
      />
      {geojson && <GeoJSON key={geoKey} data={geojson} style={style} onEachFeature={onEachFeature} />}
    </MapContainer>
  );
}
