import { useQuery } from "@tanstack/react-query";
import { fetchOverview, fetchDistricts } from "../api/client.js";
import { useFilters } from "../state/store.js";
import KpiCard from "../components/KpiCard.jsx";
import DataClassBadge from "../components/DataClassBadge.jsx";
import DistrictChoropleth from "../components/DistrictChoropleth.jsx";
import DrillDownPanel from "../components/DrillDownPanel.jsx";
import YearlyTrend from "../components/YearlyTrend.jsx";

const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n ?? "—");
const pct = (x) => `${((x || 0) * 100).toFixed(1)}%`;

function useGeoJSON() {
  return useQuery({
    queryKey: ["geojson"],
    queryFn: async () => {
      const r = await fetch("/karnataka_districts.geojson");
      if (!r.ok) throw new Error("Failed to load district boundaries");
      return r.json();
    },
    staleTime: Infinity,
  });
}

export default function Dashboard() {
  const metric = useFilters((s) => s.metric);
  const setMetric = useFilters((s) => s.setMetric);
  const perCapita = metric === "crimes_per_100k";

  const ov = useQuery({ queryKey: ["overview"], queryFn: fetchOverview });
  const dl = useQuery({ queryKey: ["districts", perCapita], queryFn: () => fetchDistricts(perCapita) });
  const gj = useGeoJSON();
  const o = ov.data?.result;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Statewide Dashboard</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-slate-400">
          Karnataka FIRs 2016–2024 <DataClassBadge kind="real" />
          <span className="text-amber-400/80">· 2024 partial</span>
        </p>
      </div>

      {ov.isLoading ? (
        <div className="text-sm text-slate-400">Loading KPIs…</div>
      ) : ov.error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          Could not reach crime_api: {String(ov.error.message)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Total FIRs" value={fmt(o.total_firs)} sub="2016–2024" accent="sky" />
          <KpiCard label="Districts" value={o.districts_covered} sub={`${o.fir_units} FIR units`} accent="violet" />
          <KpiCard label="Year range" value="2016–2024" sub="2024 partial" accent="amber" />
          <KpiCard label="Conviction rate" value={pct(o.rates.conviction_rate)} sub="of chargesheeted" accent="emerald" />
          <KpiCard label="Detection rate" value={pct(o.rates.detection_rate)} sub="cases detected" accent="emerald" />
          <KpiCard label="Geocoded" value={`${o.pct_geocoded}%`} sub="incident coords" accent="sky" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 lg:col-span-3">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <div className="text-sm font-medium">District choropleth</div>
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={() => setMetric("total_cases")}
                className={`rounded px-2 py-1 ${metric === "total_cases" ? "bg-sky-500/20 text-sky-300" : "text-slate-400 hover:bg-slate-800"}`}
              >
                Raw count
              </button>
              <button
                onClick={() => setMetric("crimes_per_100k")}
                className={`rounded px-2 py-1 ${metric === "crimes_per_100k" ? "bg-sky-500/20 text-sky-300" : "text-slate-400 hover:bg-slate-800"}`}
              >
                Per capita
              </button>
            </div>
          </div>
          <div className="h-[460px]">
            {dl.data && gj.data ? (
              <DistrictChoropleth districts={dl.data.result.districts} metric={metric} geojson={gj.data} />
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-500">
                {dl.error || gj.error ? `Map data error: ${String((dl.error || gj.error).message)}` : "Loading map…"}
              </div>
            )}
          </div>
          <div className="border-t border-slate-800 px-4 py-1.5 text-[11px] text-slate-500">
            {perCapita ? "Crimes per 100k (Census 2011)" : "Total FIRs 2016–2024"} · joined to boundaries on kgis_code · darker = higher
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 lg:col-span-2">
          <DrillDownPanel />
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">Yearly FIR volume</div>
          <span className="text-xs text-slate-500">2024 shown amber (partial year)</span>
        </div>
        {o && <YearlyTrend perYear={o.per_year} />}
      </div>
    </div>
  );
}
