// Labels a panel's data provenance so real / modeled / synthetic are never confused.
const STYLES = {
  real: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  modeled: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  synthetic: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300",
};
const DOT = { real: "bg-emerald-400", modeled: "bg-amber-400", synthetic: "bg-fuchsia-400" };
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
