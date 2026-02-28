import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computeFatigueForecast, type FatigueForecast } from "@/lib/fatigueForecast";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bell, TrendingUp } from "lucide-react";
import { toast } from "sonner";

interface Props {
  adId: string;
  adName: string;
  accountId: string;
}

/* ── Sparkline ─────────────────────────────────────── */

function ForecastSparkline({ forecast }: { forecast: FatigueForecast }) {
  const all = [...forecast.historical, ...forecast.projected];
  const maxScore = 100;
  const w = 280;
  const h = 64;
  const pad = 2;

  const xScale = (i: number) => pad + (i / (all.length - 1)) * (w - pad * 2);
  const yScale = (v: number) => h - pad - (v / maxScore) * (h - pad * 2);

  const histLen = forecast.historical.length;

  // Historical path (solid)
  const histPoints = forecast.historical.map((p, i) => `${xScale(i)},${yScale(p.score)}`).join(" ");
  // Projected path (dashed) — starts from last historical point
  const projPoints = [
    `${xScale(histLen - 1)},${yScale(forecast.historical[histLen - 1].score)}`,
    ...forecast.projected.map((p, i) => `${xScale(histLen + i)},${yScale(p.score)}`),
  ].join(" ");

  // Threshold lines
  const y60 = yScale(60);
  const y80 = yScale(80);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
      {/* Warning threshold */}
      <line x1={pad} y1={y60} x2={w - pad} y2={y60} stroke="hsl(var(--warning, 45 93% 47%))" strokeWidth="0.5" strokeDasharray="3 3" opacity={0.5} />
      {/* Critical threshold */}
      <line x1={pad} y1={y80} x2={w - pad} y2={y80} stroke="hsl(var(--destructive))" strokeWidth="0.5" strokeDasharray="3 3" opacity={0.5} />
      {/* Historical (solid) */}
      <polyline points={histPoints} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Projected (dotted) */}
      <polyline points={projPoints} fill="none" stroke="hsl(var(--destructive))" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 3" opacity={0.7} />
    </svg>
  );
}

/* ── Main Component ────────────────────────────────── */

export function FatigueForecastSection({ adId, adName, accountId }: Props) {
  const { user } = useAuth();
  const [reminderDays, setReminderDays] = useState("7");
  const [settingReminder, setSettingReminder] = useState(false);

  // Fetch last 14 days of daily metrics for this creative
  const { data: forecast, isLoading } = useQuery({
    queryKey: ["fatigue-forecast", adId],
    queryFn: async () => {
      const today = new Date();
      const from = new Date(today);
      from.setDate(from.getDate() - 14);
      const fromStr = from.toISOString().split("T")[0];

      const { data } = await supabase
        .from("creative_daily_metrics")
        .select("date, spend, frequency, ctr, roas")
        .eq("ad_id", adId)
        .gte("date", fromStr)
        .order("date", { ascending: true });

      return computeFatigueForecast(data || []);
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleSetReminder = async () => {
    if (!user) return;
    const days = parseInt(reminderDays, 10);
    if (isNaN(days) || days < 1) { toast.error("Enter a valid number of days"); return; }

    setSettingReminder(true);
    try {
      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + days);

      const { error } = await supabase.from("notifications").insert({
        user_id: user.id,
        account_id: accountId,
        type: "info",
        title: `Check fatigue: ${adName}`,
        body: `Reminder to review fatigue status for "${adName}" (set ${days} days ago).`,
        created_at: scheduledDate.toISOString(),
        read: false,
      });

      if (error) throw error;
      toast.success(`Reminder set for ${days} days from now`);
    } catch (err: any) {
      toast.error("Failed to set reminder");
    } finally {
      setSettingReminder(false);
    }
  };

  if (isLoading) {
    return (
      <div className="px-1 py-2">
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!forecast) return null;

  return (
    <div className="space-y-3 px-1">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
        <span className="font-label text-[11px] font-semibold uppercase tracking-wider text-foreground">
          Fatigue Forecast
        </span>
      </div>

      {/* Sparkline */}
      <div className="rounded-lg border border-border-light bg-muted/30 p-3">
        <ForecastSparkline forecast={forecast} />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-data">
          <span>{forecast.historical[0]?.date}</span>
          <span className="text-muted-foreground/50">— projected →</span>
          <span>{forecast.projected[forecast.projected.length - 1]?.date}</span>
        </div>
      </div>

      {/* Status messaging */}
      {forecast.status === "already_critical" && (
        <p className="font-body text-[12px] text-destructive font-medium">
          🔴 Already in critical zone ({forecast.currentScore}/100). Strongly recommend rotating this creative immediately.
        </p>
      )}
      {forecast.status === "already_warning" && (
        <div className="space-y-1">
          <p className="font-body text-[12px] text-amber-600 font-medium">
            ⚠️ Already in warning zone ({forecast.currentScore}/100). Recommend preparing an iteration now.
          </p>
          {forecast.daysToCritical !== null && (
            <p className="font-body text-[12px] text-muted-foreground">
              🔴 Critical threshold (80): estimated <span className="font-semibold text-destructive">{forecast.daysToCritical} days</span>
            </p>
          )}
        </div>
      )}
      {forecast.status === "stable" && (
        <p className="font-body text-[12px] text-muted-foreground">
          ✅ Fatigue is stable — no immediate concern.
        </p>
      )}
      {forecast.status === "rising" && (
        <div className="space-y-1">
          <p className="font-body text-[12px] text-foreground font-medium">At current trajectory:</p>
          {forecast.daysToWarning !== null && (
            <p className="font-body text-[12px] text-muted-foreground">
              ⚠️ Warning threshold (60): estimated <span className="font-semibold text-amber-600">{forecast.daysToWarning} days</span>
            </p>
          )}
          {forecast.daysToCritical !== null && (
            <p className="font-body text-[12px] text-muted-foreground">
              🔴 Critical threshold (80): estimated <span className="font-semibold text-destructive">{forecast.daysToCritical} days</span>
            </p>
          )}
        </div>
      )}

      {/* Set Reminder */}
      <div className="flex items-center gap-2 pt-1">
        <Bell className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="font-body text-[11px] text-muted-foreground whitespace-nowrap">Remind me in</span>
        <Input
          type="number"
          min={1}
          max={90}
          value={reminderDays}
          onChange={(e) => setReminderDays(e.target.value)}
          className="w-16 h-7 text-[12px] font-data"
        />
        <span className="font-body text-[11px] text-muted-foreground whitespace-nowrap">days</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] font-body gap-1"
          onClick={handleSetReminder}
          disabled={settingReminder}
        >
          Set Reminder
        </Button>
      </div>
    </div>
  );
}
