import { useState, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useChangelog, useAddChangelogEntry, useDeleteChangelogEntry, type ChangelogEntry } from "@/hooks/useChangelogApi";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  GitCommitHorizontal, Plus, Loader2, TrendingUp, TrendingDown,
  AlertTriangle, Info, Trash2, Filter, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow, isToday, isYesterday, isThisWeek, parseISO } from "date-fns";

const SEVERITY_CONFIG: Record<string, { icon: typeof Info; color: string; dotColor: string; label: string }> = {
  positive: { icon: TrendingUp, color: "text-verdant", dotColor: "bg-verdant", label: "Positive" },
  negative: { icon: TrendingDown, color: "text-destructive", dotColor: "bg-destructive", label: "Negative" },
  critical: { icon: AlertTriangle, color: "text-destructive", dotColor: "bg-destructive", label: "Critical" },
  info: { icon: Info, color: "text-muted-foreground", dotColor: "bg-muted-foreground", label: "Info" },
};

const TYPE_LABELS: Record<string, string> = {
  roas_spike: "ROAS Spike",
  roas_drop: "ROAS Drop",
  spend_surge: "Spend Surge",
  spend_cut: "Spend Cut",
  status_change: "Status Change",
  fatigue_alert: "Fatigue Alert",
  manual: "Manual Note",
};

function groupByDate(entries: ChangelogEntry[]): { label: string; entries: ChangelogEntry[] }[] {
  const groups: Map<string, ChangelogEntry[]> = new Map();
  for (const entry of entries) {
    const d = parseISO(entry.created_at);
    let label: string;
    if (isToday(d)) label = "Today";
    else if (isYesterday(d)) label = "Yesterday";
    else if (isThisWeek(d)) label = "This Week";
    else label = format(d, "MMMM yyyy");
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }
  return Array.from(groups.entries()).map(([label, entries]) => ({ label, entries }));
}

