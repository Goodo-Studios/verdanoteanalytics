import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Bell, Mail, Hash, Clock, Save, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAccounts } from "@/hooks/useAccountsApi";
import { toast } from "sonner";

interface AlertsConfig {
  scale_threshold: { enabled: boolean; value: number };
  kill_threshold: { enabled: boolean; value: number };
  fatigue_threshold: { enabled: boolean; value: number };
  zero_spend_days: { enabled: boolean; value: number };
  frequency_spike: { enabled: boolean; value: number };
  new_creative: { enabled: boolean };
  sync_completed: "always" | "errors_only" | "never";
  pacing_range: { enabled: boolean; min: number; max: number };
  email_enabled: boolean;
  slack_webhook: string | null;
  account_filter: string[];
  quiet_hours: { enabled: boolean; start: number; end: number };
}

const DEFAULT_CONFIG: AlertsConfig = {
  scale_threshold: { enabled: true, value: 2.0 },
  kill_threshold: { enabled: true, value: 0.8 },
  fatigue_threshold: { enabled: true, value: 70 },
  zero_spend_days: { enabled: true, value: 3 },
  frequency_spike: { enabled: true, value: 5.0 },
  new_creative: { enabled: false },
  sync_completed: "errors_only",
  pacing_range: { enabled: true, min: 80, max: 120 },
  email_enabled: false,
  slack_webhook: null,
  account_filter: [],
  quiet_hours: { enabled: false, start: 22, end: 7 },
};

