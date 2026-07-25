import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  Network, Share2, Sparkles, MapPin, Layers, ShieldCheck, Users, FlaskConical, Fingerprint,
  Search, X, Table2, Crosshair, ArrowRight, Gauge,
} from "lucide-react";
import DataClassBadge from "../components/DataClassBadge.jsx";
import KpiCard from "../components/KpiCard.jsx";
import InfoDot from "../components/InfoDot.jsx";
import Reveal from "../components/Reveal.jsx";
import {
  fetchNetwork, fetchCommunities, fetchRules,
  fetchPersonNetwork, fetchOffenderProfiles, fetchLinkage,
  fetchEntities, fetchEntityDetail, fetchMatrix,
} from "../api/client.js";

const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n ?? "—");
const PALETTE = ["#6366f1", "#0ea5e9", "#f59e0b", "#ef4444", "#10b981", "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#64748b"];
// Community colour, shared by the graph legend and the entity table so a given ecosystem
// reads as the same colour everywhere. Guards non-numeric ids rather than returning undefined.
const clusterColor = (i) => PALETTE[(Number.isFinite(+i) ? Math.abs(+i) : 0) % PALETTE.length];
// Source data is SHOUTED ("MOTOR VEHICLE ACCIDENTS NON-FATAL"). All-caps is slower to read and
// looks like shouting on screen, so everything user-facing is sentence-cased.
const title = (s) => String(s || "").toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const prettyTheme = (s) => title(s).replace(/ Non-Fatal$/i, "").replace(/&/g, "and");

/**
 * Axis labels for the grid.
 *
 * The source names are full legal titles — "NARCOTIC DRUGS AND PSYCHOTROPIC SUBSTANCES ACT, 1985"
 * is 52 characters, and a column in this grid is roughly 29px wide. No rotation makes that fit, so
 * the previous version truncated everything to "Na…" and the axis became useless.
 *
 * The fix is not a smaller font — it is to use the short forms officers actually say: IPC, CrPC,
 * NDPS, POCSO, MV Act. Shorter AND more familiar. The full legal title is still shown in the
 * tooltip, so nothing is lost.
 */
const ACT_SHORT = [
  [/^IPC\b|INDIAN PENAL/i, "IPC"],
  [/CODE OF CRIMINAL PROCEDURE|^CRPC\b/i, "CrPC"],
  [/MOTOR VEHICLES? ACT/i, "MV Act"],
  [/NARCOTIC DRUGS|PSYCHOTROPIC|PSHYCOTROPIC/i, "NDPS"],
  [/PROTECTION OF CHILDREN FROM SEXUAL/i, "POCSO"],
  [/INFORMATION TECHNOLOGY ACT\D*(\d{4})/i, (m) => `IT Act '${m[1].slice(2)}`],
  [/KARNATAKA POLICE ACT/i, "KP Act"],
  [/KARNATAKA EXCISE ACT/i, "Excise Act"],
  [/DOWRY PROHIBITION/i, "Dowry Act"],
  [/^MMDR|MINES AND MINERALS/i, "MMDR"],
  [/KARNATAKA MINOR MINERAL/i, "Minor Mineral"],
  [/ARMS ACT/i, "Arms Act"],
  [/EXPLOSIVE/i, "Explosives Act"],
  [/COPY ?RIGHT/i, "Copyright Act"],
  [/GAMBLING/i, "Gambling Act"],
  [/COTPA|CIGARETTES/i, "COTPA"],
  [/SCHEDULED CASTE|SC\/ST|ATROCIT/i, "SC/ST Act"],
  [/FOREIGNERS? ACT/i, "Foreigners Act"],
  [/PASSPORT/i, "Passport Act"],
  [/WILD ?LIFE/i, "Wildlife Act"],
  [/ELECTRICITY/i, "Electricity Act"],
  [/RAILWAY/i, "Railways Act"],
];

// Title-casing mangles legal acronyms ("CrPC" -> "Crpc", "NDPS" -> "Ndps"). Restore them, because
// getting a statute's name wrong on screen undermines trust faster than any layout problem.
const ACRONYMS = [
  [/\bCrpc\b/g, "CrPC"], [/\bNdps\b/g, "NDPS"], [/\bIpc\b/g, "IPC"], [/\bPocso\b/g, "POCSO"],
  [/\bIt Act\b/g, "IT Act"], [/\bMv\b/g, "MV"], [/\bKa\b/g, "KA"], [/\bMmdr\b/g, "MMDR"],
  [/\bSc\/St\b/g, "SC/ST"], [/\bCotpa\b/g, "COTPA"], [/\bKp Act\b/g, "KP Act"],
];
const fixAcronyms = (s) => ACRONYMS.reduce((acc, [re, out]) => acc.replace(re, out), s);

/** Fall back to something readable when the act is not one of the well-known ones. */
function genericShort(name) {
  let t = String(name)
    .replace(/\(.*?\)/g, " ")                 // drop parenthetical expansions
    .replace(/,?\s*(19|20)\d{2}\s*$/, "")     // drop a trailing year
    .replace(/\bACT\b|\bRULES?\b|\bTHE\b|\bOF\b|\bAND\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) t = String(name);
  const words = t.split(" ").filter(Boolean);
  // Long multi-word titles become initials; short ones stay as words.
  if (t.length > 16 && words.length > 2) return words.map((w) => w[0]).join("").toUpperCase();
  return fixAcronyms(title(t));
}

const shortAct = (name) => {
  for (const [re, out] of ACT_SHORT) {
    const m = String(name).match(re);
    if (m) return typeof out === "function" ? out(m) : out;
  }
  return genericShort(name);
};


