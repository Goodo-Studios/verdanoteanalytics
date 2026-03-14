import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface SyncSettingsSectionProps {
  dateRange: string;
  setDateRange: (v: string) => void;
  roasThreshold: string;
  setRoasThreshold: (v: string) => void;
  spendThreshold: string;
  setSpendThreshold: (v: string) => void;
  winnerKpi: string;
  setWinnerKpi: (v: string) => void;
  winnerKpiDirection: string;
  setWinnerKpiDirection: (v: string) => void;
  winnerKpiThreshold: string;
  setWinnerKpiThreshold: (v: string) => void;
  killScaleKpi: string;
  setKillScaleKpi: (v: string) => void;
  killScaleKpiDirection: string;
  setKillScaleKpiDirection: (v: string) => void;
  scaleThreshold: string;
  setScaleThreshold: (v: string) => void;
  killThreshold: string;
  setKillThreshold: (v: string) => void;
  syncCooldownMinutes: string;
  setSyncCooldownMinutes: (v: string) => void;
  onSaveCooldown: () => void;
  onSave: () => void;
  onApplyToAll: () => void;
  saving: boolean;
  showApplyAll: boolean;
  targetRoas: string;
  setTargetRoas: (v: string) => void;
  targetCpa: string;
  setTargetCpa: (v: string) => void;
  targetMonthlySpend: string;
  setTargetMonthlySpend: (v: string) => void;
}

const KPI_OPTIONS = [
  { value: "roas", label: "ROAS" },
  { value: "cpa", label: "CPA" },
  { value: "ctr", label: "CTR" },
  { value: "thumb_stop_rate", label: "Hook Rate" },
];

const DIRECTION_OPTIONS = [
  { value: "gte", label: "≥ (greater or equal)" },
  { value: "lte", label: "≤ (less or equal)" },
];

