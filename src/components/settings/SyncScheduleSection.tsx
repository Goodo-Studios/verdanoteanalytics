import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, RefreshCw, Loader2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncScheduleSectionProps {
  accounts: any[];
  onSyncAll: () => void;
  isSyncing: boolean;
}

const FREQUENCY_OPTIONS = [
  { value: "manual", label: "Manual only" },
  { value: "daily", label: "Daily" },
  { value: "12h", label: "Every 12 hours" },
  { value: "6h", label: "Every 6 hours" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${i === 0 ? "12" : i > 12 ? String(i - 12) : String(i)}:00 ${i < 12 ? "AM" : "PM"}`,
}));

const TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
];

function formatTimestamp(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function SyncScheduleSection({ accounts, onSyncAll, isSyncing }: SyncScheduleSectionProps) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const handleUpdate = useCallback(async (accountId: string, updates: Record<string, any>) => {
    setSaving(accountId);
    try {
      // Calculate next_sync_at if frequency changed
      const freq = updates.sync_frequency;
      if (freq && freq !== "manual") {
        const hour = updates.sync_hour ?? accounts.find((a: any) => a.id === accountId)?.sync_hour ?? 2;
        const now = new Date();
        let nextSync: Date;
        if (freq === "6h") nextSync = new Date(now.getTime() + 6 * 60 * 60 * 1000);
        else if (freq === "12h") nextSync = new Date(now.getTime() + 12 * 60 * 60 * 1000);
        else {
          nextSync = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          nextSync.setUTCHours(hour + 5, 0, 0, 0); // Rough EST offset
        }
        updates.next_sync_at = nextSync.toISOString();
      } else if (freq === "manual") {
        updates.next_sync_at = null;
      }

      const { error } = await supabase
        .from("ad_accounts")
        .update(updates)
        .eq("id", accountId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Schedule updated");
    } catch (e: any) {
      toast.error("Failed to update schedule", { description: e.message });
    } finally {
      setSaving(null);
    }
  }, [accounts, queryClient]);

  const hasScheduled = accounts.some((a: any) => a.sync_frequency && a.sync_frequency !== "manual");

  return (
    <section className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[20px] text-foreground">Sync Schedule</h2>
          <p className="font-body text-[13px] text-muted-foreground mt-0.5">
            Set automatic sync cadences per account.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onSyncAll}
          disabled={isSyncing}
          className="gap-1.5"
        >
          {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync All Now
        </Button>
      </div>

      {hasScheduled && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border border-border">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="font-body text-[12px] text-muted-foreground">
            Schedule active — contact your admin to enable automated triggers via pg_cron.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {accounts.map((acc: any) => {
          const freq = acc.sync_frequency || "manual";
          const hour = acc.sync_hour ?? 2;
          const tz = acc.sync_timezone || "America/New_York";
          const isSavingThis = saving === acc.id;

          return (
            <div
              key={acc.id}
              className="border border-border rounded-lg p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-body text-[14px] font-semibold text-foreground">{acc.name}</h3>
                  {freq !== "manual" && (
                    <Badge variant="outline" className="font-label text-[9px] uppercase border-primary/30 text-primary">
                      {FREQUENCY_OPTIONS.find(f => f.value === freq)?.label}
                    </Badge>
                  )}
                </div>
                {isSavingThis && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Frequency</Label>
                  <Select
                    value={freq}
                    onValueChange={(v) => handleUpdate(acc.id, { sync_frequency: v })}
                  >
                    <SelectTrigger className="h-8 font-body text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCY_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {freq === "daily" && (
                  <div className="space-y-1">
                    <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Time</Label>
                    <Select
                      value={String(hour)}
                      onValueChange={(v) => handleUpdate(acc.id, { sync_hour: parseInt(v) })}
                    >
                      <SelectTrigger className="h-8 font-body text-[12px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HOUR_OPTIONS.map(o => (
                          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1">
                  <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Timezone</Label>
                  <Select
                    value={tz}
                    onValueChange={(v) => handleUpdate(acc.id, { sync_timezone: v })}
                  >
                    <SelectTrigger className="h-8 font-body text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map(tz_opt => (
                        <SelectItem key={tz_opt} value={tz_opt} className="text-xs">
                          {tz_opt.replace("America/", "").replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-4 font-body text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Last synced: {formatTimestamp(acc.last_synced_at)}
                </span>
                {acc.next_sync_at && freq !== "manual" && (
                  <span className="flex items-center gap-1">
                    Next: {formatTimestamp(acc.next_sync_at)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
