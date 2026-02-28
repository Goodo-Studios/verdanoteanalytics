import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Save, Clock, Rocket, AlertTriangle } from "lucide-react";
import { format, differenceInDays } from "date-fns";

import { useCreatives } from "@/hooks/useCreatives";

/* ── Types ─────────────────────────────────── */

interface Transition {
  account_id: string;
  contract_signed_at: string | null;
  meta_access_granted: boolean;
  account_added: boolean;
  first_sync_completed: boolean;
  historical_data_notes: string | null;
  historical_data_reviewed: boolean;
  kickoff_call_at: string | null;
  brief_templates_setup: boolean;
  client_user_created: boolean;
  first_report_at: string | null;
  thirty_day_checkin_at: string | null;
}

interface MilestoneEntry {
  id: string;
  type: string;
  date: string;
  notes: string;
  created_at: string;
}

const MILESTONE_TYPES = [
  { value: "contract", label: "Contract", icon: "📝" },
  { value: "kickoff", label: "Kick-off", icon: "🚀" },
  { value: "creative_pivot", label: "Creative Pivot", icon: "🎨" },
  { value: "budget_change", label: "Budget Change", icon: "💰" },
  { value: "renewal", label: "Renewal", icon: "🔄" },
  { value: "at_risk", label: "At-Risk", icon: "⚠️" },
  { value: "won_back", label: "Won Back", icon: "🏆" },
  { value: "paused", label: "Paused", icon: "⏸️" },
  { value: "offboarded", label: "Offboarded", icon: "👋" },
];

const MILESTONE_ICON_MAP: Record<string, string> = Object.fromEntries(
  MILESTONE_TYPES.map((t) => [t.value, t.icon])
);

/* ── Hooks ─────────────────────────────────── */

