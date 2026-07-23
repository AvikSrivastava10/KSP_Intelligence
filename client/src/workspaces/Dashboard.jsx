import { useQuery } from "@tanstack/react-query";
import { FileStack, Landmark, CalendarRange, Gavel, ShieldCheck, LocateFixed, Sparkles } from "lucide-react";
import { fetchOverview, fetchDistricts } from "../api/client.js";
import { useFilters } from "../state/store.js";
import KpiCard from "../components/KpiCard.jsx";
import DataClassBadge from "../components/DataClassBadge.jsx";
import DistrictChoropleth from "../components/DistrictChoropleth.jsx";
import DrillDownPanel from "../components/DrillDownPanel.jsx";
import YearlyTrend from "../components/YearlyTrend.jsx";
import Reveal from "../components/Reveal.jsx";

const asset = (p) => `${import.meta.env.BASE_URL}${p}`;
const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n ?? "—");
const pct = (x) => `${((x || 0) * 100).toFixed(1)}%`;

function useGeoJSON() {
  return useQuery({
    queryKey: ["geojson"],
    queryFn: async () => {
      const r = await fetch(asset("karnataka_districts.geojson"));
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
  const districts = dl.data?.result?.districts || [];
  const topDistrict = districts[0];

  return (
    <div className="mx-auto max-w-[1500px] space-y-10 pb-10">
      {/* ---------- Hero ---------- */}
      <Reveal as="section" className="glass-strong !border-0 relative overflow-hidden rounded-4xl px-6 py-10 md:px-10 md:py-14">
        <div className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-indigo-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-1/3 h-56 w-56 rounded-full bg-sky-400/15 blur-3xl" />
        <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center">
          <div className="emblem-chip grid h-24 w-24 shrink-0 animate-floaty place-items-center rounded-3xl p-2">
            <img src={asset("ksp-logo.png")} alt="Karnataka State Police" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <DataClassBadge kind="real" />
              <span className="rounded-full border border-slate-900/10 bg-slate-900/[0.04] px-2.5 py-0.5 text-[11px] text-slate-600">2016–2024 · 2024 partial</span>
            </div>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-slate-900 md:text-4xl">
              Statewide <span className="text-gradient-gold">Crime Intelligence</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
              From reactive reporting to proactive intelligence — {o ? fmt(o.total_firs) : "1.6M+"} real FIRs across
              Karnataka, cleaned, geocoded, and analysed for the State Crime Records Bureau.
            </p>
          </div>
        </div>
      </Reveal>

      {/* ---------- KPI row ---------- */}
      <section>
        {ov.isLoading ? (
          <div className="text-sm text-slate-500">Loading statewide KPIs…</div>
        ) : ov.error ? (
          <div className="glass rounded-2xl border border-rose-300 p-4 text-sm text-rose-600">
            Could not reach crime_api: {String(ov.error.message)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Total FIRs", value: fmt(o.total_firs), sub: "2016–2024", icon: FileStack, accent: "gold" },
              { label: "Districts", value: o.districts_covered, sub: `${o.fir_units} FIR units`, icon: Landmark, accent: "violet" },
              { label: "Year range", value: "2016–24", sub: "2024 partial", icon: CalendarRange, accent: "saffron" },
              { label: "Conviction", value: pct(o.rates.conviction_rate), sub: "of chargesheeted", icon: Gavel, accent: "emerald" },
              { label: "Detection", value: pct(o.rates.detection_rate), sub: "cases detected", icon: ShieldCheck, accent: "sky" },
              { label: "Geocoded", value: `${o.pct_geocoded}%`, sub: "incident coords", icon: LocateFixed, accent: "rose" },
            ].map((k, i) => (
              <Reveal key={k.label} delay={i * 70}>
                <KpiCard {...k} />
              </Reveal>
            ))}
          </div>
        )}
      </section>

      {/* ---------- Map + drill-down ---------- */}
      <Reveal as="section" className="grid gap-4 lg:grid-cols-5">
        <div className="glass overflow-hidden rounded-3xl lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900/8 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">District choropleth</div>
              <div className="text-[11px] text-slate-500">Joined to boundaries on kgis_code</div>
            </div>
            <div className="neo-inset flex gap-1 rounded-xl p-1">
              <button
                onClick={() => setMetric("total_cases")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${metric === "total_cases" ? "neo text-indigo-600" : "text-slate-500 hover:text-slate-900"}`}
              >
                Raw count
              </button>
              <button
                onClick={() => setMetric("crimes_per_100k")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${perCapita ? "neo text-indigo-600" : "text-slate-500 hover:text-slate-900"}`}
              >
                Per capita
              </button>
            </div>
          </div>
          <div className="h-[480px]">
            {districts.length && gj.data ? (
              <DistrictChoropleth districts={districts} metric={metric} geojson={gj.data} />
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-500">
                {dl.error || gj.error ? `Map data error: ${String((dl.error || gj.error).message)}` : "Loading map…"}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-900/8 px-4 py-2.5 text-[11px] text-slate-500">
            <span>{perCapita ? "Crimes per 100k (Census 2011)" : "Total FIRs 2016–2024"}</span>
            <span className="flex items-center gap-2">
              Low
              <span className="h-2 w-28 rounded-full" style={{ background: "linear-gradient(90deg,#ffffcc,#fed976,#fd8d3c,#fc4e2a,#b10026)" }} />
              High
            </span>
          </div>
        </div>

        <div className="glass rounded-3xl lg:col-span-2">
          <DrillDownPanel />
        </div>
      </Reveal>

      {/* ---------- Yearly trend ---------- */}
      <Reveal as="section" className="glass rounded-3xl p-5">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Yearly FIR volume</div>
            <div className="text-[11px] text-slate-500">Statewide, all crime heads</div>
          </div>
          <span className="rounded-full border border-amber-500/25 bg-amber-50 px-2.5 py-0.5 text-[11px] text-amber-700">2024 partial</span>
        </div>
        {o && <YearlyTrend perYear={o.per_year} />}
      </Reveal>

      {/* ---------- Insights narrative (scrollytelling strip) ---------- */}
      {o && (
        <section className="space-y-4">
          <Reveal className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-500" />
            <h2 className="text-lg font-bold text-slate-900">What the data says</h2>
          </Reveal>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Reveal delay={0}>
              <InsightCard k={fmt(o.total_firs)} title="FIRs analysed" body="Nine years of incident-level records across 31 districts, reconciled to the source with zero row loss." />
            </Reveal>
            <Reveal delay={80}>
              <InsightCard k={o.top_crime_heads?.[0]?.major_head?.toLowerCase()} title="Most frequent crime head" body={`${fmt(o.top_crime_heads?.[0]?.count)} FIRs — the single largest category statewide.`} small />
            </Reveal>
            <Reveal delay={160}>
              <InsightCard k={topDistrict ? topDistrict.district : "—"} title="Highest FIR volume" body={topDistrict ? `${fmt(topDistrict.total_cases)} FIRs — concentrated urban caseload.` : ""} />
            </Reveal>
            <Reveal delay={240}>
              <InsightCard k={pct(o.rates.detection_rate)} title="Detection rate" body={`${o.pct_geocoded}% of incidents carry a mapped location after geocoding.`} />
            </Reveal>
          </div>
        </section>
      )}

      <footer className="pt-2 text-center text-[11px] text-slate-500">
        Karnataka State Police · State Crime Records Bureau — Crime Intelligence &amp; Analytical Platform ·
        <span className="text-slate-600"> Real data</span>, modeled &amp; synthetic layers are labelled throughout.
      </footer>
    </div>
  );
}

function InsightCard({ k, title, body, small }) {
  return (
    <div className="glass glass-hover h-full rounded-2xl p-5">
      <div className={`font-extrabold text-gradient-gold ${small ? "text-lg capitalize" : "text-2xl"}`}>{k}</div>
      <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-700">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-slate-500">{body}</div>
    </div>
  );
}
