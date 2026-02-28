import { cn } from "@/lib/utils";

interface PlatformBadgeProps {
  platform?: string;
  className?: string;
}

export function PlatformBadge({ platform = "meta", className }: PlatformBadgeProps) {
  if (platform === "meta") {
    return (
      <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] bg-blue-600/90 text-white", className)}>
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="currentColor">
          <path d="M12 2.04C6.5 2.04 2 6.53 2 12.06C2 17.06 5.66 21.21 10.44 21.96V14.96H7.9V12.06H10.44V9.85C10.44 7.34 11.93 5.96 14.22 5.96C15.31 5.96 16.45 6.15 16.45 6.15V8.62H15.19C13.95 8.62 13.56 9.39 13.56 10.18V12.06H16.34L15.89 14.96H13.56V21.96A10 10 0 0 0 22 12.06C22 6.53 17.5 2.04 12 2.04Z" />
        </svg>
        <span className="font-label text-[8px] font-semibold uppercase tracking-wide">Meta</span>
      </span>
    );
  }

  if (platform === "tiktok") {
    return (
      <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] bg-charcoal/90 text-white", className)}>
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="currentColor">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V9.05a8.16 8.16 0 0 0 4.76 1.52V7.12a4.83 4.83 0 0 1-1-.43Z" />
        </svg>
        <span className="font-label text-[8px] font-semibold uppercase tracking-wide">TikTok</span>
      </span>
    );
  }

  return null;
}
