import { useState, useEffect, useCallback } from "react";
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
import { Calendar, Plus, Save, Clock, FileText, Users, Rocket, BarChart3, RefreshCw } from "lucide-react";
import { format } from "date-fns";

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

interface TimelineEvent {
  id: string;
  account_id: string;
  event_type: string;
  event_date: string;
  title: string;
  notes: string | null;
  metadata: any;
  created_at: string;
}

const EVENT_TYPES = [
  { value: "client_joined", label: "Client Joined" },
  { value: "first_winner", label: "First Winning Creative" },
  { value: "first_report", label: "First Report Delivered" },
  { value: "renewal", label: "Renewal / Contract Extension" },
  { value: "creative_direction", label: "Creative Direction Change" },
  { value: "budget_change", label: "Budget Change" },
  { value: "milestone", label: "Other Milestone" },
];

const EVENT_ICONS: Record<string, string> = {
  client_joined: "🚀",
  first_winner: "🏆",
  first_report: "📊",
  renewal: "🔄",
  creative_direction: "🎨",
  budget_change: "💰",
  milestone: "⭐",
};

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

function useTimelineEvents(accountId: string) {
  return useQuery({
    queryKey: ["client_timeline", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_timeline_events" as any)
        .select("*")
        .eq("account_id", accountId)
        .order("event_date", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as TimelineEvent[];
    },
    enabled: !!accountId,
  });
}

/* ── Component ─────────────────────────────── */

interface Props {
  account: any;
}

export function TransitionTab({ account }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: transition, isLoading: loadingTransition } = useTransition(account.id);
  const { data: events = [], isLoading: loadingEvents } = useTimelineEvents(account.id);

  // Local checklist state
  const [form, setForm] = useState<Partial<Transition>>({});
  const [dirty, setDirty] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);

  // Sync form from fetched data
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

  // Save checklist
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

  // Checklist completion
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

  const totalDone = checklistItems.filter((item) => {
    const val = (form as any)[item.key];
    return item.type === "date" ? !!val : item.type === "bool_notes" ? !!val : !!val;
  }).length;

  const progress = Math.round((totalDone / checklistItems.length) * 100);

  return (
    <div className="max-w-3xl space-y-8">
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

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="space-y-3">
          {checklistItems.map((item) => (
            <ChecklistRow
              key={item.key}
              item={item}
              form={form}
              setField={setField}
            />
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {saveMutation.isPending ? "Saving…" : "Save Checklist"}
          </Button>
        </div>
      </section>

      {/* HEALTH TIMELINE */}
      <section className="glass-panel p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-[18px] text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" /> Client Health Timeline
            </h2>
            <p className="font-body text-[12px] text-muted-foreground mt-1">
              Key relationship milestones
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowEventModal(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Event
          </Button>
        </div>

        {loadingEvents ? (
          <div className="py-8 text-center text-muted-foreground font-body text-[13px]">Loading…</div>
        ) : events.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground font-body text-[13px]">
            No timeline events yet. Add the first milestone.
          </div>
        ) : (
          <div className="relative pl-6 space-y-0">
            {/* Vertical line */}
            <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />
            {events.map((ev, i) => (
              <div key={ev.id} className="relative flex items-start gap-3 py-3">
                {/* Dot */}
                <div className="absolute left-[-15px] top-[18px] w-3 h-3 rounded-full border-2 border-primary bg-card z-10" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-body text-[11px] text-muted-foreground tabular-nums">
                      {format(new Date(ev.event_date), "MMM d, yyyy")}
                    </span>
                    <Badge variant="secondary" className="font-body text-[10px]">
                      {EVENT_ICONS[ev.event_type] || "📌"} {EVENT_TYPES.find((t) => t.value === ev.event_type)?.label || ev.event_type}
                    </Badge>
                  </div>
                  <p className="font-body text-[13px] text-foreground mt-0.5">{ev.title}</p>
                  {ev.notes && (
                    <p className="font-body text-[12px] text-muted-foreground mt-0.5">{ev.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add Event Modal */}
      <AddTimelineEventModal
        open={showEventModal}
        onClose={() => setShowEventModal(false)}
        accountId={account.id}
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
          <Checkbox
            checked={!!val}
            onCheckedChange={(checked) => setField(item.key as any, !!checked)}
          />
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

  // bool
  return (
    <div className="flex items-center gap-3">
      <Checkbox
        checked={!!val}
        onCheckedChange={(checked) => setField(item.key as any, !!checked)}
      />
      <span className="font-body text-[13px] text-foreground">{item.label}</span>
    </div>
  );
}

/* ── Add Timeline Event Modal ──────────────── */

function AddTimelineEventModal({ open, onClose, accountId, userId }: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  userId?: string;
}) {
  const qc = useQueryClient();
  const [eventType, setEventType] = useState("milestone");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("client_timeline_events" as any).insert({
        account_id: accountId,
        event_type: eventType,
        event_date: eventDate,
        title,
        notes: notes || null,
        created_by: userId,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Timeline event added");
      qc.invalidateQueries({ queryKey: ["client_timeline", accountId] });
      onClose();
      setTitle("");
      setNotes("");
      setEventType("milestone");
    },
    onError: (e: any) => toast.error("Failed to add event", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-[18px]">Add Timeline Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">Event Type</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {EVENT_ICONS[t.value]} {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">Date</Label>
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="h-9 text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">Title</Label>
            <Input
              placeholder={eventType === "budget_change" ? "e.g. Budget: $10k → $15k" : "Event description…"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-9 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[11px] uppercase tracking-wider">Notes (optional)</Label>
            <Textarea
              placeholder="Additional details…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-[12px] min-h-[60px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!title.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
            {addMutation.isPending ? "Adding…" : "Add Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
