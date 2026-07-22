import { NavLink } from "react-router-dom";
import { LayoutDashboard, Map, TrendingUp, ShieldAlert, Network, Clock } from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { to: "/hotspots", label: "Hotspot Map", icon: Map, enabled: false },
  { to: "/trends", label: "Trends & Forecast", icon: TrendingUp, enabled: false },
  { to: "/risk", label: "Risk & Vulnerability", icon: ShieldAlert, enabled: false },
  { to: "/network", label: "Network & Link", icon: Network, enabled: false },
  { to: "/timeofday", label: "Time-of-day", icon: Clock, enabled: false },
];

export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="hidden w-60 shrink-0 border-r border-slate-800 bg-slate-900/40 p-4 md:block">
        <div className="mb-6">
          <div className="text-sm font-semibold">KSP Crime Intelligence</div>
          <div className="text-xs text-slate-400">SCRB · Karnataka</div>
        </div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  n.enabled
                    ? isActive
                      ? "bg-sky-500/15 text-sky-300"
                      : "text-slate-300 hover:bg-slate-800/60"
                    : "pointer-events-none text-slate-600"
                }`
              }
            >
              <n.icon size={16} />
              <span>{n.label}</span>
              {!n.enabled && <span className="ml-auto text-[10px] text-slate-600">soon</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-8 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-[11px] leading-relaxed text-slate-400">
          Phase 1 ships the Dashboard. Later phases add hotspots, forecasts, risk, and network analysis.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
          <div className="text-sm text-slate-400">Crime Intelligence &amp; Analytical Platform</div>
          <div className="text-xs text-slate-500">Hack2Skill Datathon 2026 · Phase 1</div>
        </header>
        <main className="min-w-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
