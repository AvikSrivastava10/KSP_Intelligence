import { NavLink } from "react-router-dom";
import { LayoutDashboard, Map, TrendingUp, ShieldAlert, Network, Clock, ShieldCheck } from "lucide-react";

const asset = (p) => `${import.meta.env.BASE_URL}${p}`;

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { to: "/hotspots", label: "Hotspot Map", icon: Map, enabled: false },
  { to: "/trends", label: "Trends & Forecast", icon: TrendingUp, enabled: false },
  { to: "/risk", label: "Risk & Vulnerability", icon: ShieldAlert, enabled: false },
  { to: "/network", label: "Network & Link", icon: Network, enabled: false },
  { to: "/timeofday", label: "Time-of-day", icon: Clock, enabled: false },
];

function Emblem({ size = "h-10 w-10" }) {
  return (
    <div className={`emblem-chip grid ${size} shrink-0 place-items-center rounded-2xl p-1`}>
      <img src={asset("ksp-logo.png")} alt="Karnataka State Police emblem" className="h-full w-full object-contain" />
    </div>
  );
}

export default function Layout({ children }) {
  return (
    <div className="relative flex min-h-screen text-slate-100">
      {/* Faint KSP marching backdrop */}
      <div className="app-bg" style={{ backgroundImage: `url(${asset("ksp-marching.jpg")})` }} aria-hidden="true" />
      <div className="app-scrim" aria-hidden="true" />

      {/* Sidebar */}
      <aside className="glass-strong sticky top-0 hidden h-screen w-64 shrink-0 flex-col p-4 md:flex">
        <div className="flex items-center gap-3 px-1 py-2">
          <Emblem />
          <div className="leading-tight">
            <div className="text-[13px] font-bold tracking-wide text-white">Karnataka State Police</div>
            <div className="text-[11px] text-ksp-gold/80">Crime Intelligence · SCRB</div>
          </div>
        </div>

        <div className="my-4 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
        <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Workspaces</div>

        <nav className="space-y-1.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end
              className={({ isActive }) =>
                [
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-300",
                  n.enabled
                    ? isActive
                      ? "neo text-ksp-gold shadow-glow"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                    : "pointer-events-none text-slate-600",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={[
                      "grid h-8 w-8 place-items-center rounded-lg transition-colors",
                      n.enabled && isActive ? "bg-ksp-saffron/15 text-ksp-gold" : "bg-white/5 text-slate-400 group-hover:text-white",
                    ].join(" ")}
                  >
                    <n.icon size={16} />
                  </span>
                  <span className="flex-1">{n.label}</span>
                  {!n.enabled && <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-500">soon</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto">
          <div className="glass rounded-2xl p-3 text-[11px] leading-relaxed text-slate-400">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-200">
              <ShieldCheck size={13} className="text-emerald-400" /> Phase 1 · live
            </div>
            Statewide dashboard on real FIR data. Hotspots, forecasts, risk & network land in later phases.
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="glass sticky top-0 z-20 flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="md:hidden">
              <Emblem size="h-9 w-9" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Crime Intelligence &amp; Analytical Platform</div>
              <div className="text-[11px] text-slate-400">Karnataka State Crime Records Bureau</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 sm:inline-flex">
              <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-emerald-400" /> Live
            </span>
            <span className="hidden text-[11px] text-slate-500 md:inline">Hack2Skill Datathon 2026</span>
            <div className="md:hidden">
              <span className="text-[11px] text-slate-400">SCRB</span>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
