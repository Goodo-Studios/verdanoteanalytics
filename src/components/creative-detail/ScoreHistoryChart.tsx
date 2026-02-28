import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from "recharts";
import { useScoreHistory, type ScoreHistoryPoint } from "@/hooks/useScoreHistory";
import { format } from "date-fns";
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface ScoreHistoryChartProps {
  adId: string;
}

export function ScoreHistoryChart({ adId }: ScoreHistoryChartProps) {
  const { data: history, isLoading } = useScoreHistory(adId, 30);

  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];
    return history.map((p) => ({
      date: format(new Date(p.recorded_at), "MMM d"),
      fullDate: format(new Date(p.recorded_at), "MMM d, yyyy"),
      score: p.score,
      roas: p.roas_component,
      ctr: p.ctr_component,
      hookRate: p.hook_rate_component,
      spendEff: p.spend_efficiency_component,
      momentum: p.momentum_component,
      fatigue: p.fatigue_component,
    }));
  }, [history]);

  const weeklyChange = useMemo(() => {
    if (!history || history.length < 2) return null;
    const latest = history[history.length - 1];
    // Find the point closest to 7 days ago
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let prior: ScoreHistoryPoint | null = null;
    for (const p of history) {
      if (new Date(p.recorded_at).getTime() <= sevenDaysAgo) {
        prior = p;
      }
    }
    if (!prior) prior = history[0];

    const delta = latest.score - prior.score;
    const components = [
      { label: "ROAS", delta: (latest.roas_component ?? 0) - (prior.roas_component ?? 0) },
      { label: "CTR", delta: (latest.ctr_component ?? 0) - (prior.ctr_component ?? 0) },
      { label: "Hook Rate", delta: (latest.hook_rate_component ?? 0) - (prior.hook_rate_component ?? 0) },
      { label: "Spend Efficiency", delta: (latest.spend_efficiency_component ?? 0) - (prior.spend_efficiency_component ?? 0) },
      { label: "Momentum", delta: (latest.momentum_component ?? 0) - (prior.momentum_component ?? 0) },
      { label: "Fatigue", delta: (latest.fatigue_component ?? 0) - (prior.fatigue_component ?? 0) },
    ].filter((c) => c.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    return { delta, components };
  }, [history]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="font-body text-[12px] text-muted-foreground">No score history recorded yet.</p>
        <p className="font-body text-[11px] text-muted-foreground mt-1">Scores are captured during each sync.</p>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    // Find the biggest component change
    const components = [
      { label: "ROAS", value: d.roas },
      { label: "CTR", value: d.ctr },
      { label: "Hook Rate", value: d.hookRate },
      { label: "Spend Eff.", value: d.spendEff },
      { label: "Momentum", value: d.momentum },
      { label: "Fatigue", value: d.fatigue },
    ].filter((c) => c.value !== null);
    const biggest = components.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    return (
      <div className="rounded-md border border-border bg-card p-2.5 shadow-md text-[11px] font-body">
        <div className="font-semibold text-foreground">{d.fullDate}</div>
        <div className="font-data text-[14px] font-bold text-foreground mt-0.5">Score: {d.score}</div>
        {biggest && (
          <div className="text-muted-foreground mt-1">Top driver: {biggest.label} ({biggest.value})</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Score History (30 days)
        </p>
      </div>

      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
            {/* Color zones */}
            <ReferenceArea y1={75} y2={100} fill="hsl(var(--success) / 0.08)" />
            <ReferenceArea y1={50} y2={75} fill="hsl(45 93% 47% / 0.06)" />
            <ReferenceArea y1={0} y2={50} fill="hsl(var(--destructive) / 0.05)" />
            <ReferenceLine y={75} stroke="hsl(var(--success) / 0.3)" strokeDasharray="3 3" />
            <ReferenceLine y={50} stroke="hsl(45 93% 47% / 0.3)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={30}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="score"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 3, fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 2 }}
              activeDot={{ r: 5, fill: "hsl(var(--primary))" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Weekly change summary */}
      {weeklyChange && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            {weeklyChange.delta > 0 ? (
              <TrendingUp className="h-4 w-4 text-success" />
            ) : weeklyChange.delta < 0 ? (
              <TrendingDown className="h-4 w-4 text-destructive" />
            ) : (
              <Minus className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-body text-[13px] font-semibold text-foreground">
              Score change this week: {weeklyChange.delta > 0 ? "+" : ""}{weeklyChange.delta} points
            </span>
          </div>
          {weeklyChange.components.length > 0 && (
            <p className="font-body text-[11px] text-muted-foreground">
              {weeklyChange.components.map((c, i) => (
                <span key={c.label}>
                  {i > 0 ? ", " : ""}{c.label}{" "}
                  <span className={c.delta > 0 ? "text-success" : "text-destructive"}>
                    {c.delta > 0 ? "+" : ""}{c.delta}
                  </span>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
