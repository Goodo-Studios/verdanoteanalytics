import { ArrowRight, Zap, TrendingUp, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface NextStepsPanelProps {
  winRate: number;
  targetRoas?: number;
  avgRoas: number;
  /** Names of creatives with high frequency / fatigue signals */
  fatiguingCreatives: string[];
}

interface NextStep {
  icon: React.ReactNode;
  text: string;
  tone: "positive" | "neutral" | "action";
}

export function NextStepsPanel({ winRate, targetRoas, avgRoas, fatiguingCreatives }: NextStepsPanelProps) {
  const steps: NextStep[] = [];

  // ROAS above target
  if (targetRoas && targetRoas > 0 && avgRoas >= targetRoas) {
    steps.push({
      icon: <TrendingUp className="h-4 w-4" />,
      text: "Your ads are performing above benchmark — we're increasing budget on your top performers.",
      tone: "positive",
    });
  }

  // Low win rate
  if (winRate < 30) {
    steps.push({
      icon: <Zap className="h-4 w-4" />,
      text: "Your team is testing new creative concepts this cycle to improve performance.",
      tone: "action",
    });
  }

  // Fatiguing creatives
  if (fatiguingCreatives.length > 0) {
    const name = fatiguingCreatives[0];
    steps.push({
      icon: <RefreshCw className="h-4 w-4" />,
      text: `We're preparing fresh iterations of "${name}" to keep results strong.`,
      tone: "action",
    });
  }

  // ROAS below target fallback
  if (targetRoas && targetRoas > 0 && avgRoas < targetRoas && steps.length < 3) {
    steps.push({
      icon: <ArrowRight className="h-4 w-4" />,
      text: "We're optimizing your creative mix to move closer to your ROAS target.",
      tone: "neutral",
    });
  }

  // Always-on encouragement if we have room
  if (steps.length < 2) {
    steps.push({
      icon: <ArrowRight className="h-4 w-4" />,
      text: "Your creative team is reviewing performance data and planning next iterations.",
      tone: "neutral",
    });
  }

  const toneColors: Record<string, string> = {
    positive: "bg-primary/10 text-primary",
    action: "bg-warning/10 text-warning",
    neutral: "bg-muted text-muted-foreground",
  };

  return (
    <div className="glass-panel p-6">
      <h3 className="font-heading text-[18px] text-foreground mb-4">What's Next</h3>
      <div className="space-y-3">
        {steps.slice(0, 3).map((step, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className={cn("shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center", toneColors[step.tone])}>
              {step.icon}
            </div>
            <p className="font-body text-[14px] text-foreground leading-relaxed pt-1">
              {step.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