function formatHour(h: number) {
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:00 ${ampm}`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function AlertsConfigSection() {
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts();
  const [config, setConfig] = useState<AlertsConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Detect timezone
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("alerts_config")
        .eq("user_id", user.id)
        .single();
      if (data?.alerts_config) {
        setConfig({ ...DEFAULT_CONFIG, ...(data.alerts_config as any) });
      }
      setLoading(false);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("user_preferences")
        .upsert({ user_id: user.id, alerts_config: config as any }, { onConflict: "user_id" });
      if (error) throw error;
      toast.success("Alert preferences saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateThreshold = (key: keyof AlertsConfig, field: string, value: any) => {
    setConfig((prev) => ({
      ...prev,
      [key]: { ...(prev[key] as any), [field]: value },
    }));
  };

  const toggleAccountFilter = (accountId: string) => {
    setConfig((prev) => ({
      ...prev,
      account_filter: prev.account_filter.includes(accountId)
        ? prev.account_filter.filter((id) => id !== accountId)
        : [...prev.account_filter, accountId],
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Threshold Alerts ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <h3 className="font-heading text-[16px] font-semibold text-foreground">Threshold Alerts</h3>
        </div>

        <ThresholdRow
          label="Creative crosses scale threshold"
          description="Notify when ROAS exceeds this value"
          enabled={config.scale_threshold.enabled}
          value={config.scale_threshold.value}
          suffix="x"
          step={0.1}
          onToggle={(v) => updateThreshold("scale_threshold", "enabled", v)}
          onValue={(v) => updateThreshold("scale_threshold", "value", v)}
        />
        <ThresholdRow
          label="Creative drops below kill threshold"
          description="Notify when ROAS drops below this value"
          enabled={config.kill_threshold.enabled}
          value={config.kill_threshold.value}
          suffix="x"
          step={0.1}
          onToggle={(v) => updateThreshold("kill_threshold", "enabled", v)}
          onValue={(v) => updateThreshold("kill_threshold", "value", v)}
        />
        <ThresholdRow
          label="High fatigue detected"
          description="Notify when fatigue score exceeds"
          enabled={config.fatigue_threshold.enabled}
          value={config.fatigue_threshold.value}
          suffix=""
          step={5}
          onToggle={(v) => updateThreshold("fatigue_threshold", "enabled", v)}
          onValue={(v) => updateThreshold("fatigue_threshold", "value", v)}
        />
        <ThresholdRow
          label="Zero spend detected"
          description="Notify when creative has $0 spend for"
          enabled={config.zero_spend_days.enabled}
          value={config.zero_spend_days.value}
          suffix=" days"
          step={1}
          onToggle={(v) => updateThreshold("zero_spend_days", "enabled", v)}
          onValue={(v) => updateThreshold("zero_spend_days", "value", v)}
        />
        <ThresholdRow
          label="Frequency spike"
          description="Notify when frequency exceeds"
          enabled={config.frequency_spike.enabled}
          value={config.frequency_spike.value}
          suffix="x"
          step={0.5}
          onToggle={(v) => updateThreshold("frequency_spike", "enabled", v)}
          onValue={(v) => updateThreshold("frequency_spike", "value", v)}
        />

        <div className="flex items-center justify-between py-2 px-3 rounded-md border border-border bg-card">
          <div>
            <p className="text-sm font-medium text-foreground">New creative detected</p>
            <p className="text-xs text-muted-foreground">Notify when a new ad appears in sync</p>
          </div>
          <Switch
            checked={config.new_creative.enabled}
            onCheckedChange={(v) => updateThreshold("new_creative", "enabled", v)}
          />
        </div>
      </section>

      <Separator />

      {/* ── Account Alerts ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-primary" />
          <h3 className="font-heading text-[16px] font-semibold text-foreground">Account Alerts</h3>
        </div>

        <div className="flex items-center justify-between py-2 px-3 rounded-md border border-border bg-card">
          <div>
            <p className="text-sm font-medium text-foreground">Sync completed</p>
            <p className="text-xs text-muted-foreground">When to notify on sync finish</p>
          </div>
          <Select
            value={config.sync_completed}
            onValueChange={(v: any) => setConfig((prev) => ({ ...prev, sync_completed: v }))}
          >
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="always" className="text-xs">Always</SelectItem>
              <SelectItem value="errors_only" className="text-xs">Errors only</SelectItem>
              <SelectItem value="never" className="text-xs">Never</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between py-2 px-3 rounded-md border border-border bg-card">
          <div>
            <p className="text-sm font-medium text-foreground">Sync failed</p>
            <p className="text-xs text-muted-foreground">Always notify on sync failure</p>
          </div>
          <Badge variant="secondary" className="text-[10px]">Always on</Badge>
        </div>

        <div className="flex items-center justify-between py-2 px-3 rounded-md border border-border bg-card">
          <div>
            <p className="text-sm font-medium text-foreground">Pacing off track</p>
            <p className="text-xs text-muted-foreground">Notify when pacing % is outside range</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={config.pacing_range.enabled}
              onCheckedChange={(v) => updateThreshold("pacing_range", "enabled", v)}
            />
            {config.pacing_range.enabled && (
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={config.pacing_range.min}
                  onChange={(e) => updateThreshold("pacing_range", "min", Number(e.target.value))}
                  className="w-16 h-7 text-xs text-center"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="number"
                  value={config.pacing_range.max}
                  onChange={(e) => updateThreshold("pacing_range", "max", Number(e.target.value))}
                  className="w-16 h-7 text-xs text-center"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <Separator />

      {/* ── Delivery Preferences ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h3 className="font-heading text-[16px] font-semibold text-foreground">Delivery Preferences</h3>
        </div>

        <div className="flex items-center justify-between py-2 px-3 rounded-md border border-border bg-card">
          <div>
            <p className="text-sm font-medium text-foreground">In-app notifications</p>
            <p className="text-xs text-muted-foreground">Notification bell — always enabled</p>
          </div>
          <Badge variant="secondary" className="text-[10px]">Always on</Badge>
        </div>

        <div className="flex items-center justify-between py-2 px-3 rounded-md border border-border bg-card">
          <div>
            <p className="text-sm font-medium text-foreground">Email notifications</p>
            <p className="text-xs text-muted-foreground">Requires email address in profile</p>
          </div>
          <Switch
            checked={config.email_enabled}
            onCheckedChange={(v) => setConfig((prev) => ({ ...prev, email_enabled: v }))}
          />
        </div>

        <div className="space-y-2 py-2 px-3 rounded-md border border-border bg-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Slack notifications</p>
              <p className="text-xs text-muted-foreground">Personal webhook URL for your alerts</p>
            </div>
            <Switch
              checked={!!config.slack_webhook}
              onCheckedChange={(v) =>
                setConfig((prev) => ({ ...prev, slack_webhook: v ? (prev.slack_webhook || "") : null }))
              }
            />
          </div>
          {config.slack_webhook !== null && (
            <Input
              type="url"
              value={config.slack_webhook || ""}
              onChange={(e) => setConfig((prev) => ({ ...prev, slack_webhook: e.target.value }))}
              placeholder="https://hooks.slack.com/services/..."
              className="h-8 text-xs font-mono"
            />
          )}
        </div>
      </section>

      <Separator />

      {/* ── Account Filter ── */}
      <section className="space-y-3">
        <div>
          <h3 className="font-heading text-[16px] font-semibold text-foreground">Account Filter</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Only alert me for these accounts. Leave empty for all accounts.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(accounts as any[]).map((acc: any) => (
            <label
              key={acc.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded border border-border bg-card cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <Checkbox
                checked={config.account_filter.includes(acc.id)}
                onCheckedChange={() => toggleAccountFilter(acc.id)}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs text-foreground truncate">{acc.name}</span>
            </label>
          ))}
        </div>
        {config.account_filter.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {config.account_filter.length} account{config.account_filter.length !== 1 ? "s" : ""} selected
          </p>
        )}
      </section>

      <Separator />

      {/* ── Quiet Hours ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="font-heading text-[16px] font-semibold text-foreground">Quiet Hours</h3>
        </div>

        <div className="flex items-center justify-between py-2 px-3 rounded-md border border-border bg-card">
          <div>
            <p className="text-sm font-medium text-foreground">Enable quiet hours</p>
            <p className="text-xs text-muted-foreground">No notifications during these hours ({timezone})</p>
          </div>
          <Switch
            checked={config.quiet_hours.enabled}
            onCheckedChange={(v) => updateThreshold("quiet_hours", "enabled", v)}
          />
        </div>

        {config.quiet_hours.enabled && (
          <div className="flex items-center gap-3 px-3">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">From</Label>
              <Select
                value={String(config.quiet_hours.start)}
                onValueChange={(v) => updateThreshold("quiet_hours", "start", Number(v))}
              >
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)} className="text-xs">{formatHour(h)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="text-sm text-muted-foreground mt-5">to</span>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Until</Label>
              <Select
                value={String(config.quiet_hours.end)}
                onValueChange={(v) => updateThreshold("quiet_hours", "end", Number(v))}
              >
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)} className="text-xs">{formatHour(h)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </section>

      {/* Save */}
      <div className="pt-2">
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save Alert Preferences
        </Button>
      </div>
    </div>
  );
}

/* ── Reusable threshold row ── */
function ThresholdRow({
  label, description, enabled, value, suffix, step,
  onToggle, onValue,
}: {
  label: string; description: string;
  enabled: boolean; value: number; suffix: string; step: number;
  onToggle: (v: boolean) => void; onValue: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md border border-border bg-card">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch checked={enabled} onCheckedChange={onToggle} />
        {enabled && (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={value}
              onChange={(e) => onValue(Number(e.target.value))}
              step={step}
              className="w-20 h-7 text-xs text-center"
            />
            {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
