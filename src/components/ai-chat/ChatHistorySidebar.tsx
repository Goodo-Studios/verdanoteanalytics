import { useMemo } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ConversationSummary } from "@/hooks/useAIChatHistory";
import { isToday, isThisWeek } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDeleted: () => void;
}

interface Group {
  label: string;
  items: ConversationSummary[];
}

export function ChatHistorySidebar({ conversations, activeId, onSelect, onNewChat, onDeleted }: Props) {
  const groups = useMemo<Group[]>(() => {
    const today: ConversationSummary[] = [];
    const week: ConversationSummary[] = [];
    const earlier: ConversationSummary[] = [];

    for (const c of conversations) {
      const d = new Date(c.created_at);
      if (isToday(d)) today.push(c);
      else if (isThisWeek(d, { weekStartsOn: 1 })) week.push(c);
      else earlier.push(c);
    }

    const result: Group[] = [];
    if (today.length) result.push({ label: "Today", items: today });
    if (week.length) result.push({ label: "This week", items: week });
    if (earlier.length) result.push({ label: "Earlier", items: earlier });
    return result;
  }, [conversations]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const { error } = await supabase.from("ai_conversations").delete().eq("id", id);
    if (error) toast.error("Failed to delete conversation");
    else onDeleted();
  };

  return (
    <div className="w-56 shrink-0 border-r border-border flex flex-col h-full bg-card/50">
      <div className="p-3 border-b border-border">
        <Button size="sm" variant="outline" onClick={onNewChat} className="w-full gap-1.5 text-[12px] font-body">
          <Plus className="h-3.5 w-3.5" />New chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {groups.length === 0 && (
          <p className="font-body text-[11px] text-muted-foreground text-center pt-6">No conversations yet</p>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground px-2 mb-1">{g.label}</p>
            <div className="space-y-0.5">
              {g.items.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className={`group w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                    c.id === activeId
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50 text-foreground"
                  }`}
                >
                  <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="font-body text-[11px] truncate flex-1">{c.preview}</span>
                  <button
                    onClick={(e) => handleDelete(e, c.id)}
                    className="hidden group-hover:flex h-5 w-5 items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
