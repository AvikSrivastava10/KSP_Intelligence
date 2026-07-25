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
// Real-time-signal hotspots: only crime heads whose classification records night/day.
export const fetchTimedHotspots = (bucket, year) => {
  const q = new URLSearchParams();
  if (bucket) q.set("bucket", bucket);
  if (year && year !== "all") q.set("year", year);
  const qs = q.toString();
  return api(`/hotspots/timed${qs ? `?${qs}` : ""}`);
};
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

// --- Phase 6: strategic hub + audit ---
export const fetchHub = () => api("/hub");
export const fetchAudit = () => api("/audit");
export const fetchValidation = () => api("/validation");

// --- Phase 5: entity network + socio-economic ---
export const fetchNetwork = (community, limit = 250, opts = {}) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (community != null && community !== "") q.set("community", community);
  if (opts.focus) q.set("focus", opts.focus);
  if (opts.type) q.set("type", opts.type);
  return api(`/network/entity?${q.toString()}`);
};
export const fetchCommunities = () => api("/network/communities");
export const fetchRules = (type, limit = 40, q2 = "") => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (type) q.set("type", type);
  if (q2) q.set("q", q2);
  return api(`/network/rules?${q.toString()}`);
};
// Full entity list (all 483) + single-entity deep dive.
export const fetchEntities = ({ q = "", type = "", community = "", sort = "pagerank", limit = 60, offset = 0 } = {}) => {
  const p = new URLSearchParams({ sort, limit: String(limit), offset: String(offset) });
  if (q) p.set("q", q);
  if (type) p.set("type", type);
  if (community !== "" && community != null) p.set("community", community);
  return api(`/network/entities?${p.toString()}`);
};
export const fetchEntityDetail = (id) => api(`/network/entity/${encodeURIComponent(id)}`);
export const fetchSocio = () => api("/socio");
// Person network — SYNTHETIC demo plane. Callers MUST surface the synthetic banner.
export const fetchPersonNetwork = () => api("/network/persons");
export const fetchOffenderProfiles = (limit = 25) => api(`/network/persons/offenders?limit=${limit}`);
export const fetchLinkage = () => api("/network/linkage");

// --- Phase 4: patterns / MO / outcomes ---
export const fetchMoClusters = () => api("/patterns/mo-clusters");
export const fetchTemporal = (district) =>
  api(`/patterns/temporal${district ? `?district=${encodeURIComponent(district)}` : ""}`);
export const fetchOutcomes = () => api("/outcomes");
export const fetchOutcomeDrivers = () => api("/outcomes/drivers");
