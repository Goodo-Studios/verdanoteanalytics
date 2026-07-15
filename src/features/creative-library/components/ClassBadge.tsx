import type { CreativeClass } from "../hooks/useCreativeLibrary";
import { CLASS_META } from "./classMeta";

export function ClassBadge({ klass }: { klass: CreativeClass }) {
  const m = CLASS_META[klass];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-label text-[9px] font-semibold uppercase tracking-wide ${m.badge}`}
      title={m.label}
    >
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}
