import { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Copy, Check } from "lucide-react";
import { useHooks, useIncrementHookUsage, type Hook } from "@/hooks/useHooksApi";
import { useAccountContext } from "@/contexts/AccountContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "question", label: "Question" },
  { value: "statement", label: "Statement" },
  { value: "social_proof", label: "Social Proof" },
  { value: "problem", label: "Problem" },
  { value: "curiosity", label: "Curiosity" },
  { value: "contrarian", label: "Contrarian" },
  { value: "story", label: "Story" },
];

const CATEGORY_COLORS: Record<string, string> = {
  question: "bg-blue-50 text-blue-700",
  statement: "bg-emerald-50 text-emerald-700",
  statistic: "bg-violet-50 text-violet-700",
  social_proof: "bg-amber-50 text-amber-700",
  problem: "bg-red-50 text-red-700",
  curiosity: "bg-cyan-50 text-cyan-700",
  contrarian: "bg-orange-50 text-orange-700",
  story: "bg-pink-50 text-pink-700",
};

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect?: (hookText: string) => void;
}

export function HookBrowserModal({ open, onClose, onSelect }: Props) {
  const { selectedAccountId } = useAccountContext();
  const { data: hooks = [] } = useHooks(selectedAccountId || undefined);
  const incrementUsage = useIncrementHookUsage();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = hooks;
    if (category !== "all") list = list.filter(h => h.category === category);
    if (search.length >= 2) {
      const q = search.toLowerCase();
      list = list.filter(h => h.hook_text.toLowerCase().includes(q));
    }
    return list.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
  }, [hooks, category, search]);

  const handleUse = (hook: Hook) => {
    if (onSelect) {
      onSelect(hook.hook_text);
      incrementUsage.mutate(hook.id);
      onClose();
    } else {
      navigator.clipboard.writeText(hook.hook_text);
      incrementUsage.mutate(hook.id);
      setCopiedId(hook.id);
      toast.success("Hook copied to clipboard");
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[70vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border-light">
          <DialogTitle className="font-heading text-[16px]">Hook Library</DialogTitle>
          <DialogDescription className="font-body text-[12px] text-muted-foreground">Browse and use hooks from the library</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 space-y-3 border-b border-border-light">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search hooks…"
              className="pl-9 h-8 font-body text-[12px]"
            />
          </div>
          <Tabs value={category} onValueChange={setCategory}>
            <TabsList className="h-7 bg-muted/50 p-0.5 flex-wrap">
              {CATEGORIES.map(c => (
                <TabsTrigger key={c.value} value={c.value} className="font-body text-[10px] px-2 py-1">
                  {c.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {filtered.length === 0 ? (
            <p className="py-8 text-center font-body text-[13px] text-muted-foreground">No hooks found</p>
          ) : (
            filtered.map(hook => {
              const catLabel = CATEGORIES.find(c => c.value === hook.category)?.label || hook.category;
              return (
                <button
                  key={hook.id}
                  onClick={() => handleUse(hook)}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-accent/60 transition-colors group flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-[13px] text-foreground leading-snug">"{hook.hook_text}"</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className={cn("font-label text-[8px] uppercase border-0 px-1.5 py-0", CATEGORY_COLORS[hook.category] || "bg-muted text-muted-foreground")}>
                        {catLabel}
                      </Badge>
                      {hook.avg_hook_rate != null && hook.avg_hook_rate > 0 && (
                        <span className="font-data text-[10px] text-muted-foreground tabular-nums">
                          {(hook.avg_hook_rate * 100).toFixed(1)}%
                        </span>
                      )}
                      {hook.usage_count > 0 && (
                        <span className="font-data text-[10px] text-muted-foreground">{hook.usage_count} uses</span>
                      )}
                    </div>
                  </div>
                  <span className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground">
                    {copiedId === hook.id ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
