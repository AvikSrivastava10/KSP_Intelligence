// API client — unwraps the { ok, data_class, result, request_id } envelope.
// Prod (Catalyst): default base "/server/crime_api" is same-origin with the web client.
// Local: set VITE_API_BASE=http://localhost:9000, or run `vite dev` (proxy forwards /server).
const API_BASE = import.meta.env.VITE_API_BASE || "/server/crime_api";

async function api(path) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  } catch (e) {
    throw new Error(`Cannot reach crime_api at ${API_BASE}. Is it running?`);
  }
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error(`Bad JSON from ${path} (HTTP ${res.status})`);
  }
  if (!json || json.ok !== true) {
    throw new Error((json && json.error) || `Request failed: ${path} (HTTP ${res.status})`);
  }
  return { result: json.result, dataClass: json.data_class, requestId: json.request_id };
}

export const API_BASE_URL = API_BASE;
export const fetchOverview = () => api("/overview");
export const fetchMeta = () => api("/meta");
export const fetchDistricts = (perCapita) => api(`/districts${perCapita ? "?per_capita=true" : ""}`);
export const fetchDistrict = (name) => api(`/district/${encodeURIComponent(name)}`);

// --- Phase 2: geospatial ---
export const fetchHotspots = (year, precision) => {
  const q = new URLSearchParams();
  if (year) q.set("year", year);
  if (precision) q.set("precision", precision);
  const qs = q.toString();
  return api(`/hotspots${qs ? `?${qs}` : ""}`);
};
export const fetchClusters = (limit = 80) => api(`/hotspots/clusters?limit=${limit}`);
export const fetchStations = (district) => api(`/stations${district ? `?district=${encodeURIComponent(district)}` : ""}`);
export const fetchTimeofday = (district, category) => {
  const q = new URLSearchParams();
  if (district) q.set("district", district);
  if (category) q.set("category", category);
  const qs = q.toString();
  return api(`/timeofday${qs ? `?${qs}` : ""}`);
};

// --- Phase 3: predictive ---
export const fetchForecast = (level = "state", key, category) => {
  const q = new URLSearchParams({ level });
  if (key) q.set("key", key);
  if (category) q.set("category", category);
  return api(`/forecast?${q.toString()}`);
};
export const fetchForecastOptions = () => api("/forecast/options");
export const fetchAlerts = (severity) => api(`/alerts${severity ? `?severity=${severity}` : ""}`);
export const fetchRisk = () => api("/risk");
export const fetchRiskById = (id) => api(`/risk/${encodeURIComponent(id)}`);
export const fetchAnomalies = ({ district, category, year, limit } = {}) => {
  const q = new URLSearchParams();
  if (district) q.set("district", district);
  if (category) q.set("category", category);
  if (year) q.set("year", year);
  if (limit) q.set("limit", limit);
  const qs = q.toString();
  return api(`/anomalies${qs ? `?${qs}` : ""}`);
};
