import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import {
  useSplitTests, useSplitTestVariants,
  useCreateSplitTest, useUpdateSplitTest, useDeleteSplitTest,
  type SplitTest, type SplitTestVariant,
} from "@/hooks/useSplitTestsApi";
import { extractConceptRoot } from "@/lib/conceptGrouping";
import {
  Plus, FlaskConical, Trophy, AlertTriangle, Trash2, Search,
  ChevronDown, ChevronUp, Lightbulb, X,
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";

const VARIABLES = ["hook", "format", "creator", "cta", "angle", "offer", "other"] as const;
const VARIABLE_LABELS: Record<string, string> = {
  hook: "Hook", format: "Format", creator: "Creator", cta: "CTA",
  angle: "Angle", offer: "Offer", other: "Other",
};
const STATUS_META: Record<string, { label: string; color: string; bgColor: string }> = {
  running: { label: "Running", color: "text-blue-700", bgColor: "bg-blue-50 border-blue-200" },
  complete: { label: "Complete", color: "text-verdant", bgColor: "bg-emerald-50 border-emerald-200" },
  inconclusive: { label: "Inconclusive", color: "text-amber-700", bgColor: "bg-amber-50 border-amber-200" },
};

const DEFAULT_LABELS = ["Control", "Variant A", "Variant B", "Variant C"];

// ── Auto-winner detection logic ──────────────────────
function detectWinner(
  variants: SplitTestVariant[],
  creativesMap: Map<string, any>,
  minimumSpend: number,
): { winnerId: string | null; reason: string } {
  const withMetrics = variants.map((v) => {
    const c = creativesMap.get(v.ad_id);
    return {
      ...v,
      spend: Number(c?.spend) || 0,
      roas: Number(c?.roas) || 0,
    };
  });

  const spendThreshold = minimumSpend * 2;
  const qualifying = withMetrics.filter((v) => v.spend >= spendThreshold);
  if (qualifying.length < 2) return { winnerId: null, reason: "Not enough spend to declare winner" };

  const sorted = [...qualifying].sort((a, b) => b.roas - a.roas);
  const best = sorted[0];
  const second = sorted[1];

  if (second.roas <= 0) {
    return { winnerId: best.ad_id, reason: `${best.label} has positive ROAS while others don't` };
  }
  const advantage = (best.roas - second.roas) / second.roas;
  if (advantage >= 0.15) {
    return {
      winnerId: best.ad_id,
      reason: `${best.label} has ${(advantage * 100).toFixed(0)}% ROAS advantage (${best.roas.toFixed(2)}x vs ${second.roas.toFixed(2)}x)`,
    };
  }
  return { winnerId: null, reason: "No variant has >15% ROAS advantage yet" };
}

// ── Creative Search / Select ──────────────────────
function CreativeSearch({
  creatives,
  selected,
  onToggle,
}: {
  creatives: any[];
  selected: Set<string>;
  onToggle: (adId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return creatives.slice(0, 50);
    const q = search.toLowerCase();
    return creatives.filter((c: any) => (c.ad_name || "").toLowerCase().includes(q)).slice(0, 50);
  }, [creatives, search]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search creatives by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-[13px] pl-8"
        />
      </div>
      <div className="max-h-[200px] overflow-y-auto border border-border-light rounded-md">
        {filtered.length === 0 ? (
          <p className="p-3 text-[12px] text-muted-foreground text-center">No creatives found</p>
        ) : (
          filtered.map((c: any) => (
            <label
              key={c.ad_id}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-accent/50 border-b border-border-light last:border-0 transition-colors",
                selected.has(c.ad_id) && "bg-accent/30",
              )}
            >
              <Checkbox
                checked={selected.has(c.ad_id)}
                onCheckedChange={() => onToggle(c.ad_id)}
                disabled={!selected.has(c.ad_id) && selected.size >= 4}
              />
              <div className="min-w-0 flex-1">
                <p className="font-body text-[12px] font-medium text-foreground truncate">{c.ad_name}</p>
                <div className="flex gap-2 mt-0.5">
                  <span className="font-data text-[10px] text-muted-foreground tabular-nums">
                    {(c.roas || 0).toFixed(2)}x ROAS
                  </span>
                  <span className="font-data text-[10px] text-muted-foreground tabular-nums">
                    ${(c.spend || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} spend
                  </span>
                </div>
              </div>
            </label>
          ))
        )}
      </div>
      {selected.size > 0 && (
        <p className="font-body text-[11px] text-muted-foreground">{selected.size}/4 variants selected</p>
      )}
    </div>
  );
}

