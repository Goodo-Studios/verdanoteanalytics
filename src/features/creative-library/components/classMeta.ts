import type { CreativeClass } from "../hooks/useCreativeLibrary";

/** Visual style + labels for each F6 class. Shared by the badge + page chips. */
export const CLASS_META: Record<
  CreativeClass,
  { label: string; short: string; badge: string; chip: string; icon: string }
> = {
  winner: {
    label: "Winner",
    short: "Winners",
    badge: "bg-emerald-600 text-white",
    chip: "data-[active=true]:bg-emerald-600 data-[active=true]:text-white",
    icon: "🏆",
  },
  rising: {
    label: "Rising Star",
    short: "Rising Stars",
    badge: "bg-sky-500 text-white",
    chip: "data-[active=true]:bg-sky-500 data-[active=true]:text-white",
    icon: "🌟",
  },
  fatiguing: {
    label: "Fatiguing",
    short: "Fatiguing",
    badge: "bg-amber-500 text-amber-950",
    chip: "data-[active=true]:bg-amber-500 data-[active=true]:text-amber-950",
    icon: "🔥",
  },
  neutral: {
    label: "Steady",
    short: "Steady",
    badge: "bg-muted text-muted-foreground",
    chip: "data-[active=true]:bg-charcoal data-[active=true]:text-white",
    icon: "•",
  },
};