function useTransition(accountId: string) {
  return useQuery({
    queryKey: ["client_transition", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_transitions" as any)
        .select("*")
        .eq("account_id", accountId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Transition | null;
    },
    enabled: !!accountId,
  });
}

function useTransitionLog(accountId: string) {
  return useQuery({
    queryKey: ["transition_log", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_context")
        .select("transition_log")
        .eq("account_id", accountId)
        .maybeSingle();
      if (error) throw error;
      const log = (data as any)?.transition_log;
      return (Array.isArray(log) ? log : []) as MilestoneEntry[];
    },
    enabled: !!accountId,
  });
}

function useAtRiskSignals(account: any) {
  
  const { data: creativesResult } = useCreatives(account?.id ? { account_id: account.id } : {});
  const creatives = Array.isArray(creativesResult) ? creativesResult : (creativesResult?.data ?? []);

  return useMemo(() => {
    const signals: string[] = [];
    const now = new Date();

    // No new creatives in 30+ days
    if (creatives.length > 0) {
      const latestCreative = creatives.reduce((latest: any, c: any) => {
        if (!latest || (c.created_at && c.created_at > latest.created_at)) return c;
        return latest;
      }, null);
      if (latestCreative?.created_at) {
        const daysSince = differenceInDays(now, new Date(latestCreative.created_at));
        if (daysSince >= 30) {
          signals.push(`No new creatives in ${daysSince} days`);
        }
      }
    }

    // Last report check — use last_scheduled_report_at from account
    if (account?.last_scheduled_report_at) {
      const daysSinceReport = differenceInDays(now, new Date(account.last_scheduled_report_at));
      if (daysSinceReport >= 45) {
        signals.push(`Last report: ${daysSinceReport} days ago`);
      }
    } else if (account?.created_at) {
      // No report ever sent
      const accountAge = differenceInDays(now, new Date(account.created_at));
      if (accountAge >= 45) {
        signals.push("No reports have been delivered");
      }
    }

    // ROAS declining — check if most creatives with prior_roas show decline
    const withPrior = creatives.filter((c: any) => c.prior_roas != null && c.roas != null);
    if (withPrior.length >= 5) {
      const declining = withPrior.filter((c: any) => Number(c.roas) < Number(c.prior_roas));
      if (declining.length / withPrior.length >= 0.7) {
        signals.push("ROAS trending downward across most creatives");
      }
    }

    return signals;
  }, [account, creatives]);
}

/* ── Component ─────────────────────────────── */

interface Props {
  account: any;
}

export function TransitionTab({ account }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: transition, isLoading: loadingTransition } = useTransition(account.id);
  const { data: milestones = [], isLoading: loadingMilestones } = useTransitionLog(account.id);
  const atRiskSignals = useAtRiskSignals(account);

  // Local checklist state
  const [form, setForm] = useState<Partial<Transition>>({});
  const [dirty, setDirty] = useState(false);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);

  useEffect(() => {
    if (transition) {
      setForm(transition);
      setDirty(false);
    } else if (!loadingTransition) {
      setForm({ account_id: account.id });
    }
  }, [transition, loadingTransition, account.id]);

  const setField = useCallback(<K extends keyof Transition>(key: K, value: Transition[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...form, account_id: account.id, updated_by: user?.id };
      const { error } = await supabase
        .from("client_transitions" as any)
        .upsert(payload as any, { onConflict: "account_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Onboarding checklist saved");
      qc.invalidateQueries({ queryKey: ["client_transition", account.id] });
      setDirty(false);
    },
    onError: (e: any) => toast.error("Save failed", { description: e.message }),
  });

  const checklistItems = [
    { key: "contract_signed_at", label: "Contract signed", type: "date" },
    { key: "meta_access_granted", label: "Meta Business Manager access granted", type: "bool" },
    { key: "account_added", label: "Ad account ID added to Verdanote", type: "bool" },
    { key: "first_sync_completed", label: "First sync completed", type: "bool" },
    { key: "historical_data_reviewed", label: "Historical data reviewed", type: "bool_notes", notesKey: "historical_data_notes" },
    { key: "kickoff_call_at", label: "Kick-off call completed", type: "date" },
    { key: "brief_templates_setup", label: "Creative brief templates set up", type: "bool" },
    { key: "client_user_created", label: "Client user account created", type: "bool" },
    { key: "first_report_at", label: "First report delivered", type: "date" },
    { key: "thirty_day_checkin_at", label: "30-day check-in scheduled", type: "date" },
  ] as const;

  const totalDone = checklistItems.filter((item) => !!(form as any)[item.key]).length;
  const progress = Math.round((totalDone / checklistItems.length) * 100);

  const sortedMilestones = useMemo(
    () => [...milestones].sort((a, b) => b.date.localeCompare(a.date)),
    [milestones]
  );

  return (
    <div className="max-w-3xl space-y-8">
      {/* AT-RISK BANNER */}
      {atRiskSignals.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-heading text-[14px] text-destructive font-semibold">
              ⚠️ This account shows at-risk signals
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {atRiskSignals.map((signal, i) => (
                <li key={i} className="font-body text-[12px] text-destructive/80">• {signal}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ONBOARDING CHECKLIST */}
      <section className="glass-panel p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-[18px] text-foreground flex items-center gap-2">
              <Rocket className="w-5 h-5 text-primary" /> Client Onboarding Checklist
            </h2>
            <p className="font-body text-[12px] text-muted-foreground mt-1">
              Track go-live progress for {account.name}
            </p>
          </div>
          <Badge variant="outline" className="font-data text-[12px] tabular-nums">
            {totalDone}/{checklistItems.length} · {progress}%
          </Badge>
        </div>

        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>

        <div className="space-y-3">
          {checklistItems.map((item) => (
            <ChecklistRow key={item.key} item={item} form={form} setField={setField} />
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <Button size="sm" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {saveMutation.isPending ? "Saving…" : "Save Checklist"}
          </Button>
        </div>
      </section>

      {/* MILESTONES TIMELINE */}
      <section className="glass-panel p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-[18px] text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" /> Client Health Timeline
            </h2>
            <p className="font-body text-[12px] text-muted-foreground mt-1">Key relationship milestones</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowMilestoneModal(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Milestone
          </Button>
        </div>

        {loadingMilestones ? (
          <div className="py-8 text-center text-muted-foreground font-body text-[13px]">Loading…</div>
        ) : sortedMilestones.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground font-body text-[13px]">
            No milestones yet. Add the first one to start tracking.
          </div>
        ) : (
          <div className="relative pl-6 space-y-0">
            <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />
            {sortedMilestones.map((m) => (
              <div key={m.id} className="relative flex items-start gap-3 py-3">
                <div className="absolute left-[-15px] top-[18px] w-3 h-3 rounded-full border-2 border-primary bg-card z-10" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-body text-[11px] text-muted-foreground tabular-nums">
                      {format(new Date(m.date), "MMM d, yyyy")}
                    </span>
                    <Badge variant="secondary" className="font-body text-[10px]">
                      {MILESTONE_ICON_MAP[m.type] || "📌"} {MILESTONE_TYPES.find((t) => t.value === m.type)?.label || m.type}
                    </Badge>
                  </div>
                  {m.notes && (
                    <p className="font-body text-[12px] text-muted-foreground mt-0.5">{m.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <AddMilestoneModal
        open={showMilestoneModal}
        onClose={() => setShowMilestoneModal(false)}
        accountId={account.id}
        existingMilestones={milestones}
        userId={user?.id}
      />
    </div>
  );
}

/* ── Checklist Row ─────────────────────────── */

function ChecklistRow({ item, form, setField }: {
  item: { key: string; label: string; type: string; notesKey?: string };
  form: Partial<Transition>;
  setField: (key: any, value: any) => void;
}) {
  const val = (form as any)[item.key];

  if (item.type === "date") {
    return (
      <div className="flex items-center gap-3">
        <Checkbox
          checked={!!val}
          onCheckedChange={(checked) => {
            if (!checked) setField(item.key as any, null);
            else setField(item.key as any, new Date().toISOString().slice(0, 10));
          }}
        />
        <span className="font-body text-[13px] text-foreground flex-1">{item.label}</span>
        <Input
          type="date"
          value={val || ""}
          onChange={(e) => setField(item.key as any, e.target.value || null)}
          className="w-40 h-8 text-[12px] font-data"
        />
      </div>
    );
  }

  if (item.type === "bool_notes") {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <Checkbox checked={!!val} onCheckedChange={(checked) => setField(item.key as any, !!checked)} />
          <span className="font-body text-[13px] text-foreground flex-1">{item.label}</span>
        </div>
        {val && item.notesKey && (
          <Textarea
            placeholder="Notes…"
            value={(form as any)[item.notesKey] || ""}
            onChange={(e) => setField(item.notesKey as any, e.target.value)}
            className="ml-7 text-[12px] min-h-[60px]"
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Checkbox checked={!!val} onCheckedChange={(checked) => setField(item.key as any, !!checked)} />
      <span className="font-body text-[13px] text-foreground">{item.label}</span>
    </div>
  );
}

/* ── Add Milestone Modal ───────────────────── */

function AddMilestoneModal({ open, onClose, accountId, existingMilestones, userId }: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  existingMilestones: MilestoneEntry[];
  userId?: string;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState("contract");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const addMutation = useMutation({
    mutationFn: async () => {
      const newEntry: MilestoneEntry = {
        id: crypto.randomUUID(),
        type,
        date,
        notes: notes.trim(),
        created_at: new Date().toISOString(),
      };
      const updated = [...existingMilestones, newEntry];

      // Upsert into account_context — row may not exist yet
      const { error } = await supabase
        .from("account_context")
        .upsert(
          { account_id: accountId, transition_log: updated as any, updated_at: new Date().toISOString(), updated_by: userId },
          { onConflict: "account_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Milestone added");
      qc.invalidateQueries({ queryKey: ["transition_log", accountId] });
      onClose();
      setNotes("");
      setType("contract");
    },
    onError: (e: any) => toast.error("Failed to add milestone", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-[18px]">Add Milestone</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MILESTONE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.icon} {t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">Notes</Label>
            <Textarea
              placeholder="Details about this milestone…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-[12px] min-h-[60px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={addMutation.isPending} onClick={() => addMutation.mutate()}>
            {addMutation.isPending ? "Adding…" : "Add Milestone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
