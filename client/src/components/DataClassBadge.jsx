// Labels a panel's data provenance so real / modeled / synthetic are never confused.
const STYLES = {
  real: "border-emerald-500/30 bg-emerald-50 text-emerald-700",
  modeled: "border-amber-500/30 bg-amber-50 text-amber-700",
  synthetic: "border-fuchsia-500/30 bg-fuchsia-50 text-fuchsia-700",
};
const DOT = { real: "bg-emerald-500", modeled: "bg-amber-500", synthetic: "bg-fuchsia-500" };
const LABELS = { real: "Real data", modeled: "Modeled · estimated", synthetic: "Synthetic · demo" };

export default function DataClassBadge({ kind = "real", title }) {
  return (
    <span
      title={title || LABELS[kind]}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STYLES[kind] || STYLES.real}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[kind] || DOT.real}`} />
      {LABELS[kind] || kind}
    </span>
  );
}
