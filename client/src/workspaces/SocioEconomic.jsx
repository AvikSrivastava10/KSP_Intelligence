import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { BarChart3, Scale, Info, ShieldAlert, TrendingUp } from "lucide-react";
import DataClassBadge from "../components/DataClassBadge.jsx";
import KpiCard from "../components/KpiCard.jsx";
import InfoDot from "../components/InfoDot.jsx";
import Reveal from "../components/Reveal.jsx";
import { fetchSocio } from "../api/client.js";

const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n ?? "—");
const rLabel = (r) => (r >= 0 ? `+${r.toFixed(2)}` : r.toFixed(2));

export default function SocioEconomic() {
  const q = useQuery({ queryKey: ["socio"], queryFn: fetchSocio });
  const s = q.data?.result;
  const socio = s?.correlations?.socioeconomic || [];
  const sensitive = s?.correlations?.sensitive || [];
  const districts = s?.districts || [];

  // correlation strength bars (socio-economic group only — sensitive ones are listed, not ranked)
  const corrOption = useMemo(() => {
    if (!socio.length) return null;
    const data = [...socio].reverse();
    return {
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (p) => {
          const d = data[p[0].dataIndex];
          return `${d.label}<br/>r = <b>${rLabel(d.pearson_r)}</b> (${d.strength})<br/>`
            + `p = ${d.p_value.toFixed(3)} · ${d.significant ? "significant" : "not significant"}`;
        },
      },
      grid: { left: 150, right: 30, top: 8, bottom: 26 },
      xAxis: { type: "value", min: -1, max: 1, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: "#eef2f7" } } },
      yAxis: { type: "category", data: data.map((d) => d.label), axisLabel: { fontSize: 10, color: "#475569" }, axisTick: { show: false } },
      series: [{
        type: "bar",
        data: data.map((d) => ({
          value: d.pearson_r,
          itemStyle: { color: d.significant ? (d.pearson_r >= 0 ? "#6366f1" : "#0ea5e9") : "#cbd5e1", borderRadius: 3 },
        })),
        barWidth: "55%",
        markLine: { silent: true, symbol: "none", data: [{ xAxis: 0 }], lineStyle: { color: "#94a3b8", type: "dashed" } },
      }],
    };
  }, [socio]);

  // scatter: literacy vs crime rate (the one significant relationship)
  const scatterOption = useMemo(() => {
    if (!districts.length) return null;
    const pts = districts.map((d) => [d.literacy_rate * 100, d.crimes_per_100k, d.district]);
    return {
      tooltip: {
        formatter: (p) => `<b>${p.data[2]}</b><br/>literacy ${p.data[0].toFixed(1)}%<br/>`
          + `${Math.round(p.data[1]).toLocaleString()} crimes / 100k`,
      },
      grid: { left: 60, right: 20, top: 14, bottom: 44 },
      xAxis: { type: "value", name: "Literacy rate (%)", nameLocation: "middle", nameGap: 26, nameTextStyle: { fontSize: 10, color: "#64748b" }, axisLabel: { fontSize: 10 }, scale: true, splitLine: { lineStyle: { color: "#eef2f7" } } },
      yAxis: { type: "value", name: "Crimes / 100k", nameTextStyle: { fontSize: 10, color: "#64748b" }, axisLabel: { fontSize: 10 }, scale: true, splitLine: { lineStyle: { color: "#eef2f7" } } },
      series: [{
        type: "scatter", data: pts, symbolSize: 11,
        itemStyle: { color: "#6366f1", opacity: 0.75 },
        emphasis: { itemStyle: { color: "#4338ca", opacity: 1 } },
      }],
    };
  }, [districts]);

  const topDistrict = districts[0];

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Socio-Economic Correlation</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
            The &ldquo;why&rdquo; behind the &ldquo;where&rdquo; — which district characteristics track recorded
            crime rates, and which turn out not to. <DataClassBadge kind="real" />
          </p>
        </div>
      </div>

      {/* The single most important caveat on this page */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-50/70 px-4 py-3 text-[12px] leading-relaxed text-slate-600">
        <Info size={16} className="mt-0.5 shrink-0 text-amber-600" />
        <span>
          <b className="text-slate-800">FIRs measure reported crime, not offending.</b> Districts with better police
          access and higher literacy report more, which raises their rate. These are <i>area-level</i> correlations
          across {s?.n_districts ?? 30} districts — they describe places, never people, and correlation is not causation.
        </span>
      </div>

      {q.error && <div className="glass rounded-2xl border border-rose-300 p-3 text-sm text-rose-600">Could not load socio-economic data from crime_api.</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Reveal delay={0}><KpiCard label="Districts analysed" value={s?.n_districts ?? "—"} sub="Census 2011 join" icon={Scale} accent="sky" /></Reveal>
        <Reveal delay={70}><KpiCard label="Significant links" value={s?.significant_findings ?? "—"} sub={`of ${socio.length + sensitive.length} indicators tested`} icon={BarChart3} accent="violet" /></Reveal>
        <Reveal delay={140}><KpiCard label="Strongest correlate" value={socio[0] ? socio[0].label.split(" ")[0] : "—"} sub={socio[0] ? `r = ${rLabel(socio[0].pearson_r)}` : ""} icon={TrendingUp} accent="saffron" /></Reveal>
        <Reveal delay={210}><KpiCard label="Highest crime rate" value={topDistrict ? topDistrict.district : "—"} sub={topDistrict ? `${fmt(Math.round(topDistrict.crimes_per_100k))} / 100k` : ""} icon={ShieldAlert} accent="rose" /></Reveal>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Reveal className="glass rounded-3xl lg:col-span-3">
          <div className="flex items-start gap-2 border-b border-slate-900/10 px-4 py-3">
            <BarChart3 size={16} className="mt-0.5 text-indigo-500" />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                What tracks with recorded crime
                <InfoDot text="Pearson correlation (r) between each district characteristic and crimes per 100k. r ranges −1 to +1; above +0.3 or below −0.3 is a weak-to-moderate link. Grey bars are not statistically significant (p ≥ 0.05) — treat them as no evidence of a link." />
              </div>
              <div className="text-[11px] text-slate-500">Coloured = statistically significant · grey = no evidence of a link</div>
            </div>
          </div>
          <div className="px-3 pt-3">
            {corrOption ? <ReactECharts option={corrOption} style={{ height: 190 }} notMerge /> : <div className="grid h-[190px] place-items-center text-sm text-slate-500">Loading…</div>}
          </div>
          {s?.headline && (
            <div className="mx-4 mb-4 rounded-xl bg-slate-900/[0.03] px-3 py-2 text-[12px] leading-relaxed text-slate-600">
              <b className="text-slate-800">In plain terms:</b> {s.headline}
            </div>
          )}
        </Reveal>

        <Reveal className="glass rounded-3xl lg:col-span-2">
          <div className="flex items-start gap-2 border-b border-slate-900/10 px-4 py-3">
            <TrendingUp size={16} className="mt-0.5 text-violet-500" />
            <div>
              <div className="text-sm font-semibold text-slate-900">Literacy vs crime rate</div>
              <div className="text-[11px] text-slate-500">One dot per district</div>
            </div>
          </div>
          <div className="px-3 pt-3 pb-4">
            {scatterOption ? <ReactECharts option={scatterOption} style={{ height: 240 }} notMerge /> : <div className="grid h-[240px] place-items-center text-sm text-slate-500">Loading…</div>}
          </div>
        </Reveal>
      </div>

      {/* Protected attributes — deliberately separated, never ranked */}
      <Reveal className="glass rounded-3xl p-5">
        <div className="mb-1 flex items-center gap-2">
          <ShieldAlert size={16} className="text-rose-500" />
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            Protected attributes — audit only
            <InfoDot text="Caste share and sex ratio are protected attributes. They are shown here solely so enforcement disparity can be audited, and are deliberately kept out of every predictive model in this platform (the risk model excludes them by design). They must never be used to rank, target or deploy." />
          </div>
        </div>
        <p className="mb-3 max-w-4xl text-[11px] leading-relaxed text-slate-500">
          {s?.protected_attributes_finding}
        </p>
        <div className="grid gap-2 md:grid-cols-3">
          {sensitive.map((r) => (
            <div key={r.indicator} className="rounded-xl border border-rose-500/20 bg-rose-50/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-slate-800">{r.label}</span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.significant ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-600"}`}>
                  r {rLabel(r.pearson_r)}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {r.significant ? "Statistically significant" : "No significant association"} (p = {r.p_value.toFixed(3)}, {r.strength})
              </div>
            </div>
          ))}
          {!sensitive.length && <div className="text-xs text-slate-500">Loading…</div>}
        </div>
        <div className="mt-3 rounded-xl border border-slate-900/10 bg-white/60 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          <b className="text-slate-700">Why these are shown but never used:</b> excluding protected attributes from
          models prevents discriminatory targeting; reporting them at area level lets the force check whether
          enforcement itself is uneven. Any apparent association here is confounded by poverty, urbanisation and
          reporting access — it is not evidence about any community.
        </div>
      </Reveal>

      {/* District table */}
      <Reveal className="glass rounded-3xl p-5">
        <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Scale size={15} className="text-sky-500" /> District indicators
          <InfoDot text="Crime rate uses 2011 Census population as the denominator against 2016–2024 FIR counts, so rates are indicative rather than exact." />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-900/10">
                <th className="py-2 pr-3 font-semibold">District</th>
                <th className="py-2 pr-3 text-right font-semibold">Crimes / 100k</th>
                <th className="py-2 pr-3 text-right font-semibold">Population</th>
                <th className="py-2 pr-3 text-right font-semibold">Literacy</th>
                <th className="py-2 text-right font-semibold">Urban</th>
              </tr>
            </thead>
            <tbody>
              {districts.slice(0, 14).map((d) => (
                <tr key={d.census_code_2011} className="border-b border-slate-900/5 last:border-0">
                  <td className="py-1.5 pr-3 font-medium text-slate-700">{d.district}</td>
                  <td className="py-1.5 pr-3 text-right text-slate-600">{fmt(Math.round(d.crimes_per_100k))}</td>
                  <td className="py-1.5 pr-3 text-right text-slate-500">{fmt(d.population_2011)}</td>
                  <td className="py-1.5 pr-3 text-right text-slate-500">{(d.literacy_rate * 100).toFixed(1)}%</td>
                  <td className="py-1.5 text-right text-slate-500">{d.urban_share != null ? `${(d.urban_share * 100).toFixed(0)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[10px] text-slate-400">Showing 14 of {districts.length} districts, highest rate first.</div>
      </Reveal>

      <footer className="pt-1 text-center text-[11px] text-slate-500">
        Correlations computed offline (Pearson + Spearman, n={s?.n_districts ?? 30}) on real FIR + Census 2011 data · area-level only.
      </footer>
    </div>
  );
}
