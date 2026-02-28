import { useMemo, useState } from "react";
import { useClientHealthScore, getHealthTier, getHealthLabel, type ClientHealthBreakdown } from "@/hooks/useClientHealthScore";
import { useUpdateAccountSettings } from "@/hooks/useAccountsApi";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  account: any;
}

const RESPONSIVENESS_OPTIONS = [
  { value: "excellent", label: "Excellent", desc: "Responds within 24h, proactive" },
  { value: "good", label: "Good", desc: "Responds within 48h" },
  { value: "slow", label: "Slow", desc: "Takes 3-5 days to respond" },
  { value: "blocked", label: "Blocked", desc: "Unresponsive, stalling progress" },
];

function GaugeRing({ score, size = 120 }: { score: number; size?: number }) {
  const tier = getHealthTier(score);
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const dashOffset = circumference - progress;

  const arcColor = tier === "green" ? "stroke-verdant" : tier === "amber" ? "stroke-gold" : "stroke-destructive";
  const textColor = tier === "green" ? "text-verdant" : tier === "amber" ? "text-gold" : "text-destructive";

  return (
    <div className="relative flex flex-col items-center gap-1" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-muted" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className={arcColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset} style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("font-data text-[28px] font-bold tabular-nums", textColor)}>{score}</span>
        <span className={cn("font-label text-[9px] font-semibold uppercase tracking-wider", textColor)}>{getHealthLabel(tier)}</span>
      </div>
    </div>
  );
}

function BreakdownBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <span className="font-body text-[12px] text-slate">{label}</span>
        <span className="font-data text-[12px] font-medium tabular-nums text-charcoal">{score}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-cream-dark overflow-hidden">
        <div className="h-full bg-verdant rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ClientHealthSection({ account }: Props) {
  const breakdown = useClientHealthScore(account);
  const updateAccount = useUpdateAccountSettings();

  const [responsiveness, setResponsiveness] = useState(account?.client_responsiveness || "good");
  const [startDate, setStartDate] = useState(account?.client_start_date || "");

  const handleSave = () => {
    updateAccount.mutate({
      id: account.id,
      client_responsiveness: responsiveness,
      client_start_date: startDate || null,
    }, {
      onSuccess: () => toast.success("Client health settings saved"),
    });
  };

  return (
    <section className="glass-panel p-6 space-y-5">
      <h2 className="font-heading text-[20px] text-forest">Client Health</h2>
      <p className="font-body text-[12px] text-slate">Internal-only relationship health score. Not visible to clients.</p>

      <div className="flex gap-8 items-start flex-wrap">
        {/* Gauge */}
        <GaugeRing score={breakdown.total} />

        {/* Breakdown */}
        <div className="flex-1 min-w-[240px] space-y-3">
          <BreakdownBar label="Performance Trajectory" score={breakdown.performanceTrajectory} max={20} />
          <BreakdownBar label="Creative Velocity" score={breakdown.creativeVelocity} max={20} />
          <BreakdownBar label="Client Responsiveness" score={breakdown.clientResponsiveness} max={20} />
          <BreakdownBar label="Relationship Length" score={breakdown.relationshipLength} max={20} />
          <BreakdownBar label="Growth Signal" score={breakdown.growthSignal} max={20} />
        </div>
      </div>

      {/* Manual inputs */}
      <div className="border-t border-border-light pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="font-label text-[11px] uppercase tracking-wide text-slate">Client Responsiveness</Label>
          <Select value={responsiveness} onValueChange={setResponsiveness}>
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESPONSIVENESS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-muted-foreground ml-1.5 text-[11px]">— {opt.desc}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="font-label text-[11px] uppercase tracking-wide text-slate">Client Start Date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-[13px]" />
        </div>
      </div>

      <Button size="sm" onClick={handleSave} disabled={updateAccount.isPending} className="bg-verdant hover:bg-verdant/90 text-white">
        Save Health Settings
      </Button>
    </section>
  );
}
