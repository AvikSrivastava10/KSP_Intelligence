import { Info } from "lucide-react";

// Small hover-explained info marker for defining a term inline (native tooltip; no click needed).
export default function InfoDot({ text, className = "" }) {
  return (
    <span title={text} className={`inline-flex cursor-help align-middle text-slate-400 hover:text-indigo-500 ${className}`}>
      <Info size={13} />
    </span>
  );
}
