import { useState } from "react";
import { useChangelog, useAddChangelogEntry, type ChangelogEntry } from "@/hooks/useChangelogApi";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { GitCommitHorizontal, Plus, Loader2, TrendingUp, TrendingDown, AlertTriangle, Info, Zap, PauseCircle, TestTube, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, parseISO } from "date-fns";

const EVENT_ICON: Record<string, typeof Info> = {
  roas_change: TrendingUp,
  spend_change: TrendingDown,
  status_change: AlertTriangle,
  new_creative: Zap,
  creative_paused: PauseCircle,
  threshold_crossed: TrendingUp,
  test_result: TestTube,
  note_added: MessageSquare,
};

const EVENT_COLOR: Record<string, string> = {
  roas_change: "text-verdant",
  spend_change: "text-amber-600",
  status_change: "text-destructive",
  new_creative: "text-primary",
  creative_paused: "text-muted-foreground",
  threshold_crossed: "text-verdant",
  test_result: "text-primary",
  note_added: "text-muted-foreground",
};

const EVENT_LABELS: Record<string, string> = {
  roas_change: "ROAS Change",
  spend_change: "Spend Change",
  status_change: "Status Change",
  new_creative: "New Creative",
  creative_paused: "Creative Paused",
  threshold_crossed: "Threshold Crossed",
  test_result: "Test Result",
  note_added: "Note",
};

export function CreativeChangelog({ adId, accountId }: { adId: string; accountId: string }) {
  const { data: entries = [], isLoading } = useChangelog(accountId, adId);
  const { isBuilder, isEmployee } = useAuth();
  const canAdd = isBuilder || isEmployee;
  const [showForm, setShowForm] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-label text-[11px] font-semibold uppercase tracking-wider text-charcoal flex items-center gap-1.5">
          <GitCommitHorizontal className="h-3.5 w-3.5" /> History
        </h3>
        {canAdd && !showForm && (
          <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" onClick={() => setShowForm(true)}>
            <Plus className="h-3 w-3" /> Log Note
          </Button>
        )}
      </div>

      {showForm && (
        <LogNoteForm adId={adId} accountId={accountId} onClose={() => setShowForm(false)} />
      )}

      {entries.length === 0 && !showForm ? (
        <p className="font-body text-[12px] text-muted-foreground">No history entries for this creative yet.</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {entries.slice(0, 15).map((entry) => {
            const Icon = EVENT_ICON[entry.event_type] || Info;
            const color = EVENT_COLOR[entry.event_type] || "text-muted-foreground";
            return (
              <div key={entry.id} className="flex items-start gap-2">
                <Icon className={cn("h-3.5 w-3.5 mt-0.5 flex-shrink-0", color)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-body text-[12px] font-medium text-charcoal truncate">{entry.description}</span>
                    {entry.created_by === null && (
                      <Badge variant="secondary" className="font-label text-[8px] uppercase tracking-wider h-4 px-1">Auto</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-label text-[8px] uppercase tracking-wider h-4 px-1">
                      {EVENT_LABELS[entry.event_type] || entry.event_type}
                    </Badge>
                    {entry.old_value != null && entry.new_value != null && (
                      <span className="font-data text-[10px] tabular-nums text-muted-foreground">
                        {entry.old_value.toFixed(2)} → {entry.new_value.toFixed(2)}
                      </span>
                    )}
                    <span className="font-body text-[10px] text-sage">
                      {formatDistanceToNow(parseISO(entry.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LogNoteForm({ adId, accountId, onClose }: { adId: string; accountId: string; onClose: () => void }) {
  const addEntry = useAddChangelogEntry();
  const [description, setDescription] = useState("");
  const [eventType, setEventType] = useState("note_added");

  const handleSubmit = async () => {
    if (!description.trim()) return;
    await addEntry.mutateAsync({
      account_id: accountId,
      ad_id: adId,
      event_type: eventType,
      description: description.trim(),
    });
    onClose();
  };

  return (
    <div className="border border-border-light rounded-md p-3 space-y-2 bg-muted/30">
      <Select value={eventType} onValueChange={setEventType}>
        <SelectTrigger className="h-7 font-body text-[11px] w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="note_added">📝 Note</SelectItem>
          <SelectItem value="status_change">⚡ Status Change</SelectItem>
        </SelectContent>
      </Select>
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What happened with this creative?"
        rows={2}
        className="font-body text-[12px] resize-none"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-6 text-[11px]" onClick={handleSubmit} disabled={!description.trim() || addEntry.isPending}>
          {addEntry.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Save
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
