// Accent maps use literal class strings so Tailwind's JIT keeps them.
const ACCENT = {
  gold: "text-white",
  saffron: "text-zinc-200",
  sky: "text-zinc-100",
  emerald: "text-zinc-100",
  violet: "text-zinc-200",
  rose: "text-zinc-200",
};

export default function KpiCard({ label, value, sub, icon: Icon, accent = "sky" }) {
  const text = ACCENT[accent] || ACCENT.sky;
  return (
    <div className="glass glass-hover rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
        {Icon && (
          <span className={`neo grid h-9 w-9 shrink-0 place-items-center rounded-xl ${text}`}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <div className={`mt-3 text-3xl font-bold tracking-tight ${text}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