// ── New Test Modal ──────────────────────
function NewTestModal({
  accountId,
  creatives,
  onClose,
}: {
  accountId: string;
  creatives: any[];
  onClose: () => void;
}) {
  const createTest = useCreateSplitTest();
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [variable, setVariable] = useState("hook");
  const [minSpend, setMinSpend] = useState("500");
  const [selectedAds, setSelectedAds] = useState<Set<string>>(new Set());

  const toggleAd = useCallback((adId: string) => {
    setSelectedAds((prev) => {
      const next = new Set(prev);
      if (next.has(adId)) next.delete(adId);
      else if (next.size < 4) next.add(adId);
      return next;
    });
  }, []);

  const handleCreate = () => {
    if (!name.trim() || selectedAds.size < 2) return;
    const adIds = Array.from(selectedAds);
    createTest.mutate(
      {
        test: {
          account_id: accountId,
          name: name.trim(),
          hypothesis: hypothesis.trim() || null,
          variable_tested: variable,
          status: "running",
          winner_ad_id: null,
          start_date: new Date().toISOString().slice(0, 10),
          end_date: null,
          minimum_spend: Number(minSpend) || 500,
          notes: null,
        },
        variants: adIds.map((id, i) => ({ ad_id: id, label: DEFAULT_LABELS[i] || `Variant ${i}` })),
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-heading text-foreground">New Split Test</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        <div className="space-y-1.5">
          <Label className="font-label text-[10px] uppercase tracking-wider">Test Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-[13px]" placeholder="e.g. Hook A vs Hook B — Summer Campaign" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Variable Being Tested</Label>
            <Select value={variable} onValueChange={setVariable}>
              <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VARIABLES.map((v) => <SelectItem key={v} value={v}>{VARIABLE_LABELS[v]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Minimum Spend ($)</Label>
            <Input type="number" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} className="h-8 text-[13px]" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="font-label text-[10px] uppercase tracking-wider">Hypothesis</Label>
          <Textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} className="text-[13px] min-h-[50px]" placeholder="What do you expect to happen?" />
        </div>

        <div className="space-y-1.5">
          <Label className="font-label text-[10px] uppercase tracking-wider">Select 2–4 Variants *</Label>
          <CreativeSearch creatives={creatives} selected={selectedAds} onToggle={toggleAd} />
        </div>
      </div>
      <DialogFooter className="mt-3">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={!name.trim() || selectedAds.size < 2 || createTest.isPending}
          className="bg-verdant text-white hover:bg-verdant/90"
        >
          Create Test
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Test Detail (head-to-head comparison) ──────────────────────
function TestDetailView({
  test,
  variants,
  creativesMap,
  onClose,
  onUpdate,
  onDelete,
}: {
  test: SplitTest;
  variants: SplitTestVariant[];
  creativesMap: Map<string, any>;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<SplitTest>) => void;
  onDelete: (id: string) => void;
}) {
  const { winnerId, reason } = detectWinner(variants, creativesMap, test.minimum_spend);
  const [notes, setNotes] = useState(test.notes || "");
  const [showNotes, setShowNotes] = useState(false);

  const handleComplete = () => {
    onUpdate(test.id, {
      status: winnerId ? "complete" : "inconclusive",
      winner_ad_id: winnerId,
      end_date: new Date().toISOString().slice(0, 10),
      notes: notes.trim() || null,
    });
  };

  const daysRunning = test.start_date
    ? Math.ceil((Date.now() - new Date(test.start_date).getTime()) / 86400000)
    : 0;

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="font-heading text-foreground flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-verdant" />
          {test.name}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 max-h-[65vh] overflow-y-auto">
        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <Badge className={cn("font-label text-[9px] border-0", STATUS_META[test.status]?.bgColor, STATUS_META[test.status]?.color)}>
            {STATUS_META[test.status]?.label || test.status}
          </Badge>
          {test.variable_tested && (
            <Badge variant="outline" className="font-label text-[9px]">
              Testing: {VARIABLE_LABELS[test.variable_tested] || test.variable_tested}
            </Badge>
          )}
          <span className="font-data text-muted-foreground tabular-nums">{daysRunning}d running</span>
          <span className="font-data text-muted-foreground tabular-nums">Min spend: ${test.minimum_spend}</span>
        </div>

        {test.hypothesis && (
          <div className="p-3 bg-muted/50 rounded-card border border-border-light">
            <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Hypothesis</p>
            <p className="font-body text-[13px] text-foreground">{test.hypothesis}</p>
          </div>
        )}

        {/* Winner detection */}
        <div className={cn(
          "p-3 rounded-card border",
          winnerId ? "border-emerald-200 bg-emerald-50" : "border-border-light bg-muted/30",
        )}>
          <p className="font-body text-[12px] text-muted-foreground">{reason}</p>
        </div>

        {/* Head-to-head variant cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {variants.map((v) => {
            const c = creativesMap.get(v.ad_id);
            const isWinner = winnerId === v.ad_id;
            const spend = Number(c?.spend) || 0;
            const roas = Number(c?.roas) || 0;
            const cpa = Number(c?.cpa) || 0;
            const ctr = Number(c?.ctr) || 0;
            const purchases = Number(c?.purchases) || 0;

            return (
              <div
                key={v.id}
                className={cn(
                  "rounded-card border p-3 space-y-2",
                  isWinner ? "border-verdant bg-emerald-50/50 ring-1 ring-verdant/20" : "border-border-light bg-card",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-body text-[13px] font-semibold text-foreground">{v.label}</span>
                  {isWinner && <Trophy className="h-4 w-4 text-verdant" />}
                </div>

                {/* Thumbnail */}
                {c?.thumbnail_url && (
                  <div className="aspect-video rounded-md overflow-hidden bg-muted">
                    <img src={c.thumbnail_url} alt={c.ad_name} className="w-full h-full object-contain" />
                  </div>
                )}

                <p className="font-body text-[11px] text-muted-foreground truncate">{c?.ad_name || v.ad_id}</p>

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 border-t border-border-light">
                  <div>
                    <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">ROAS</p>
                    <p className={cn("font-data text-[14px] tabular-nums font-semibold", roas >= 2 ? "text-verdant" : roas < 1 ? "text-destructive" : "text-foreground")}>
                      {roas.toFixed(2)}x
                    </p>
                  </div>
                  <div>
                    <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">Spend</p>
                    <p className="font-data text-[14px] tabular-nums text-foreground">${spend.toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
                  </div>
                  <div>
                    <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">CPA</p>
                    <p className="font-data text-[13px] tabular-nums text-foreground">${cpa.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">CTR</p>
                    <p className="font-data text-[13px] tabular-nums text-foreground">{ctr.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">Purchases</p>
                    <p className="font-data text-[13px] tabular-nums text-foreground">{purchases}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Notes */}
        {test.status === "running" && (
          <div className="space-y-2">
            <button onClick={() => setShowNotes(!showNotes)} className="flex items-center gap-1 font-body text-[12px] text-muted-foreground hover:text-foreground transition-colors">
              {showNotes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Add notes & close test
            </button>
            {showNotes && (
              <div className="space-y-2">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-[13px] min-h-[50px]" placeholder="What was learned from this test?" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleComplete} className="bg-verdant text-white hover:bg-verdant/90">
                    {winnerId ? "Declare Winner & Close" : "Mark Inconclusive & Close"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {test.status !== "running" && test.notes && (
          <div className="p-3 bg-muted/50 rounded-card border border-border-light">
            <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Learnings</p>
            <p className="font-body text-[13px] text-foreground">{test.notes}</p>
          </div>
        )}
      </div>

      <DialogFooter className="mt-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive mr-auto"
          onClick={() => { onDelete(test.id); onClose(); }}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
        </Button>
        <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Suggestion Card ──────────────────────
function SuggestionCard({
  conceptRoot,
  ads,
  onCreateTest,
}: {
  conceptRoot: string;
  ads: any[];
  onCreateTest: (adIds: string[]) => void;
}) {
  return (
    <div className="rounded-card border border-border-light bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
        <span className="font-body text-[13px] font-medium text-foreground truncate">{conceptRoot}</span>
        <Badge variant="secondary" className="font-data text-[10px]">{ads.length} variants</Badge>
      </div>
      <div className="flex flex-wrap gap-1">
        {ads.slice(0, 4).map((a: any) => (
          <span key={a.ad_id} className="font-body text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded truncate max-w-[160px]">
            {a.ad_name}
          </span>
        ))}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[11px] gap-1"
        onClick={() => onCreateTest(ads.slice(0, 4).map((a: any) => a.ad_id))}
      >
        <Plus className="h-3 w-3" />Track as Test
      </Button>
    </div>
  );
}

// ── Main Page ──────────────────────
const TestsPage = () => {
  const { selectedAccountId } = useAccountContext();
  const { data: tests = [], isLoading } = useSplitTests(selectedAccountId);
  const testIds = useMemo(() => tests.map((t) => t.id), [tests]);
  const { data: allVariants = [] } = useSplitTestVariants(testIds);
  const { data: allCreatives = [] } = useAllCreatives(
    selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {},
  );

  const [tab, setTab] = useState("running");
  const [newTestOpen, setNewTestOpen] = useState(false);
  const [viewingTest, setViewingTest] = useState<SplitTest | null>(null);
  const [prefilledAds, setPrefilledAds] = useState<string[] | null>(null);

  const updateTest = useUpdateSplitTest();
  const deleteTest = useDeleteSplitTest();

  // Creative lookup map
  const creativesMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of allCreatives) m.set(c.ad_id, c);
    return m;
  }, [allCreatives]);

  // Variants grouped by test
  const variantsByTest = useMemo(() => {
    const m = new Map<string, SplitTestVariant[]>();
    for (const v of allVariants) {
      if (!m.has(v.test_id)) m.set(v.test_id, []);
      m.get(v.test_id)!.push(v);
    }
    return m;
  }, [allVariants]);

  // Filtered tests by status
  const filtered = useMemo(() => tests.filter((t) => t.status === tab), [tests, tab]);

  // Auto-detect potential tests (concept groups with 2+ iterations, not already tracked)
  const suggestions = useMemo(() => {
    const trackedAdIds = new Set(allVariants.map((v) => v.ad_id));
    const groups = new Map<string, any[]>();
    for (const c of allCreatives) {
      if (trackedAdIds.has(c.ad_id)) continue;
      const root = extractConceptRoot(c.ad_name || "");
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(c);
    }
    return Array.from(groups.entries())
      .filter(([, ads]) => ads.length >= 2 && ads.length <= 6)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6);
  }, [allCreatives, allVariants]);

  const handleCreateFromSuggestion = (adIds: string[]) => {
    setPrefilledAds(adIds);
    setNewTestOpen(true);
  };

  if (!selectedAccountId || selectedAccountId === "all") {
    return (
      <AppLayout>
        <PageHeader title="Split Tests" description="Select a specific account to manage tests." />
        <div className="glass-panel py-16 text-center">
          <FlaskConical className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-body text-[14px] text-muted-foreground">Select a single account to view split tests.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Split Tests"
        description="Track structured A/B tests — one variable changed, everything else equal."
        actions={
          <Button size="sm" onClick={() => { setPrefilledAds(null); setNewTestOpen(true); }} className="gap-1.5 bg-verdant text-white hover:bg-verdant/90">
            <Plus className="h-3.5 w-3.5" />New Test
          </Button>
        }
      />

      {/* Status tabs */}
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="running" className="gap-1.5 font-body text-[13px]">
            Running
            <Badge variant="secondary" className="font-data text-[11px] h-5 min-w-5 justify-center ml-1">
              {tests.filter((t) => t.status === "running").length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="complete" className="gap-1.5 font-body text-[13px]">
            Complete
            <Badge variant="secondary" className="font-data text-[11px] h-5 min-w-5 justify-center ml-1">
              {tests.filter((t) => t.status === "complete").length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="inconclusive" className="gap-1.5 font-body text-[13px]">
            Inconclusive
            <Badge variant="secondary" className="font-data text-[11px] h-5 min-w-5 justify-center ml-1">
              {tests.filter((t) => t.status === "inconclusive").length}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel py-16 text-center">
          <FlaskConical className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-heading text-[18px] text-foreground mb-1">No {tab} tests</h3>
          <p className="font-body text-[13px] text-muted-foreground mb-4">
            {tab === "running" ? "Start a structured A/B test to compare creatives." : `No tests with "${tab}" status.`}
          </p>
          {tab === "running" && (
            <Button size="sm" onClick={() => { setPrefilledAds(null); setNewTestOpen(true); }} className="gap-1.5 bg-verdant text-white hover:bg-verdant/90">
              <Plus className="h-3.5 w-3.5" />New Test
            </Button>
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Test</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Variable</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Variants</TableHead>
              {tab === "running" && (
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Days</TableHead>
              )}
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Current Leader</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Spend</TableHead>
              {tab !== "running" && (
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Winner</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((t) => {
              const tvs = variantsByTest.get(t.id) || [];
              const daysRunning = t.start_date
                ? Math.ceil(((t.end_date ? new Date(t.end_date).getTime() : Date.now()) - new Date(t.start_date).getTime()) / 86400000)
                : 0;
              const totalSpend = tvs.reduce((s, v) => s + (Number(creativesMap.get(v.ad_id)?.spend) || 0), 0);
              const leader = [...tvs].sort((a, b) => (Number(creativesMap.get(b.ad_id)?.roas) || 0) - (Number(creativesMap.get(a.ad_id)?.roas) || 0))[0];
              const leaderCreative = leader ? creativesMap.get(leader.ad_id) : null;
              const winnerVariant = t.winner_ad_id ? tvs.find((v) => v.ad_id === t.winner_ad_id) : null;

              return (
                <TableRow key={t.id} className="cursor-pointer hover:bg-accent/50" onClick={() => setViewingTest(t)}>
                  <TableCell>
                    <div className="font-body text-[13px] font-semibold text-foreground">{t.name}</div>
                    {t.hypothesis && <div className="font-body text-[11px] text-muted-foreground truncate max-w-[200px]">{t.hypothesis}</div>}
                  </TableCell>
                  <TableCell>
                    {t.variable_tested && (
                      <Badge variant="outline" className="font-label text-[9px]">
                        {VARIABLE_LABELS[t.variable_tested] || t.variable_tested}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {tvs.map((v) => (
                        <Badge key={v.id} variant="secondary" className="font-label text-[9px]">{v.label}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  {tab === "running" && (
                    <TableCell className="font-data text-[13px] tabular-nums text-foreground">{daysRunning}d</TableCell>
                  )}
                  <TableCell>
                    {leader && (
                      <div className="flex items-center gap-1.5">
                        <Trophy className="h-3 w-3 text-verdant" />
                        <span className="font-body text-[12px] font-medium text-foreground">{leader.label}</span>
                        <span className="font-data text-[11px] text-muted-foreground tabular-nums">
                          {(Number(leaderCreative?.roas) || 0).toFixed(2)}x
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-data text-[13px] text-right tabular-nums">
                    ${totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </TableCell>
                  {tab !== "running" && (
                    <TableCell>
                      {winnerVariant ? (
                        <div className="flex items-center gap-1">
                          <Trophy className="h-3 w-3 text-verdant" />
                          <span className="font-body text-[12px] font-medium text-foreground">{winnerVariant.label}</span>
                        </div>
                      ) : (
                        <span className="font-body text-[12px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Auto-detect suggestions */}
      {tab === "running" && suggestions.length > 0 && (
        <div className="mt-8">
          <h3 className="font-heading text-[15px] text-foreground mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            Potential Tests Detected
          </h3>
          <p className="font-body text-[12px] text-muted-foreground mb-3">
            Creatives with similar names that might be worth tracking as structured tests.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {suggestions.map(([root, ads]) => (
              <SuggestionCard key={root} conceptRoot={root} ads={ads} onCreateTest={handleCreateFromSuggestion} />
            ))}
          </div>
        </div>
      )}

      {/* New Test Dialog */}
      <Dialog open={newTestOpen} onOpenChange={(v) => !v && setNewTestOpen(false)}>
        {newTestOpen && (
          <NewTestModal
            accountId={selectedAccountId}
            creatives={allCreatives}
            onClose={() => setNewTestOpen(false)}
          />
        )}
      </Dialog>

      {/* Test Detail Dialog */}
      <Dialog open={!!viewingTest} onOpenChange={(v) => !v && setViewingTest(null)}>
        {viewingTest && (
          <TestDetailView
            test={viewingTest}
            variants={variantsByTest.get(viewingTest.id) || []}
            creativesMap={creativesMap}
            onClose={() => setViewingTest(null)}
            onUpdate={(id, updates) => {
              updateTest.mutate({ id, updates }, { onSuccess: () => setViewingTest(null) });
            }}
            onDelete={(id) => {
              deleteTest.mutate(id);
              setViewingTest(null);
            }}
          />
        )}
      </Dialog>
    </AppLayout>
  );
};

export default TestsPage;
