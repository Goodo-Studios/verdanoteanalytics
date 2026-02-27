import { cn } from "@/lib/utils";

interface TagSourceBadgeProps {
  source: string;
  className?: string;
}

const sourceConfig: Record<string, { label: string; className: string }> = {
  parsed: { label: "Parsed", className: "bg-tag-parsed/15 text-tag-parsed border-tag-parsed/30" },
  csv_match: { label: "CSV Match", className: "bg-tag-csv/15 text-tag-csv border-tag-csv/30" },
  manual: { label: "Manual", className: "bg-tag-manual/15 text-tag-manual border-tag-manual/30" },
  inferred: { label: "Inferred", className: "bg-verdant/15 text-verdant border-verdant/30" },
  untagged: { label: "Untagged", className: "bg-cream-dark text-slate border-cream-dark" },
};

export function TagSourceBadge({ source, className }: TagSourceBadgeProps) {
  const config = sourceConfig[source] || sourceConfig.untagged;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[4px] border px-2 py-0.5 font-label text-[10px] font-semibold tracking-wide",
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
