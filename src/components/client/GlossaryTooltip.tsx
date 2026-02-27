import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const GLOSSARY: Record<string, string | ((v?: number) => string)> = {
  "Total Spend": "The total amount of money spent on your ads during this period.",
  "ROAS": (v?: number) =>
    v != null
      ? `For every $1 spent on ads, you made $${v.toFixed(2)} in revenue.`
      : "Return on ad spend — how much revenue each ad dollar generates.",
  "CPA": "How much it costs to get one customer.",
  "CTR": "What % of people who saw this ad clicked on it.",
  "Total Purchases": "The number of purchases driven by your ads.",
  "Hook Rate": "What % of people watched past the first 3 seconds.",
  "Hold Rate": "What % of viewers kept watching after the hook.",
  "Win Rate": "The percentage of your ads that hit your performance targets.",
};

interface GlossaryTooltipProps {
  metric: string;
  value?: number;
}

export function GlossaryTooltip({ metric, value }: GlossaryTooltipProps) {
  const definition = GLOSSARY[metric];
  if (!definition) return null;

  const text = typeof definition === "function" ? definition(value) : definition;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="inline-flex items-center justify-center p-0 ml-1 opacity-40 hover:opacity-70 transition-opacity">
            <HelpCircle className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-[12px] leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
