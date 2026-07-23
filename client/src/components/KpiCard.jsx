// Colored icon chips (the "colours" live in graphs + accents); the value stays black text.
const ACCENT = {
  gold: "bg-amber-100 text-amber-600",
  saffron: "bg-orange-100 text-orange-600",
  sky: "bg-sky-100 text-sky-600",
  emerald: "bg-emerald-100 text-emerald-600",
  violet: "bg-violet-100 text-violet-600",
  rose: "bg-rose-100 text-rose-600",
};

export default function KpiCard({ label, value, sub, icon: Icon, accent = "sky" }) {
  const chip = ACCENT[accent] || ACCENT.sky;
  return (
    <div className="glass glass-hover rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        {Icon && (
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${chip}`}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
