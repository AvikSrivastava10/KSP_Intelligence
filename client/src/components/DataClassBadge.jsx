// Labels a panel's data provenance so real / modeled / synthetic are never confused.
const STYLES = {
  real: "border-white/30 bg-white/12 text-white",
  modeled: "border-white/18 bg-white/5 text-zinc-300",
  synthetic: "border-white/12 bg-white/5 text-zinc-400",
};
const DOT = { real: "bg-white", modeled: "bg-zinc-400", synthetic: "bg-zinc-500" };
const LABELS = { real: "Real data", modeled: "Modeled · estimated", synthetic: "Synthetic · demo" };

export default function DataClassBadge({ kind = "real", title }) {
  return (
    <span
      title={title || LABELS[kind]}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur ${STYLES[kind] || STYLES.real}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[kind] || DOT.real}`} />
      {LABELS[kind] || kind}
    </span>
  );
}