export function SyncSettingsSection({
  dateRange, setDateRange, roasThreshold, setRoasThreshold,
  spendThreshold, setSpendThreshold,
  winnerKpi, setWinnerKpi, winnerKpiDirection, setWinnerKpiDirection,
  winnerKpiThreshold, setWinnerKpiThreshold,
  killScaleKpi, setKillScaleKpi, killScaleKpiDirection, setKillScaleKpiDirection,
  scaleThreshold, setScaleThreshold, killThreshold, setKillThreshold,
  syncCooldownMinutes, setSyncCooldownMinutes, onSaveCooldown,
  onSave, onApplyToAll, saving, showApplyAll,
  targetRoas, setTargetRoas, targetCpa, setTargetCpa,
  targetMonthlySpend, setTargetMonthlySpend,
}: SyncSettingsSectionProps) {
  const kpiLabel = KPI_OPTIONS.find(k => k.value === winnerKpi)?.label || winnerKpi;
  const isGte = winnerKpiDirection !== "lte";
  const ksKpiLabel = KPI_OPTIONS.find(k => k.value === killScaleKpi)?.label || killScaleKpi;
  const ksIsGte = killScaleKpiDirection !== "lte";

  return (
    <section className="glass-panel p-6 space-y-4">
      <div>
        <h2 className="font-heading text-[20px] text-forest">Sync Settings</h2>
        <p className="font-body text-[13px] text-slate mt-0.5">Configure data range and thresholds for this account.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="font-body text-[14px] font-medium text-charcoal">Date Range (days)</Label>
          <Input type="number" value={dateRange} onChange={(e) => setDateRange(e.target.value)} min="1" max="365" className="bg-background font-data text-[17px] font-medium text-charcoal" />
          <p className="font-body text-[12px] text-sage">How many days of data to pull on each sync.</p>
        </div>
        <div className="space-y-2">
          <Label className="font-body text-[14px] font-medium text-charcoal">Iteration Spend Threshold ($)</Label>
          <Input type="number" value={spendThreshold} onChange={(e) => setSpendThreshold(e.target.value)} min="0" className="bg-background font-data text-[17px] font-medium text-charcoal" />
          <p className="font-body text-[12px] text-sage">Minimum spend to include in analysis.</p>
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-2">
        <div>
          <h3 className="font-heading text-[20px] text-forest">Sync Cooldown</h3>
          <p className="font-body text-[13px] text-slate mt-0.5">Global delay between sequential account syncs to reduce Meta API rate limit pressure.</p>
        </div>
        <div className="max-w-[200px] space-y-2">
          <Label className="font-body text-[14px] font-medium text-charcoal">Cooldown (minutes)</Label>
          <Input
            type="number"
            value={syncCooldownMinutes}
            onChange={(e) => setSyncCooldownMinutes(e.target.value)}
            min="0"
            max="60"
            step="1"
            className="bg-background font-data text-[17px] font-medium text-charcoal"
          />
          <p className="font-body text-[12px] text-sage">
            {syncCooldownMinutes === "0" || !syncCooldownMinutes
              ? "No cooldown — accounts sync back-to-back."
              : `~${syncCooldownMinutes} minute${Number(syncCooldownMinutes) !== 1 ? "s" : ""} wait after each account finishes before the next begins.`}
          </p>
          <Button size="sm" variant="outline" onClick={onSaveCooldown} className="mt-1">
            Save Cooldown
          </Button>
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <div>
          <h3 className="font-heading text-[20px] text-forest">Winner Definition</h3>
          <p className="font-body text-[13px] text-slate mt-0.5">Choose which metric and threshold defines a "winner" creative.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label className="font-body text-[14px] font-medium text-charcoal">KPI Metric</Label>
            <Select value={winnerKpi} onValueChange={setWinnerKpi}>
              <SelectTrigger className="bg-background font-body text-[14px] text-charcoal"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KPI_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="font-body text-[14px] font-medium text-charcoal">Direction</Label>
            <Select value={winnerKpiDirection} onValueChange={setWinnerKpiDirection}>
              <SelectTrigger className="bg-background font-body text-[14px] text-charcoal"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIRECTION_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="font-body text-[14px] font-medium text-charcoal">Winner Threshold</Label>
            <Input type="number" value={winnerKpiThreshold} onChange={(e) => setWinnerKpiThreshold(e.target.value)} step="0.1" min="0" className="bg-background font-data text-[17px] font-medium text-charcoal" />
          </div>
        </div>
        <p className="font-body text-[12px] text-sage">
          A creative is a winner when <span className="font-medium text-charcoal">{kpiLabel}</span> is {isGte ? "≥" : "≤"} <span className="font-data font-medium text-charcoal">{winnerKpiThreshold || "0"}</span> and spend exceeds <span className="font-data font-medium text-charcoal">${spendThreshold || "0"}</span>.
        </p>
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <div>
          <h3 className="font-heading text-[20px] text-forest">Kill / Scale Zones</h3>
          <p className="font-body text-[13px] text-slate mt-0.5">
            Define thresholds for Scale, Watch, and Kill zones. {ksIsGte ? "Scale ≥ top value, Kill < bottom value, Watch = in between." : "Scale ≤ bottom value, Kill > top value, Watch = in between."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="font-body text-[14px] font-medium text-charcoal">KPI Metric</Label>
            <Select value={killScaleKpi} onValueChange={setKillScaleKpi}>
              <SelectTrigger className="bg-background font-body text-[14px] text-charcoal"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KPI_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="font-body text-[14px] font-medium text-charcoal">Direction</Label>
            <Select value={killScaleKpiDirection} onValueChange={setKillScaleKpiDirection}>
              <SelectTrigger className="bg-background font-body text-[14px] text-charcoal"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIRECTION_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="font-body text-[14px] font-medium text-scale">Scale Threshold</Label>
            <Input type="number" value={scaleThreshold} onChange={(e) => setScaleThreshold(e.target.value)} step="0.1" min="0" className="bg-background font-data text-[17px] font-medium text-charcoal" />
            <p className="font-body text-[12px] text-sage">
              {ksIsGte ? `${ksKpiLabel} ≥ this → Scale` : `${ksKpiLabel} ≤ this → Scale`}
            </p>
          </div>
          <div className="space-y-2">
            <Label className="font-body text-[14px] font-medium text-kill">Kill Threshold</Label>
            <Input type="number" value={killThreshold} onChange={(e) => setKillThreshold(e.target.value)} step="0.1" min="0" className="bg-background font-data text-[17px] font-medium text-charcoal" />
            <p className="font-body text-[12px] text-sage">
              {ksIsGte ? `${ksKpiLabel} < this → Kill` : `${ksKpiLabel} > this → Kill`}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <div>
          <h3 className="font-heading text-[20px] text-forest">Performance Goals</h3>
          <p className="font-body text-[13px] text-slate mt-0.5">Set targets to track progress on the overview page. Leave blank to hide.</p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="font-body text-[14px] font-medium text-charcoal">Target ROAS</Label>
            <Input type="number" value={targetRoas} onChange={(e) => setTargetRoas(e.target.value)} step="0.1" min="0" placeholder="e.g. 2.5" className="bg-background font-data text-[17px] font-medium text-charcoal" />
          </div>
          <div className="space-y-2">
            <Label className="font-body text-[14px] font-medium text-charcoal">Target CPA ($)</Label>
            <Input type="number" value={targetCpa} onChange={(e) => setTargetCpa(e.target.value)} step="1" min="0" placeholder="e.g. 40" className="bg-background font-data text-[17px] font-medium text-charcoal" />
          </div>
          <div className="space-y-2">
            <Label className="font-body text-[14px] font-medium text-charcoal">Target Monthly Spend ($)</Label>
            <Input type="number" value={targetMonthlySpend} onChange={(e) => setTargetMonthlySpend(e.target.value)} step="100" min="0" placeholder="e.g. 50000" className="bg-background font-data text-[17px] font-medium text-charcoal" />
          </div>
        </div>
      </div>

      <div className="pt-2 flex items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
          Save Settings
        </Button>
        {showApplyAll && (
          <Button size="sm" variant="outline" onClick={onApplyToAll} disabled={saving}>
            Apply to All Accounts
          </Button>
        )}
      </div>
    </section>
  );
}
