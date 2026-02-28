import { useState, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Plus, Download, Trash2, ExternalLink } from "lucide-react";
import { useHooks, useCreateHook, useDeleteHook, useImportHooksFromCreatives, type Hook } from "@/hooks/useHooksApi";
import { useAccountContext } from "@/contexts/AccountContext";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "question", label: "Question" },
  { value: "statement", label: "Statement" },
  { value: "statistic", label: "Statistic" },
  { value: "social_proof", label: "Social Proof" },
  { value: "problem", label: "Problem" },
  { value: "curiosity", label: "Curiosity" },
  { value: "contrarian", label: "Contrarian" },
  { value: "story", label: "Story" },
];

const SORT_OPTIONS = [
  { value: "usage", label: "Most Used" },
  { value: "hook_rate", label: "Best Hook Rate" },
  { value: "newest", label: "Newest" },
];

const CATEGORY_COLORS: Record<string, string> = {
  question: "bg-blue-50 text-blue-700 border-blue-200",
  statement: "bg-emerald-50 text-emerald-700 border-emerald-200",
  statistic: "bg-violet-50 text-violet-700 border-violet-200",
  social_proof: "bg-amber-50 text-amber-700 border-amber-200",
  problem: "bg-red-50 text-red-700 border-red-200",
  curiosity: "bg-cyan-50 text-cyan-700 border-cyan-200",
  contrarian: "bg-orange-50 text-orange-700 border-orange-200",
  story: "bg-pink-50 text-pink-700 border-pink-200",
};

export default function HooksPage() {
  const { selectedAccountId } = useAccountContext();
  const { data: hooks = [], isLoading } = useHooks(selectedAccountId || undefined);
  const createHook = useCreateHook();
  const deleteHook = useDeleteHook();
  const importHooks = useImportHooksFromCreatives();

  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [addOpen, setAddOpen] = useState(false);
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState("statement");

  const filtered = useMemo(() => {
    let list = hooks;
    if (category !== "all") list = list.filter(h => h.category === category);
    if (search.length >= 2) {
      const q = search.toLowerCase();
      list = list.filter(h => h.hook_text.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      if (sort === "usage") return (b.usage_count || 0) - (a.usage_count || 0);
      if (sort === "hook_rate") return (b.avg_hook_rate || 0) - (a.avg_hook_rate || 0);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return list;
  }, [hooks, category, search, sort]);

  const handleAdd = async () => {
    if (!newText.trim()) return;
    await createHook.mutateAsync({
      account_id: selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : null,
      category: newCategory,
      hook_text: newText.trim(),
    });
    setNewText("");
    setNewCategory("statement");
    setAddOpen(false);
  };

  const handleImport = () => {
    if (!selectedAccountId || selectedAccountId === "all") return;
    importHooks.mutate(selectedAccountId);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader title="Hook Library" description="Save, organize, and reuse high-performing hooks" />

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search hooks…"
              className="pl-9 h-9 font-body text-[13px]"
            />
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[150px] h-9 font-body text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="font-body text-[13px]">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2 ml-auto">
            {selectedAccountId && selectedAccountId !== "all" && (
              <Button variant="outline" size="sm" className="gap-1.5 font-body text-[12px]" onClick={handleImport} disabled={importHooks.isPending}>
                <Download className="h-3.5 w-3.5" />
                Import from Top Creatives
              </Button>
            )}
            <Button size="sm" className="gap-1.5 font-body text-[12px]" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add Hook
            </Button>
          </div>
        </div>

        {/* Category tabs */}
        <Tabs value={category} onValueChange={setCategory}>
          <TabsList className="h-9 bg-muted/50 p-1">
            {CATEGORIES.map(c => (
              <TabsTrigger key={c.value} value={c.value} className="font-body text-[12px] px-3 py-1.5 data-[state=active]:bg-card data-[state=active]:shadow-card">
                {c.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <Card key={i} className="p-5 animate-pulse">
                <div className="h-4 bg-muted rounded w-3/4 mb-3" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center">
            <p className="font-body text-[14px] text-muted-foreground">No hooks found. Add one or import from top creatives.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(hook => (
              <HookCard key={hook.id} hook={hook} onDelete={() => deleteHook.mutate(hook.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Add Hook Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Hook</DialogTitle>
            <DialogDescription>Save a hook to the library for reuse in briefs and creatives.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Hook Text</Label>
              <Textarea
                value={newText}
                onChange={e => setNewText(e.target.value)}
                placeholder="The opening 3-second hook text…"
                className="font-body text-[13px] min-h-[80px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Category</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="h-9 font-body text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.filter(c => c.value !== "all").map(c => (
                    <SelectItem key={c.value} value={c.value} className="font-body text-[13px]">{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleAdd} disabled={!newText.trim() || createHook.isPending}>
              Save Hook
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function HookCard({ hook, onDelete }: { hook: Hook; onDelete: () => void }) {
  const catColor = CATEGORY_COLORS[hook.category] || "bg-muted text-muted-foreground";
  const catLabel = CATEGORIES.find(c => c.value === hook.category)?.label || hook.category;

  return (
    <Card className="p-5 flex flex-col gap-3 group hover:shadow-card-hover transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <p className="font-body text-[15px] font-medium text-foreground leading-snug flex-1">
          "{hook.hook_text}"
        </p>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className={cn("font-label text-[9px] uppercase tracking-wider border", catColor)}>
          {catLabel}
        </Badge>
        {hook.avg_hook_rate != null && hook.avg_hook_rate > 0 && (
          <span className="font-data text-[11px] text-muted-foreground tabular-nums">
            {(hook.avg_hook_rate * 100).toFixed(1)}% hook rate
          </span>
        )}
        {hook.usage_count > 0 && (
          <span className="font-data text-[11px] text-muted-foreground tabular-nums">
            {hook.usage_count} uses
          </span>
        )}
      </div>

      {hook.source_ad_id && (
        <span className="font-body text-[10px] text-muted-foreground flex items-center gap-1">
          <ExternalLink className="h-3 w-3" /> Linked to creative
        </span>
      )}
    </Card>
  );
}
