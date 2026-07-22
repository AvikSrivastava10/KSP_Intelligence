// Labels a panel's data provenance so real / modeled / synthetic are never confused.
const STYLES = {
  real: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  modeled: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  synthetic: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
};
const LABELS = {
  real: "Real data",
  modeled: "Modeled — estimated",
  synthetic: "Synthetic — demo",
};

export default function DataClassBadge({ kind = "real", title }) {
  const style = STYLES[kind] || STYLES.real;
  return (
    <span
      title={title || LABELS[kind]}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style}`}
    >
      {LABELS[kind] || kind}
    </span>
  );
}