export default function ChangelogPage() {
  const { selectedAccountId, accounts } = useAccountContext();
  const { isBuilder, isEmployee } = useAuth();
  const canAdd = isBuilder || isEmployee;

  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: entries = [], isLoading } = useChangelog(selectedAccountId || undefined);

  const filtered = useMemo(() => {
    let result = entries;
    if (typeFilter !== "all") result = result.filter(e => e.change_type === typeFilter);
    if (severityFilter !== "all") result = result.filter(e => e.severity === severityFilter);
    return result;
  }, [entries, typeFilter, severityFilter]);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-heading text-[32px] text-forest flex items-center gap-3">
              <GitCommitHorizontal className="h-7 w-7 text-verdant" />
              Performance Changelog
            </h1>
            <p className="font-body text-[14px] text-slate font-light mt-1">
              Track significant changes to creative performance over time
            </p>
          </div>
          {canAdd && (
            <Button onClick={() => setShowAddModal(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add Entry
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[150px] h-8 font-body text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-[130px] h-8 font-body text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severity</SelectItem>
              <SelectItem value="positive">Positive</SelectItem>
              <SelectItem value="negative">Negative</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <span className="font-body text-[12px] text-muted-foreground ml-auto">
            {filtered.length} entries
          </span>
        </div>

        {/* Timeline */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-panel p-16 text-center">
            <GitCommitHorizontal className="h-12 w-12 mx-auto text-muted-foreground/20 mb-4" />
            <h3 className="font-heading text-[18px] text-forest mb-2">No changelog entries yet</h3>
            <p className="font-body text-[13px] text-muted-foreground">
              Performance changes will appear here as they're detected or manually added.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map((group) => (
              <div key={group.label}>
                <h3 className="font-label text-[11px] uppercase tracking-[0.08em] text-sage mb-3 flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  {group.label}
                </h3>
                <div className="relative pl-6 border-l-2 border-border-light space-y-4">
                  {group.entries.map((entry) => (
                    <ChangelogRow key={entry.id} entry={entry} canDelete={canAdd} accounts={accounts} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Entry Modal */}
      {showAddModal && (
        <AddEntryModal
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          accountId={selectedAccountId}
          accounts={accounts}
        />
      )}
    </AppLayout>
  );
}

function ChangelogRow({ entry, canDelete, accounts }: { entry: ChangelogEntry; canDelete: boolean; accounts: any[] }) {
  const deleteEntry = useDeleteChangelogEntry();
  const config = SEVERITY_CONFIG[entry.severity] || SEVERITY_CONFIG.info;
  const Icon = config.icon;
  const acctName = accounts.find((a: any) => a.id === entry.account_id)?.name || entry.account_id;

  return (
    <div className="relative group">
      {/* Timeline dot */}
      <div className={cn("absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-background", config.dotColor)} />

      <div className="glass-panel p-4 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className={cn("h-4 w-4 flex-shrink-0", config.color)} />
            <span className="font-body text-[14px] font-semibold text-charcoal">{entry.title}</span>
            <Badge variant="outline" className="font-label text-[9px] uppercase tracking-wider h-5">
              {TYPE_LABELS[entry.change_type] || entry.change_type}
            </Badge>
            {entry.created_by === null && (
              <Badge variant="secondary" className="font-label text-[9px] uppercase tracking-wider h-5">Auto</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="font-body text-[11px] text-muted-foreground whitespace-nowrap">
              {formatDistanceToNow(parseISO(entry.created_at), { addSuffix: true })}
            </span>
            {canDelete && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => deleteEntry.mutate(entry.id)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
        </div>

        {entry.description && (
          <p className="font-body text-[13px] text-slate leading-relaxed">{entry.description}</p>
        )}

        <div className="flex items-center gap-3 text-[11px] font-body text-muted-foreground">
          <span>{acctName}</span>
          {entry.metric_name && (
            <>
              <span>·</span>
              <span>{entry.metric_name}</span>
            </>
          )}
          {entry.old_value != null && entry.new_value != null && (
            <>
              <span>·</span>
              <span className="font-data tabular-nums">
                {entry.old_value.toFixed(2)} → {entry.new_value.toFixed(2)}
              </span>
            </>
          )}
          {entry.pct_change != null && (
            <span className={cn("font-data font-medium tabular-nums", entry.pct_change >= 0 ? "text-verdant" : "text-destructive")}>
              {entry.pct_change >= 0 ? "+" : ""}{entry.pct_change.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AddEntryModal({ open, onClose, accountId, accounts }: {
  open: boolean;
  onClose: () => void;
  accountId: string | null;
  accounts: any[];
}) {
  const addEntry = useAddChangelogEntry();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("info");
  const [acctId, setAcctId] = useState(accountId && accountId !== "all" ? accountId : accounts[0]?.id || "");

  const handleSubmit = async () => {
    if (!title.trim() || !acctId) return;
    await addEntry.mutateAsync({
      account_id: acctId,
      title: title.trim(),
      description: description.trim() || undefined,
      change_type: "manual",
      severity,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-white rounded-[8px] shadow-modal">
        <DialogHeader>
          <DialogTitle className="font-heading text-[18px] text-forest">Add Changelog Entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="font-label text-[11px] uppercase tracking-wider text-sage block mb-1">Account</label>
            <Select value={acctId} onValueChange={setAcctId}>
              <SelectTrigger className="h-9 font-body text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="font-label text-[11px] uppercase tracking-wider text-sage block mb-1">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Paused underperforming UGC batch"
              className="font-body text-[13px]"
            />
          </div>
          <div>
            <label className="font-label text-[11px] uppercase tracking-wider text-sage block mb-1">Description (optional)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context about this change..."
              rows={3}
              className="font-body text-[13px] resize-y"
            />
          </div>
          <div>
            <label className="font-label text-[11px] uppercase tracking-wider text-sage block mb-1">Severity</label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="h-9 font-body text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">ℹ️ Info</SelectItem>
                <SelectItem value="positive">✅ Positive</SelectItem>
                <SelectItem value="negative">⚠️ Negative</SelectItem>
                <SelectItem value="critical">🔴 Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSubmit} disabled={!title.trim() || addEntry.isPending} className="w-full">
            {addEntry.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Add Entry
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
