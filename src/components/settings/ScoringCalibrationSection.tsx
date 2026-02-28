import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, RotateCcw, Scale, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { computeCreativeScore, type ScoringConfig, DEFAULT_SCORING_CONFIG } from "@/lib/creativeScore";
import { cn } from "@/lib/utils";

interface Props {
  account: any;
  creatives?: any[];
}

function useScoringConfig(accountId: string) {
  return useQuery({
    queryKey: ["scoring-config", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_context")
        .select("scoring_config")
        .eq("account_id", accountId)
        .maybeSingle();
      if (error) throw error;
      return (data?.scoring_config as unknown as ScoringConfig) || { ...DEFAULT_SCORING_CONFIG };
    },
    enabled: !!accountId,
  });
}

interface WeightSliderProps {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}

function WeightSlider({ label, value, max, onChange }: WeightSliderProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="font-body text-[13px] font-medium text-charcoal">{label}</Label>
        <span className="font-data text-[14px] font-semibold text-forest tabular-nums">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-verdant"
      />
    </div>
  );
}

export function ScoringCalibrationSection({ account, creatives = [] }: Props) {
  const { data: savedConfig, isLoading } = useScoringConfig(account.id);
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<ScoringConfig>({ ...DEFAULT_SCORING_CONFIG });
  const [initialized, setInitialized] = useState<string | null>(null);

  useEffect(() => {
    if (savedConfig && initialized !== account.id) {
      setConfig({ ...DEFAULT_SCORING_CONFIG, ...savedConfig });
      setInitialized(account.id);
    } else if (!savedConfig && !isLoading && initialized !== account.id) {
      setConfig({ ...DEFAULT_SCORING_CONFIG });
      setInitialized(account.id);
    }
  }, [savedConfig, isLoading, account.id, initialized]);

  const save = useMutation({
    mutationFn: async (cfg: ScoringConfig) => {
      const { error } = await supabase
        .from("account_context")
        .upsert(
          { account_id: account.id, scoring_config: cfg as any, updated_at: new Date().toISOString() },
          { onConflict: "account_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scoring-config", account.id] });
      toast.success("Scoring config saved");
    },
    onError: (e: any) => toast.error("Error saving scoring config", { description: e.message }),
  });

  const weightTotal = config.roas_weight + config.ctr_weight + config.hook_rate_weight
    + config.spend_efficiency_weight + config.momentum_weight + config.fatigue_weight;

  const isValid = weightTotal === 100;

  const updateWeight = useCallback((key: keyof ScoringConfig, val: number) => {
    setConfig((prev) => ({ ...prev, [key]: val }));
  }, []);

  const normalize = useCallback(() => {
    const keys: (keyof ScoringConfig)[] = ["roas_weight", "ctr_weight", "hook_rate_weight", "spend_efficiency_weight", "momentum_weight", "fatigue_weight"];
    const total = keys.reduce((s, k) => s + (config[k] as number), 0);
    if (total === 0) return;
    const factor = 100 / total;
    const newConfig = { ...config };
    let remaining = 100;
    keys.forEach((k, i) => {
      if (i === keys.length - 1) {
        (newConfig as any)[k] = remaining;
      } else {
        const v = Math.round((config[k] as number) * factor);
        (newConfig as any)[k] = v;
        remaining -= v;
      }
    });
    setConfig(newConfig);
  }, [config]);

  const resetToDefaults = useCallback(() => {
    setConfig({ ...DEFAULT_SCORING_CONFIG });
  }, []);

  // Live preview: top 5 creatives scored with old vs new weights
  const preview = useMemo(() => {
    if (creatives.length === 0) return [];
    const withSpend = creatives.filter((c: any) => (Number(c.spend) || 0) >= (config.min_spend || 0));
    const top = withSpend.slice(0, 20);

    const beforeScores = top.map((c: any) => ({
      ad_id: c.ad_id,
      ad_name: c.ad_name,
      score: computeCreativeScore(c, { scaleThreshold: savedConfig?.scale_threshold || DEFAULT_SCORING_CONFIG.scale_threshold }, savedConfig || DEFAULT_SCORING_CONFIG).score,
    }));

    const afterScores = top.map((c: any) => ({
      ad_id: c.ad_id,
      ad_name: c.ad_name,
      score: computeCreativeScore(c, { scaleThreshold: config.scale_threshold }, config).score,
    }));

    beforeScores.sort((a, b) => b.score - a.score);
    afterScores.sort((a, b) => b.score - a.score);

    return afterScores.slice(0, 5).map((after, i) => {
      const beforeRank = beforeScores.findIndex((b) => b.ad_id === after.ad_id);
      const beforeScore = beforeScores.find((b) => b.ad_id === after.ad_id)?.score || 0;
      return {
        ...after,
        beforeRank: beforeRank + 1,
        afterRank: i + 1,
        beforeScore,
        rankChange: (beforeRank + 1) - (i + 1),
      };
    });
  }, [creatives, config, savedConfig]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Weight sliders */}
      <section className="glass-panel p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-verdant" />
          <h2 className="font-heading text-[16px] text-forest">Score Weights</h2>
        </div>
        <p className="font-body text-[12px] text-muted-foreground">
          Adjust how the Creative Score (0-100) is weighted. Weights must total 100%.
        </p>

        <div className="space-y-4">
          <WeightSlider label="ROAS" value={config.roas_weight} max={50} onChange={(v) => updateWeight("roas_weight", v)} />
          <WeightSlider label="CTR" value={config.ctr_weight} max={40} onChange={(v) => updateWeight("ctr_weight", v)} />
          <WeightSlider label="Hook Rate" value={config.hook_rate_weight} max={30} onChange={(v) => updateWeight("hook_rate_weight", v)} />
          <WeightSlider label="Spend Efficiency" value={config.spend_efficiency_weight} max={20} onChange={(v) => updateWeight("spend_efficiency_weight", v)} />
          <WeightSlider label="Momentum" value={config.momentum_weight} max={20} onChange={(v) => updateWeight("momentum_weight", v)} />
          <WeightSlider label="Fatigue Penalty" value={config.fatigue_weight} max={20} onChange={(v) => updateWeight("fatigue_weight", v)} />
        </div>

        {/* Total indicator */}
        <div className={cn(
          "flex items-center justify-between p-3 rounded-md border",
          isValid
            ? "bg-verdant/5 border-verdant/30 text-verdant"
            : "bg-destructive/5 border-destructive/30 text-destructive",
        )}>
          <span className="font-body text-[13px] font-medium">Total</span>
          <span className="font-data text-[18px] font-bold tabular-nums">{weightTotal}%</span>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={normalize} className="gap-1.5 font-body text-[12px]">
            <Scale className="h-3.5 w-3.5" /> Normalize to 100%
          </Button>
          <Button size="sm" variant="ghost" onClick={resetToDefaults} className="gap-1.5 font-body text-[12px] text-muted-foreground">
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </Button>
        </div>
      </section>

      {/* Thresholds & benchmarks */}
      <section className="glass-panel p-6 space-y-4">
        <h2 className="font-heading text-[16px] text-forest">Thresholds & Benchmarks</h2>
        <p className="font-body text-[12px] text-muted-foreground">
          These values define what counts as "scaling", "losing", and full marks for CTR/Hook Rate.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="font-body text-[12px] text-slate">Scale Threshold (ROAS)</Label>
            <Input
              type="number" step="0.1" min="0"
              value={config.scale_threshold}
              onChange={(e) => updateWeight("scale_threshold" as any, Number(e.target.value))}
              className="h-9 font-data text-[14px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-body text-[12px] text-slate">Kill Threshold (ROAS)</Label>
            <Input
              type="number" step="0.1" min="0"
              value={config.kill_threshold}
              onChange={(e) => updateWeight("kill_threshold" as any, Number(e.target.value))}
              className="h-9 font-data text-[14px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-body text-[12px] text-slate">Min Spend for Analysis</Label>
            <Input
              type="number" step="10" min="0"
              value={config.min_spend}
              onChange={(e) => updateWeight("min_spend" as any, Number(e.target.value))}
              className="h-9 font-data text-[14px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-body text-[12px] text-slate">CTR Benchmark (%)</Label>
            <Input
              type="number" step="0.1" min="0"
              value={config.ctr_benchmark}
              onChange={(e) => updateWeight("ctr_benchmark" as any, Number(e.target.value))}
              className="h-9 font-data text-[14px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-body text-[12px] text-slate">Hook Rate Benchmark (%)</Label>
            <Input
              type="number" step="1" min="0"
              value={config.hook_rate_benchmark}
              onChange={(e) => updateWeight("hook_rate_benchmark" as any, Number(e.target.value))}
              className="h-9 font-data text-[14px]"
            />
          </div>
        </div>
      </section>

      {/* Live preview */}
      {preview.length > 0 && (
        <section className="glass-panel p-6 space-y-3">
          <h2 className="font-heading text-[16px] text-forest">Live Preview</h2>
          <p className="font-body text-[12px] text-muted-foreground">
            How the top 5 creatives re-rank with your adjusted weights.
          </p>
          <div className="space-y-2">
            {preview.map((p) => (
              <div key={p.ad_id} className="flex items-center gap-3 p-2.5 rounded-md bg-muted/30 border border-border/50">
                <span className="font-data text-[12px] text-muted-foreground w-6 text-center tabular-nums">#{p.afterRank}</span>
                <span className="font-body text-[13px] text-charcoal flex-1 truncate">{p.ad_name}</span>
                <div className="flex items-center gap-2">
                  <span className="font-data text-[12px] text-muted-foreground tabular-nums">{p.beforeScore}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-data text-[14px] font-semibold text-forest tabular-nums">{p.score}</span>
                </div>
                {p.rankChange !== 0 && (
                  <span className={cn(
                    "font-data text-[11px] font-semibold px-1.5 py-0.5 rounded",
                    p.rankChange > 0 ? "text-verdant bg-verdant/10" : "text-destructive bg-destructive/10"
                  )}>
                    {p.rankChange > 0 ? `↑${p.rankChange}` : `↓${Math.abs(p.rankChange)}`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Save */}
      <Button
        onClick={() => save.mutate(config)}
        disabled={save.isPending || !isValid}
        className="gap-2"
      >
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save Scoring Config
      </Button>
      {!isValid && (
        <p className="font-body text-[12px] text-destructive">
          Weights must sum to 100% (currently {weightTotal}%). Use "Normalize" to auto-adjust.
        </p>
      )}
    </div>
  );
}
