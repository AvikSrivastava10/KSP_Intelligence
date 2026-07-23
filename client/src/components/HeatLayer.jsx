import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";

// leaflet.heat overlay. `points` = [[lat, lng, intensity(0..1)], ...]
export default function HeatLayer({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || !points.length) return undefined;
    const layer = L.heatLayer(points, {
      radius: 11,
      blur: 12,
      maxZoom: 12,
      minOpacity: 0.2,
      max: 1.0,
      gradient: { 0.2: "#2563eb", 0.4: "#22c55e", 0.6: "#eab308", 0.8: "#f97316", 1.0: "#dc2626" },
    });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, points]);
  return null;
}