/** Crime types sit on the horizontal axis, so they get more room than the acts do. */
const shortCrime = (name) => {
  const t = fixAcronyms(title(name))
    .replace(/^Motor Vehicle Accidents\s*/i, "MV Accidents ")
    .replace(/Narcotic Drugs.*/i, "NDPS")
    .replace(/Kidnapping And Abduction/i, "Kidnapping / Abduction")
    .replace(/Scheduled Caste And The Scheduled Tribes/i, "SC/ST Act")
    .replace(/Karnataka State Local Act/i, "KA State Local Act")
    .replace(/Karnataka Police Act.*/i, "KA Police Act")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > 30 ? `${t.slice(0, 29)}…` : t;
};

export default function NetworkLink() {
  const [mode, setMode] = useState("entity");         // "entity" (real) | "person" (synthetic)
  const [community, setCommunity] = useState("");     // "" = whole graph
  const [ruleType, setRuleType] = useState("co_occurrence");
  const isPerson = mode === "person";

  const personQ = useQuery({ queryKey: ["person-network"], queryFn: fetchPersonNetwork, enabled: isPerson });
  const offQ = useQuery({ queryKey: ["offenders"], queryFn: () => fetchOffenderProfiles(20), enabled: isPerson });
  const linkQ = useQuery({ queryKey: ["linkage"], queryFn: fetchLinkage, enabled: isPerson });
  const pnet = personQ.data?.result;
  const offenders = offQ.data?.result;
  const linkage = linkQ.data?.result;

  // --- explorer state ---
  const [selected, setSelected] = useState(null);   // entity id being inspected
  const [focus, setFocus] = useState("");           // ego-network centre
  const [nodeType, setNodeType] = useState("");     // "" | crime_head | act
  const [search, setSearch] = useState("");
  const [ruleSearch, setRuleSearch] = useState("");
  const [showTable, setShowTable] = useState(false);
  const [tableSort, setTableSort] = useState("pagerank");
  // Connection-strength floor. Only 8.5% of edges carry >=1000 shared cases, so showing all
  // 1,430 renders as an unreadable hairball. Default to "common" — enough structure to read,
  // little enough to follow a line with your eye.
  const [minWeight, setMinWeight] = useState(200);
  // "grid" is the default because a force layout genuinely cannot render this data legibly:
  // IPC 1860 sits in 77.8% of all FIRs with 292 links, so physics collapses everything into a
  // starburst around it and labels overlap. A grid has fixed positions and no overlap at all.
  const [view, setView] = useState("grid");
  // IPC-type nodes connect to almost everything, which adds no discriminating information to a
  // graph while dominating its shape. Hidden by default in the network view only.
  const [hideHubs, setHideHubs] = useState(true);

  const matrixQ = useQuery({
    queryKey: ["matrix"], queryFn: () => fetchMatrix(16, 12), enabled: view === "grid" && !isPerson,
  });
  const matrix = matrixQ.data?.result;

  const netQ = useQuery({
    queryKey: ["network", community || "all", focus || "none", nodeType || "all"],
    queryFn: () => fetchNetwork(community || undefined, 220, { focus: focus || undefined, type: nodeType || undefined }),
  });
  const entitiesQ = useQuery({
    queryKey: ["entities", search, nodeType, community || "all", tableSort],
    queryFn: () => fetchEntities({ q: search, type: nodeType, community, sort: tableSort, limit: 100 }),
    enabled: showTable || search.length > 0,
  });
  const detailQ = useQuery({
    queryKey: ["entity", selected],
    queryFn: () => fetchEntityDetail(selected),
    enabled: !!selected,
  });
  const detail = detailQ.data?.result;
  const entityList = entitiesQ.data?.result;
  const comQ = useQuery({ queryKey: ["communities"], queryFn: fetchCommunities });
  const rulQ = useQuery({
    queryKey: ["rules", ruleType, ruleSearch],
    queryFn: () => fetchRules(ruleType, 60, ruleSearch),
  });

  const net = netQ.data?.result;
  const communities = comQ.data?.result?.communities || [];
  const modularity = comQ.data?.result?.modularity;
  const rules = rulQ.data?.result?.rules || [];

  // --- person graph (synthetic): accused vs victim, repeat offenders emphasised ---
  const personOption = useMemo(() => {
    if (!pnet?.nodes?.length) return null;
    const maxCases = Math.max(...pnet.nodes.map((n) => n.n_cases || 1), 1);
    return {
      tooltip: {
        confine: true,
        formatter: (p) => {
          if (p.dataType === "edge") {
            return p.data.edge_type === "co_accused"
              ? "<b>co-accused</b> in the same case" : "<b>accused ↔ victim</b> in the same case";
          }
          const d = p.data;
          return `<b>${d.name}</b> <span style="color:#a21caf">(synthetic)</span><br/>`
            + `${d.node_type} · ${d.gender}, age ${d.age}<br/>${d.home_district}`
            + (d.is_repeat_offender ? `<br/><b style="color:#dc2626">repeat offender — ${d.n_cases} cases</b>` : "");
        },
      },
      legend: [{ data: ["Repeat offender", "Accused", "Victim"], bottom: 0, textStyle: { fontSize: 10 }, itemWidth: 10, itemHeight: 10 }],
      series: [{
        type: "graph", layout: "force", roam: true, draggable: true,
        categories: [{ name: "Repeat offender" }, { name: "Accused" }, { name: "Victim" }],
        color: ["#dc2626", "#6366f1", "#14b8a6"],
        data: pnet.nodes.map((n) => ({
          name: n.id, ...n,
          category: n.is_repeat_offender ? 0 : n.node_type === "victim" ? 2 : 1,
          symbolSize: n.is_repeat_offender ? 10 + 16 * Math.sqrt((n.n_cases || 1) / maxCases) : 7,
          label: { show: false },
        })),
        links: pnet.edges.map((e) => ({
          source: e.source, target: e.target, edge_type: e.edge_type,
          lineStyle: {
            width: e.edge_type === "co_accused" ? 1.6 : 0.7,
            color: e.edge_type === "co_accused" ? "#dc2626" : "#94a3b8",
            opacity: e.edge_type === "co_accused" ? 0.6 : 0.3, curveness: 0.08,
          },
        })),
        emphasis: { focus: "adjacency", label: { show: true, fontSize: 10, formatter: (p) => p.data.name } },
        force: { repulsion: 180, edgeLength: [25, 90], gravity: 0.14, friction: 0.24 },
      }],
    };
  }, [pnet]);

  // Charts sit inside Reveal, which animates its wrapper, and inside a responsive grid. ECharts
  // measures the container once at init, so a width that is still settling can leave the canvas
  // sized wrong. Resizing on ready is a cheap guard against that.
  const chartReady = (chart) => {
    requestAnimationFrame(() => chart.resize());
    setTimeout(() => chart.resize(), 120);
  };

  // --- GRID VIEW: crime type x legal act. Fixed positions, zero overlap, identical every load. ---
  const shorten = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const gridOption = useMemo(() => {
    if (!matrix?.cells?.length) return null;
    const rowLabels = matrix.rows.map((r) => shortCrime(r.id));
    const colLabels = matrix.cols.map((c) => shortAct(c.id));
    return {
      // A reference grid should appear settled, not animate itself in. Static also means the
      // first paint is synchronous rather than deferred to an animation frame.
      animation: false,
      tooltip: {
        confine: true,
        extraCssText: "max-width:300px;white-space:normal;",
        formatter: (p) => {
          const c = matrix.cells[p.dataIndex];
          if (!c) return "";
          if (!c.cases) {
            return `<b>${title(c.crime_head)}</b> is not normally booked under<br/><b>${title(c.act)}</b>`;
          }
          return `<b>${title(c.crime_head)}</b><br/>`
            + `<span style="color:#4f46e5">${(c.share * 100).toFixed(0)}% of these cases also cite</span><br/>`
            + `<b>${title(c.act)}</b><br/>`
            + `<span style="color:#64748b">${c.cases.toLocaleString()} FIRs</span>`;
        },
      },
      // Generous left/top margins: the axis labels are the point of this chart, so they get the
      // room rather than being squeezed to fit a bigger plot area.
      grid: { left: 196, right: 28, top: 78, bottom: 16 },
      xAxis: {
        type: "category", position: "top", data: colLabels,
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: {
          rotate: 40, fontSize: 11, color: "#334155", fontWeight: 500,
          align: "left", verticalAlign: "middle", margin: 10,
        },
        splitArea: { show: true, areaStyle: { color: ["rgba(255,255,255,0)", "rgba(148,163,184,0.04)"] } },
      },
      yAxis: {
        type: "category", data: rowLabels, inverse: true,
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { fontSize: 11, color: "#334155", fontWeight: 500, margin: 10 },
        splitArea: { show: true, areaStyle: { color: ["rgba(255,255,255,0)", "rgba(148,163,184,0.04)"] } },
      },
      visualMap: {
        min: 0, max: 1, show: false,
        // Ramp stops at a mid indigo rather than near-black: cell labels use one static colour
        // (heatmap labels take no per-cell colour callback), so every shade must stay light
        // enough for dark text to remain readable on it.
        inRange: { color: ["#f8fafc", "#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8"] },
      },
      series: [{
        type: "heatmap",
        data: matrix.cells.map((c) => [c.col, c.row, c.share]),
        itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 3 },
        label: {
          show: true, fontSize: 9, color: "#1e293b", fontWeight: 500,
          formatter: (p) => (p.value[2] >= 0.08 ? `${Math.round(p.value[2] * 100)}%` : ""),
        },
        emphasis: { itemStyle: { borderColor: "#4338ca", borderWidth: 2 } },
      }],
    };
  }, [matrix]);

  const option = useMemo(() => {
    if (!net?.nodes?.length) return null;

    // Ubiquitous nodes (IPC 1860 = 77.8% of all FIRs, 292 links) connect to nearly everything.
    // They add no discriminating information but dominate the layout, pulling every other node
    // into a starburst. Removing them lets the ACTUAL structure become visible.
    const HUB_SHARE = 0.35 * 1674734;
    const hubIds = new Set(hideHubs ? net.nodes.filter((n) => n.cases > HUB_SHARE).map((n) => n.id) : []);

    // 1) keep only meaningful connections, 2) drop whatever is left unconnected — an isolated
    //    dot tells an officer nothing and just adds visual noise.
    const strongEdges = net.edges.filter((e) => e.weight >= minWeight
      && !hubIds.has(e.source) && !hubIds.has(e.target));
    const connected = new Set();
    strongEdges.forEach((e) => { connected.add(e.source); connected.add(e.target); });
    const shownNodes = net.nodes.filter((n) => connected.has(n.id) && !hubIds.has(n.id));
    if (!shownNodes.length) return null;

    // legend reads as plain crime-pattern names, not "#0 / #5"
    const themeById = new Map(communities.map((c) => [c.community_id, prettyTheme(c.theme)]));
    const catIds = [...new Set(shownNodes.map((n) => n.community_id))].sort((a, b) => a - b);
    const categories = catIds.map((i) => ({ name: themeById.get(i) || `Group ${i}` }));
    const catIndex = new Map(catIds.map((id, i) => [id, i]));

    const maxCases = Math.max(...shownNodes.map((n) => n.cases || 1), 1);
    const maxW = Math.max(...strongEdges.map((e) => e.log_weight || 1), 1);

    return {
      tooltip: {
        confine: true,
        extraCssText: "max-width:280px;white-space:normal;",
        formatter: (p) => {
          if (p.dataType === "edge") {
            // an officer needs the "so what", not a bare count
            return `<b>${title(p.data.source)}</b> &amp; <b>${title(p.data.target)}</b>`
              + `<br/><span style="color:#4f46e5">Booked together in ${p.data.weight.toLocaleString()} FIRs</span>`
              + `<br/><span style="color:#64748b">When one of these is registered, the other`
              + ` frequently applies too — worth checking on the chargesheet.</span>`;
          }
          const d = p.data;
          const kind = d.node_type === "act" ? "Law / Act" : "Crime type";
          return `<b>${title(d.name)}</b><br/><span style="color:#64748b">${kind}</span>`
            + (d.cases ? `<br/>${d.cases.toLocaleString()} FIRs recorded` : "")
            + `<br/>Appears alongside ${d.degree} other${d.degree === 1 ? "" : "s"}`
            + (d.top_districts?.length ? `<br/><span style="color:#64748b">Most active: ${d.top_districts.slice(0, 2).join(", ")}</span>` : "")
            + `<br/><span style="color:#4f46e5">Click to open the full breakdown</span>`;
        },
      },
      legend: [{
        data: categories.map((c) => c.name), type: "scroll", bottom: 0,
        textStyle: { fontSize: 10, color: "#475569" }, itemWidth: 10, itemHeight: 10,
      }],
      series: [{
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        categories,
        data: shownNodes.map((n) => ({
          name: n.id,
          value: n.cases,
          cases: n.cases,
          degree: n.degree,
          node_type: n.node_type,
          top_districts: n.top_districts,
          category: catIndex.get(n.community_id) ?? 0,
          symbol: n.node_type === "act" ? "rect" : "circle",
          symbolSize: 8 + 26 * Math.sqrt((n.cases || 1) / maxCases),
          itemStyle: { opacity: 0.9, borderColor: "#fff", borderWidth: 1 },
          // label the biggest few so the map is orientable at a glance
          label: {
            show: (n.cases || 0) > maxCases * 0.04,
            fontSize: 9, color: "#334155", position: "right",
            formatter: (p) => title(p.name.length > 26 ? `${p.name.slice(0, 24)}…` : p.name),
          },
        })),
        links: strongEdges.map((e) => ({
          source: e.source, target: e.target, weight: e.weight,
          lineStyle: { width: 0.5 + 3.5 * ((e.log_weight || 1) / maxW), opacity: 0.28, curveness: 0.1 },
        })),
        emphasis: {
          focus: "adjacency",
          lineStyle: { width: 3, opacity: 0.95, color: "#4f46e5" },
          itemStyle: { opacity: 1 },
          label: { show: true, fontSize: 11, fontWeight: "bold" },
        },
        blur: { itemStyle: { opacity: 0.12 }, lineStyle: { opacity: 0.04 }, label: { show: false } },
        force: { repulsion: 420, edgeLength: [60, 190], gravity: 0.1, friction: 0.2 },
        color: PALETTE,
      }],
    };
  }, [net, communities, minWeight, hideHubs]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Network &amp; Link Analysis</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
            {isPerson
              ? "Suspect ↔ victim relationships and repeat offenders across jurisdictions — a labelled demonstration of the capability."
              : "Which offences and laws keep turning up on the same FIR — so you can see what usually accompanies a case, and which patterns repeat across the state."}{" "}
            <DataClassBadge kind={isPerson ? "synthetic" : "real"} />
          </p>
        </div>
        <div className="neo-inset flex gap-1 rounded-xl p-1">
          {[["entity", "Entity network", ShieldCheck], ["person", "Person network", Users]].map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                mode === k ? (k === "person" ? "neo text-fuchsia-600" : "neo text-indigo-600") : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <Icon size={13} /> {label}
              {k === "person" && <span className="rounded-full bg-fuchsia-100 px-1.5 py-0.5 text-[9px] font-bold text-fuchsia-700">DEMO</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Permanent, unmissable provenance banner — synthetic must never be mistaken for real */}
      {isPerson && (
        <div className="flex items-start gap-2.5 rounded-2xl border-2 border-fuchsia-500/40 bg-fuchsia-50/80 px-4 py-3 text-[12px] leading-relaxed text-slate-700">
          <FlaskConical size={18} className="mt-0.5 shrink-0 text-fuchsia-600" />
          <span>
            <b className="text-fuchsia-800">SYNTHETIC DEMONSTRATION — no real individual is depicted.</b>{" "}
            Person-level data cannot be obtained: identities are confidential under Indian law and the FIR
            extract holds only aggregate counts. Every name, face and relationship below is fabricated,
            generated to match <i>real</i> aggregate case volumes so the capability can be shown honestly.
            It lives in a separate data plane and never trains or feeds any model.
          </span>
        </div>
      )}

      {/* Honest-scope banner: this is the defensible form of link analysis for this data */}
      {!isPerson && (
      <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/25 bg-emerald-50/70 px-4 py-3 text-[12px] leading-relaxed text-slate-600">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" />
        <span>
          <b className="text-slate-800">Entity network — built entirely on real data.</b> Victim/accused identities are
          confidential under Indian law and absent from the FIR extract, so this maps relationships between
          <i> case attributes</i> — crime types, legal acts and districts. No individual is profiled here.
          The <b>Person network</b> tab demonstrates the suspect↔victim capability using clearly-labelled
          synthetic people, kept in a separate data plane.
        </span>
      </div>
      )}

      {netQ.error && !isPerson && <div className="glass rounded-2xl border border-rose-300 p-3 text-sm text-rose-600">Could not load network data from crime_api.</div>}

      {!isPerson && (<>
      {/* ---------- explorer toolbar: find any entity, filter, focus ---------- */}
      <Reveal className="glass rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search all 483 entities — e.g. cyber, arms, theft, IPC…"
              aria-label="Search entities"
              className="neo-inset w-full rounded-xl bg-transparent py-2 pl-9 pr-8 text-xs text-slate-700 outline-none placeholder:text-slate-400"
            />
            {search && (
              <button onClick={() => setSearch("")} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                <X size={13} />
              </button>
            )}
          </div>

          <div className="neo-inset flex gap-1 rounded-xl p-1">
            {[["", "All"], ["crime_head", "Crime types"], ["act", "Legal acts"]].map(([k, label]) => (
              <button key={k || "all"} onClick={() => setNodeType(k)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all ${nodeType === k ? "neo text-indigo-600" : "text-slate-500 hover:text-slate-900"}`}>
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowTable((s) => !s)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold transition-all ${showTable ? "neo text-indigo-600" : "neo-inset text-slate-600 hover:text-slate-900"}`}
          >
            <Table2 size={13} /> {showTable ? "Hide" : "Browse"} all entities
          </button>

          {focus && (
            <button onClick={() => setFocus("")}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-400 bg-indigo-50 px-3 py-2 text-[11px] font-semibold text-indigo-700">
              <Crosshair size={13} /> focused: {focus.toLowerCase()} <X size={12} />
            </button>
          )}
        </div>

        {/* Start here — an officer should never have to guess where to click first */}
        {!search && !selected && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-900/8 pt-2">
            <span className="py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Start with a common offence
            </span>
            {["THEFT", "BURGLARY - NIGHT", "CYBER CRIME", "CASES OF HURT", "ROBBERY", "MURDER", "MOTOR VEHICLE ACCIDENTS NON-FATAL"].map((c) => (
              <button key={c} onClick={() => setSelected(c)}
                className="rounded-full border border-indigo-400/40 bg-indigo-50/70 px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100">
                {title(c)}
              </button>
            ))}
          </div>
        )}

        {/* live search results — click to inspect */}
        {search && entityList && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-900/8 pt-2">
            <span className="py-1 text-[10px] uppercase tracking-wide text-slate-400">
              {entityList.total} match{entityList.total === 1 ? "" : "es"}
            </span>
            {entityList.entities.slice(0, 14).map((e) => (
              <button key={e.id} onClick={() => setSelected(e.id)} title={`${fmt(e.cases)} cases · ${e.degree} connections`}
                className="rounded-full border border-slate-900/10 bg-white/70 px-2.5 py-1 text-[11px] text-slate-700 transition-colors hover:border-indigo-400 hover:text-indigo-600">
                {e.id.toLowerCase()}
                <span className="ml-1.5 text-[9px] text-slate-400">{e.node_type === "act" ? "act" : "crime"}</span>
              </button>
            ))}
            {entityList.total === 0 && <span className="py-1 text-[11px] text-slate-500">No entity matches that.</span>}
          </div>
        )}
      </Reveal>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Reveal delay={0}><KpiCard label="Entities mapped" value={net ? fmt(net.graph_stats?.nodes) : "—"} sub="crime types + legal acts" icon={Network} accent="violet" /></Reveal>
        <Reveal delay={70}><KpiCard label="Connections" value={net ? fmt(net.graph_stats?.edges) : "—"} sub="within-case co-occurrence" icon={Share2} accent="sky" /></Reveal>
        <Reveal delay={140}><KpiCard label="Crime patterns found" value={communities.length || "—"} sub="groups of offences that recur together" icon={Layers} accent="saffron" /></Reveal>
        <Reveal delay={210}><KpiCard label="Association rules" value={rulQ.data?.result?.total ?? "—"} sub="stronger than chance (lift > 1)" icon={Sparkles} accent="emerald" /></Reveal>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Force graph */}
        <Reveal className="glass rounded-3xl lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-900/10 px-4 py-3">
            <div className="flex items-start gap-2">
              <Network size={16} className="mt-0.5 text-violet-500" />
              <div>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  Which crimes and laws get booked together
                  <InfoDot text="Built from 1.67 million real FIRs. The grid reads one row at a time: for that offence, how often each law also appears on the same FIR. Useful when framing charges or checking a chargesheet is complete." />
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {view === "grid"
                    ? "Read a row: for that offence, how often each law also appears on the FIR."
                    : "Each shape is a crime type or law; a line means they shared an FIR."}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="neo-inset flex gap-1 rounded-xl p-1">
                {[["grid", "Grid", Table2], ["graph", "Network", Share2]].map(([k, label, Icon]) => (
                  <button key={k} onClick={() => setView(k)}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all ${view === k ? "neo text-indigo-600" : "text-slate-500 hover:text-slate-900"}`}>
                    <Icon size={12} /> {label}
                  </button>
                ))}
              </div>
              {view === "graph" && (
                <select
                  value={community}
                  onChange={(e) => setCommunity(e.target.value)}
                  aria-label="Filter graph by crime pattern group"
                  className="neo-inset rounded-lg bg-transparent px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none"
                >
                  <option value="">All crime patterns</option>
                  {communities.map((c) => <option key={c.community_id} value={c.community_id}>{prettyTheme(c.theme)}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Grid legend — a colour scale, not a list of IDs */}
          {view === "grid" && (
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-900/8 px-4 py-2 text-[11px] text-slate-500">
              <span className="font-medium">Share of that offence&apos;s FIRs citing the law</span>
              <span className="flex items-center gap-1.5">
                0%
                <span className="h-2.5 w-28 rounded-full border border-slate-900/10" style={{ background: "linear-gradient(90deg,#f8fafc,#eef2ff,#e0e7ff,#c7d2fe,#a5b4fc,#818cf8)" }} />
                100%
              </span>
              <span className="text-slate-400">
                rows = offences · columns = laws (short forms — hover any cell for the full legal title)
              </span>
            </div>
          )}

          {/* Graph controls — only meaningful in graph mode */}
          {view === "graph" && (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-900/8 px-4 py-2">
              <span className="text-[11px] font-medium text-slate-500">Show links booked together at least</span>
              <div className="neo-inset flex gap-1 rounded-lg p-1">
                {[[1000, "1,000×"], [200, "200×"], [50, "50×"], [0, "any"]].map(([w, label]) => (
                  <button key={w} onClick={() => setMinWeight(w)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${minWeight === w ? "neo text-indigo-600" : "text-slate-500 hover:text-slate-900"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                <input type="checkbox" checked={hideHubs} onChange={(e) => setHideHubs(e.target.checked)} />
                hide IPC 1860 &amp; other catch-all laws
                <InfoDot text="IPC 1860 appears in 77.8% of all FIRs and links to 292 other entities. It tells you almost nothing about a specific case, but its sheer connectedness pulls every other node into a starburst. Hiding it lets the real structure show." />
              </label>
            </div>
          )}
          <div className="px-2 pt-2">
            {view === "grid" ? (
              gridOption
                ? <ReactECharts
                    key="grid"
                    option={gridOption}
                    style={{ height: 520, width: "100%" }}
                    notMerge
                    onChartReady={chartReady}
                    onEvents={{ click: (p) => { const c = matrix?.cells?.[p.dataIndex]; if (c) setSelected(c.crime_head); } }}
                  />
                : <div className="grid h-[520px] place-items-center text-sm text-slate-500">Loading grid…</div>
            ) : (
              option
                ? <ReactECharts
                    key="graph"
                    option={option}
                    style={{ height: 520, width: "100%" }}
                    notMerge
                    onChartReady={chartReady}
                    onEvents={{ click: (p) => { if (p.dataType === "node") setSelected(p.data.name); } }}
                  />
                : <div className="grid h-[520px] place-items-center text-sm text-slate-500">
                    No connections at this strength — try a lower threshold.
                  </div>
            )}
          </div>
        </Reveal>

        {/* Entity detail — replaces the community list while inspecting */}
        {selected ? (
          <Reveal className="glass rounded-3xl p-4 lg:col-span-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold capitalize text-slate-900">
                  {selected.toLowerCase()}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {detail ? `${detail.node_type === "act" ? "Legal act" : "Crime type"} · ${fmt(detail.cases)} FIRs · rank ${detail.rank_by_pagerank}/${detail.total_entities} by influence` : "loading…"}
                </div>
              </div>
              <button onClick={() => setSelected(null)} title="Close"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-900/[0.05] hover:text-slate-700">
                <X size={15} />
              </button>
            </div>

            {detail && (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="neo-inset rounded-xl p-2">
                    <div className="text-base font-bold text-slate-900">{detail.neighbour_count}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">connections</div>
                  </div>
                  <div className="neo-inset rounded-xl p-2">
                    <div className="text-base font-bold text-slate-900">{detail.rules.length}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">rules</div>
                  </div>
                  <div className="neo-inset rounded-xl p-2">
                    <div className="text-base font-bold text-slate-900">{detail.is_hub ? "Hub" : "—"}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">structure</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button onClick={() => setFocus(selected)}
                    className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100">
                    <Crosshair size={12} /> Focus graph on this
                  </button>
                  {detail.community && (
                    <button onClick={() => { setCommunity(String(detail.community.community_id)); setFocus(""); }}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-900/10 bg-white/70 px-2.5 py-1 text-[11px] text-slate-600 hover:border-amber-400">
                      <Layers size={12} /> See its pattern group: {prettyTheme(detail.community.theme)}
                    </button>
                  )}
                </div>

                {/* what the connections actually mean */}
                <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Usually booked alongside <InfoDot text="Read it as: out of every 100 FIRs for this offence, this many also carry the item listed. Useful when framing charges or checking a chargesheet is complete." />
                </div>
                <div className="mt-1 max-h-[190px] space-y-1.5 overflow-y-auto pr-1">
                  {/* Links under 1% round to "0%" on screen, which reads as an error and buries
                      the ones that matter. Show the meaningful ones; count the rest. */}
                  {detail.neighbours.filter((n) => (n.share_of_entity || 0) >= 0.01).map((n) => (
                    <button key={n.id} onClick={() => setSelected(n.id)} title={`${fmt(n.weight)} shared FIRs — click to inspect`}
                      className="w-full text-left">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${n.node_type === "act" ? "bg-sky-500" : "bg-indigo-500"}`} />
                          <span className="truncate capitalize text-slate-700">{n.id.toLowerCase()}</span>
                        </span>
                        <span className="shrink-0 font-semibold text-slate-600">
                          {n.share_of_entity != null ? `${(n.share_of_entity * 100).toFixed(0)}%` : fmt(n.weight)}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-900/[0.06]">
                        <div className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${Math.min((n.share_of_entity || 0) * 100, 100)}%` }} />
                      </div>
                    </button>
                  ))}
                  {(() => {
                    const weak = detail.neighbours.filter((n) => (n.share_of_entity || 0) < 0.01).length;
                    return weak > 0 ? (
                      <div className="pt-1 text-[10px] text-slate-400">
                        + {weak} occasional link{weak === 1 ? "" : "s"} (under 1% of cases) not shown
                      </div>
                    ) : null;
                  })()}
                  {detail.neighbours.filter((n) => (n.share_of_entity || 0) >= 0.01).length === 0 && (
                    <div className="text-[11px] text-slate-500">No regular companion charges — this offence is usually booked on its own.</div>
                  )}
                </div>

                {detail.rules.length > 0 && (
                  <div className="mt-3 border-t border-slate-900/5 pt-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Strongest patterns</div>
                    <ul className="space-y-1">
                      {detail.rules.slice(0, 3).map((r, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                          <Gauge size={11} className="mt-0.5 shrink-0 text-indigo-500" /> {r.reading}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {detail.top_districts.length > 0 && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
                    <MapPin size={10} /> most active in {detail.top_districts.join(" · ")}
                  </div>
                )}
              </>
            )}
          </Reveal>
        ) : (
        /* Communities */
        <Reveal className="glass rounded-3xl p-4 lg:col-span-2">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Layers size={15} className="text-amber-500" /> Crime pattern groups
            <InfoDot text="Groups of crime types and legal acts that repeatedly appear together, detected by Louvain community detection. Modularity above 0.3 means the grouping reflects real structure rather than noise." />
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
            Clusters of offences that recur together — useful for anticipating what else tends to accompany a case type.
          </p>
          <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
            {communities.map((c, i) => (
              <button
                key={c.community_id}
                onClick={() => setCommunity(String(c.community_id))}
                title={c.description}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${String(c.community_id) === community ? "border-indigo-400 bg-indigo-50/60" : "border-slate-900/8 bg-white/60 hover:bg-white"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="truncate text-xs font-semibold text-slate-800">{c.theme}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-500">{fmt(c.total_cases)}</span>
                </div>
                <div className="mt-1 pl-4 text-[11px] leading-relaxed text-slate-500">{c.description}</div>
                {c.top_districts?.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1 pl-4 text-[10px] text-slate-400">
                    <MapPin size={10} /> {c.top_districts.slice(0, 3).join(" · ")}
                  </div>
                )}
              </button>
            ))}
            {!communities.length && <div className="text-xs text-slate-500">Loading pattern groups…</div>}
          </div>
        </Reveal>
        )}
      </div>

      {/* ---------- full entity table: every entity, sortable ---------- */}
      {showTable && (
        <Reveal className="glass rounded-3xl p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Table2 size={15} className="text-indigo-500" /> All entities
              <InfoDot text="Every entity in the network. Influence (PageRank) measures how central an entity is to the whole crime landscape; connections counts distinct entities it shares cases with; FIRs is its raw case volume." />
              {entityList && <span className="text-[11px] font-normal text-slate-500">{entityList.total} shown</span>}
            </div>
            <div className="neo-inset flex gap-1 rounded-xl p-1">
              {[["pagerank", "Influence"], ["cases", "FIRs"], ["degree", "Connections"], ["node", "A–Z"]].map(([k, label]) => (
                <button key={k} onClick={() => setTableSort(k)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${tableSort === k ? "neo text-indigo-600" : "text-slate-500 hover:text-slate-900"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="sticky top-0 bg-white/90 text-[10px] uppercase tracking-wide text-slate-500 backdrop-blur">
                <tr className="border-b border-slate-900/10">
                  <th className="py-2 pr-3 font-semibold">Entity</th>
                  <th className="py-2 pr-3 font-semibold">Type</th>
                  <th className="py-2 pr-3 text-right font-semibold">FIRs</th>
                  <th className="py-2 pr-3 text-right font-semibold">Connections</th>
                  <th className="py-2 pr-3 font-semibold">Ecosystem</th>
                  <th className="py-2 font-semibold">Most active in</th>
                </tr>
              </thead>
              <tbody>
                {(entityList?.entities || []).map((e) => (
                  <tr key={e.id}
                    onClick={() => setSelected(e.id)}
                    className={`cursor-pointer border-b border-slate-900/5 transition-colors last:border-0 hover:bg-indigo-50/60 ${selected === e.id ? "bg-indigo-50" : ""}`}>
                    <td className="py-2 pr-3 font-medium capitalize text-slate-800">
                      <span className="flex items-center gap-1.5">
                        {e.is_hub && <span className="rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700">HUB</span>}
                        {e.id.toLowerCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{e.node_type === "act" ? "legal act" : "crime type"}</td>
                    <td className="py-2 pr-3 text-right text-slate-600">{fmt(e.cases)}</td>
                    <td className="py-2 pr-3 text-right text-slate-600">{e.degree}</td>
                    <td className="py-2 pr-3 text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: clusterColor(e.community_id) }} />
                        #{e.community_id}
                      </span>
                    </td>
                    <td className="py-2 text-[11px] text-slate-400">{e.top_districts.slice(0, 2).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entitiesQ.isLoading && <div className="py-4 text-center text-xs text-slate-500">Loading entities…</div>}
            {entityList && entityList.entities.length === 0 && (
              <div className="py-4 text-center text-xs text-slate-500">No entity matches those filters.</div>
            )}
          </div>
          {entityList && entityList.total > entityList.entities.length && (
            <div className="mt-2 text-[10px] text-slate-400">
              Showing {entityList.entities.length} of {entityList.total} — refine the search to narrow further.
            </div>
          )}
        </Reveal>
      )}

      {/* Association rules */}
      <Reveal className="glass rounded-3xl p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-500" />
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              Patterns that travel together
              <InfoDot text="Association rules mined from case attributes. 'Lift' is how much more often two things co-occur than chance would predict — lift of 3 means three times more often. These are statistical associations, never causal claims and never about people." />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={ruleSearch}
                onChange={(e) => setRuleSearch(e.target.value)}
                placeholder="Filter patterns…"
                aria-label="Search association rules"
                className="neo-inset w-40 rounded-lg bg-transparent py-1.5 pl-8 pr-2 text-[11px] text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="neo-inset flex gap-1 rounded-xl p-1">
              {[["co_occurrence", "What co-occurs"], ["spatial_affinity", "Where it concentrates"]].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setRuleType(k)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${ruleType === k ? "neo text-indigo-600" : "text-slate-500 hover:text-slate-900"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
          {ruleType === "co_occurrence"
            ? "Offence and legal-section pairs that appear in the same FIR far more often than chance."
            : "Crime types that are disproportionately concentrated in particular districts."}
        </p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rules.slice(0, 18).map((r, i) => (
            <button
              key={`${r.antecedent}-${r.consequent}-${i}`}
              onClick={() => setSelected(r.antecedent)}
              title={`Inspect ${r.antecedent.toLowerCase()}`}
              className="rounded-xl border border-slate-900/10 bg-white/70 p-3 text-left transition-colors hover:border-indigo-400 hover:bg-white"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1 text-xs font-semibold capitalize text-slate-800">
                  <span className="truncate">{r.antecedent.toLowerCase()}</span>
                  <ArrowRight size={11} className="shrink-0 text-slate-400" />
                  <span className="truncate">{r.consequent.toLowerCase()}</span>
                </span>
                <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">{r.lift.toFixed(1)}× lift</span>
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{r.reading}</div>
            </button>
          ))}
          {!rules.length && !rulQ.isLoading && (
            <div className="text-xs text-slate-500">No pattern matches “{ruleSearch}”.</div>
          )}
          {rulQ.isLoading && <div className="text-xs text-slate-500">Loading rules…</div>}
        </div>
      </Reveal>

      <footer className="pt-1 text-center text-[11px] text-slate-500">
        Entity graph (NetworkX + Louvain) &amp; association rules computed offline on real FIR data · associations, not causation.
      </footer>
      </>)}

      {/* ---------------- PERSON NETWORK (synthetic demo) ---------------- */}
      {isPerson && (<>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Reveal delay={0}><KpiCard label="People in demo" value={pnet ? fmt(pnet.counts.persons_total) : "—"} sub="all fabricated" icon={Users} accent="violet" /></Reveal>
          <Reveal delay={70}><KpiCard label="Repeat offenders" value={pnet ? fmt(pnet.counts.repeat_offenders) : "—"} sub="linked to 2+ cases" icon={Fingerprint} accent="rose" /></Reveal>
          <Reveal delay={140}><KpiCard label="Across jurisdictions" value={offenders ? fmt(offenders.cross_jurisdiction) : "—"} sub="offending in 2+ districts" icon={MapPin} accent="saffron" /></Reveal>
          <Reveal delay={210}><KpiCard label="Linkage accuracy" value={linkage ? `${(linkage.validation.pairwise_f1 * 100).toFixed(0)}%` : "—"} sub="PPRL engine F1 (real metric)" icon={FlaskConical} accent="emerald" /></Reveal>
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <Reveal className="glass rounded-3xl lg:col-span-3">
            <div className="flex items-start gap-2 border-b border-slate-900/10 px-4 py-3">
              <Users size={16} className="mt-0.5 text-fuchsia-500" />
              <div>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  Suspect ↔ victim relationship map
                  <InfoDot text="Red nodes are repeat offenders (larger = more cases); blue are single-case accused; teal are victims. Red lines join co-accused in the same case; grey lines join an accused to their victim. All people are synthetic." />
                </div>
                <div className="text-[11px] text-slate-500">Red = repeat offender · red lines = co-accused · grey = accused↔victim</div>
              </div>
            </div>
            <div className="px-2 pt-2">
              {personOption
                ? <ReactECharts option={personOption} style={{ height: 460 }} notMerge />
                : <div className="grid h-[460px] place-items-center text-sm text-slate-500">Loading person network…</div>}
            </div>
          </Reveal>

          <Reveal className="glass rounded-3xl p-4 lg:col-span-2">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Fingerprint size={15} className="text-rose-500" /> Repeat offenders
              <InfoDot text="Each profile links one person to multiple cases with their modus operandi, including offending across district boundaries — the capability the problem statement asks for." />
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
              Individuals linked to multiple cases, with their MO across jurisdictions.
            </p>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {(offenders?.profiles || []).map((p) => (
                <div key={p.person_id} className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-50/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-slate-800">{p.name}</span>
                    <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">{p.n_cases} cases</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{p.mo_summary}</div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                    <MapPin size={10} /> {p.districts.join(" · ")} {p.n_districts > 1 && <span className="font-semibold text-amber-600">· cross-jurisdiction</span>}
                    <span className="ml-auto">{p.years}</span>
                  </div>
                </div>
              ))}
              {!offenders && <div className="text-xs text-slate-500">Loading profiles…</div>}
            </div>
          </Reveal>
        </div>

        {/* The genuinely real artefact on this tab */}
        {linkage && (
          <Reveal className="glass rounded-3xl p-5">
            <div className="mb-1 flex items-center gap-2">
              <FlaskConical size={16} className="text-emerald-500" />
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                The linkage engine is real — only the test data is synthetic
                <InfoDot text="Repeat-offender tracking needs to resolve 'the same person' across cases, because no cross-case person key exists — not even in KSP's own schema. This engine does that probabilistically and exports only salted tokens, so identities never leave the police perimeter." />
              </div>
            </div>
            <p className="mb-3 max-w-4xl text-[12px] leading-relaxed text-slate-600">{linkage.what_this_is}</p>
            <div className="grid gap-2 md:grid-cols-4">
              <div className="neo-inset rounded-xl p-3 text-center">
                <div className="text-lg font-bold text-slate-900">{(linkage.validation.pairwise_precision * 100).toFixed(1)}%</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">precision</div>
              </div>
              <div className="neo-inset rounded-xl p-3 text-center">
                <div className="text-lg font-bold text-slate-900">{(linkage.validation.pairwise_recall * 100).toFixed(1)}%</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">recall</div>
              </div>
              <div className="neo-inset rounded-xl p-3 text-center">
                <div className="text-lg font-bold text-slate-900">{fmt(linkage.records_linked)}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">records linked</div>
              </div>
              <div className="neo-inset rounded-xl p-3 text-center">
                <div className="text-lg font-bold text-slate-900">{linkage.threshold}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">match threshold</div>
              </div>
            </div>
            <div className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-slate-500">
              <p><b className="text-slate-700">Tested against:</b> {linkage.validation.ground_truth}</p>
              <p><b className="text-slate-700">Deployment:</b> {linkage.deployment}</p>
              <p className="rounded-lg bg-slate-900/[0.03] px-3 py-2">{linkage.validation.honesty}</p>
            </div>
          </Reveal>
        )}

        <footer className="pt-1 text-center text-[11px] text-slate-500">
          Synthetic person layer · volumes mirror real district × crime-type distributions · never used to train or validate any model.
        </footer>
      </>)}
    </div>
  );
}
