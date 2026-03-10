import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionHeader({ icon, label, count }: { icon: React.ReactNode; label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-5 pt-3 pb-1.5">
      <span className="text-white/20">{icon}</span>
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">{label}</span>
      {count != null && (
        <span className="font-data text-[10px] text-white/15 ml-auto">{count} total</span>
      )}
    </div>
  );
}

export function CommandRow({ index, active, icon, label, subtitle, onSelect, onHover }: {
  index: number; active: boolean; icon: React.ReactNode; label: string; subtitle?: string; onSelect: () => void; onHover: () => void;
}) {
  return (
    <button
      data-index={index}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(
        "w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors duration-75",
        active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      )}
    >
      <span className={cn("transition-colors", active ? "text-emerald-400" : "text-white/25")}>{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="font-body text-[13px] text-white/90">{label}</span>
        {subtitle && <span className="font-body text-[11px] text-white/30 ml-2">{subtitle}</span>}
      </div>
      {active && <ChevronRight className="h-3 w-3 text-white/15 flex-shrink-0" />}
    </button>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="px-5 py-10 text-center font-body text-[13px] text-white/25">{text}</div>
  );
}

export function FooterHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-data text-[10px] text-white/20">
      {keys.map(k => (
        <kbd key={k} className="px-1.5 py-0.5 rounded border border-white/[0.08] bg-white/[0.04] text-[9px] text-white/30 min-w-[18px] text-center">{k}</kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}

export function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-emerald-400/20 text-emerald-300 rounded-sm px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
