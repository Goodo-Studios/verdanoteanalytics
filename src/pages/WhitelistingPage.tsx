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
import { useAccountContext } from "@/contexts/AccountContext";
import { useCreators, useUpsertCreator, type Creator } from "@/hooks/useCreatorsApi";
import { useCreatives } from "@/hooks/useCreatives";
import {
  Plus, Pencil, AlertTriangle, Kanban, List, Users, Clock,
} from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

const WL_STATUSES = ["outreach", "negotiating", "active", "expired"] as const;
type WlStatus = typeof WL_STATUSES[number];

const STATUS_META: Record<WlStatus, { label: string; color: string; bgColor: string }> = {
  outreach: { label: "Outreach", color: "text-blue-700", bgColor: "bg-blue-50 border-blue-200" },
  negotiating: { label: "Negotiating", color: "text-amber-700", bgColor: "bg-amber-50 border-amber-200" },
  active: { label: "Active", color: "text-verdant", bgColor: "bg-emerald-50 border-emerald-200" },
  expired: { label: "Expired", color: "text-destructive", bgColor: "bg-red-50 border-red-200" },
};

const DEAL_TYPES = ["flat_fee", "rev_share", "hybrid", "gifted"] as const;
const DEAL_LABELS: Record<string, string> = {
  flat_fee: "Flat Fee", rev_share: "Rev Share", hybrid: "Hybrid", gifted: "Gifted",
};
const PLATFORMS = ["meta", "tiktok", "youtube", "instagram", "x", "other"] as const;

function daysUntilExpiry(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

function ExpiryBadge({ contractEnd }: { contractEnd: string | null }) {
  const days = daysUntilExpiry(contractEnd);
  if (days === null) return null;
  if (days < 0) return <Badge variant="destructive" className="font-label text-[9px]">Expired</Badge>;
  if (days <= 7) return <Badge className="bg-red-100 text-red-700 border-0 font-label text-[9px]">Expires in {days}d</Badge>;
  if (days <= 14) return <Badge className="bg-amber-100 text-amber-700 border-0 font-label text-[9px]">Expires in {days}d</Badge>;
  return null;
}

// ── Deal Form Modal ──────────────────────────────────────
function DealFormModal({ creator, accountId, onClose }: {
  creator?: Creator;
  accountId: string;
  onClose: () => void;
}) {
  const upsert = useUpsertCreator();
  const [name, setName] = useState(creator?.name || "");
  const [handle, setHandle] = useState(creator?.handle || "");
  const [type, setType] = useState(creator?.type || "whitelisted");
  const [platform, setPlatform] = useState(creator?.platform || "meta");
  const [dealType, setDealType] = useState(creator?.deal_type || "flat_fee");
  const [rate, setRate] = useState(creator?.rate || "");
  const [contractStart, setContractStart] = useState(creator?.contract_start || "");
  const [contractEnd, setContractEnd] = useState(creator?.contract_end || "");
  const [wlStatus, setWlStatus] = useState<string>(creator?.wl_status || "outreach");
  const [wlPageName, setWlPageName] = useState(creator?.wl_page_name || "");
  const [wlPageId, setWlPageId] = useState(creator?.wl_page_id || "");
  const [notes, setNotes] = useState(creator?.notes || "");

  const handleSave = () => {
    if (!name.trim()) return;
    upsert.mutate(
      {
        id: creator?.id,
        account_id: accountId,
        name: name.trim(),
        handle: handle.trim() || null,
        type,
        notes: notes.trim() || null,
        deal_type: dealType,
        rate: rate.trim() || null,
        platform,
        contract_start: contractStart || null,
        contract_end: contractEnd || null,
        wl_status: wlStatus,
        wl_page_name: wlPageName.trim() || null,
        wl_page_id: wlPageId.trim() || null,
      } as any,
      { onSuccess: () => onClose() }
    );
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-heading text-foreground">
          {creator ? "Edit Whitelist Deal" : "New Whitelist Deal"}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        {/* Creator info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Creator Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Handle</Label>
            <Input value={handle} onChange={(e) => setHandle(e.target.value)} className="h-8 text-[13px]" placeholder="@handle" />
          </div>
        </div>

        {/* Deal details */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Platform</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => <SelectItem key={p} value={p} className="capitalize">{p === "x" ? "X (Twitter)" : p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Status</Label>
            <Select value={wlStatus} onValueChange={setWlStatus}>
              <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WL_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Deal Type</Label>
            <Select value={dealType} onValueChange={setDealType}>
              <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEAL_TYPES.map((d) => <SelectItem key={d} value={d}>{DEAL_LABELS[d]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Rate / Terms</Label>
            <Input value={rate} onChange={(e) => setRate(e.target.value)} className="h-8 text-[13px]" placeholder="e.g. $500/mo or 15%" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Contract Start</Label>
            <Input type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Contract End</Label>
            <Input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} className="h-8 text-[13px]" />
          </div>
        </div>

        {/* Page access */}
        <div className="border-t border-border-light pt-3">
          <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Ad Account / Page Access</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="font-label text-[10px] uppercase tracking-wider">Page Name</Label>
              <Input value={wlPageName} onChange={(e) => setWlPageName(e.target.value)} className="h-8 text-[13px]" placeholder="Creator's page name" />
            </div>
            <div className="space-y-1.5">
              <Label className="font-label text-[10px] uppercase tracking-wider">Page / Account ID</Label>
              <Input value={wlPageId} onChange={(e) => setWlPageId(e.target.value)} className="h-8 text-[13px]" placeholder="External ID" />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="font-label text-[10px] uppercase tracking-wider">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-[13px] min-h-[50px]" placeholder="Additional notes…" />
        </div>
      </div>
      <DialogFooter className="mt-3">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!name.trim() || upsert.isPending}
          className="bg-verdant text-white hover:bg-verdant/90">
          {creator ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Kanban Card ──────────────────────────────────────
function KanbanCard({ creator, stats, onEdit }: {
  creator: Creator;
  stats: { count: number; totalSpend: number; avgRoas: number };
  onEdit: () => void;
}) {
  return (
    <div className="rounded-card border border-border-light bg-card p-3 shadow-card space-y-2 cursor-pointer hover:shadow-md transition-shadow"
      onClick={onEdit}>
      <div className="flex items-center justify-between">
        <span className="font-body text-[13px] font-semibold text-foreground truncate">{creator.name}</span>
        <ExpiryBadge contractEnd={creator.contract_end} />
      </div>
      {creator.handle && (
        <p className="font-body text-[11px] text-muted-foreground">{creator.handle}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {creator.platform && (
          <Badge variant="outline" className="font-label text-[9px] capitalize">{creator.platform}</Badge>
        )}
        {creator.deal_type && (
          <Badge variant="secondary" className="font-label text-[9px]">{DEAL_LABELS[creator.deal_type] || creator.deal_type}</Badge>
        )}
        {creator.rate && (
          <span className="font-data text-[11px] text-muted-foreground">{creator.rate}</span>
        )}
      </div>
      {creator.wl_page_name && (
        <p className="font-body text-[10px] text-muted-foreground">Page: {creator.wl_page_name}</p>
      )}
      {stats.count > 0 && (
        <div className="flex items-center gap-3 pt-1 border-t border-border-light">
          <span className="font-data text-[11px] text-foreground tabular-nums">{stats.count} ads</span>
          <span className="font-data text-[11px] text-foreground tabular-nums">{stats.avgRoas.toFixed(2)}x</span>
          <span className="font-data text-[11px] text-muted-foreground tabular-nums">${stats.totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────
const WhitelistingPage = () => {
  const { selectedAccountId } = useAccountContext();
  const { data: allCreators = [], isLoading } = useCreators(selectedAccountId);
  const { data: allCreativesResult } = useCreatives(
    selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {},
    0
  );
  const allCreatives = allCreativesResult?.data || [];

  const [formOpen, setFormOpen] = useState(false);
  const [editingCreator, setEditingCreator] = useState<Creator | undefined>();
  const [view, setView] = useState<"kanban" | "table">("kanban");

  // Filter to only whitelisted creators (those with a wl_status other than 'none')
  const wlCreators = useMemo(
    () => allCreators.filter((c) => c.wl_status && c.wl_status !== "none"),
    [allCreators]
  );

  // Per-creator stats
  const creatorStats = useMemo(() => {
    const stats = new Map<string, { count: number; totalSpend: number; avgRoas: number }>();
    const grouped = new Map<string, any[]>();
    for (const c of allCreatives) {
      const cid = (c as any).creator_id;
      if (!cid) continue;
      if (!grouped.has(cid)) grouped.set(cid, []);
      grouped.get(cid)!.push(c);
    }
    for (const [cid, items] of grouped) {
      const withSpend = items.filter((c: any) => (Number(c.spend) || 0) > 0);
      const totalSpend = items.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
      const avgRoas = withSpend.length > 0 ? withSpend.reduce((s: number, c: any) => s + (Number(c.roas) || 0), 0) / withSpend.length : 0;
      stats.set(cid, { count: items.length, totalSpend, avgRoas });
    }
    return stats;
  }, [allCreatives]);

  // Expiring soon alert
  const expiringSoon = useMemo(() => {
    return wlCreators.filter((c) => {
      const days = daysUntilExpiry(c.contract_end);
      return days !== null && days >= 0 && days <= 14;
    });
  }, [wlCreators]);

  // Group by status for Kanban
  const byStatus = useMemo(() => {
    const groups: Record<WlStatus, Creator[]> = { outreach: [], negotiating: [], active: [], expired: [] };
    for (const c of wlCreators) {
      const status = (c.wl_status as WlStatus) || "outreach";
      if (groups[status]) groups[status].push(c);
      else groups.outreach.push(c);
    }
    return groups;
  }, [wlCreators]);

  const openForm = (creator?: Creator) => {
    setEditingCreator(creator);
    setFormOpen(true);
  };

  const fmt = (v: number, prefix = "", suffix = "") =>
    `${prefix}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;

  if (!selectedAccountId || selectedAccountId === "all") {
    return (
      <AppLayout>
        <PageHeader title="Whitelisting" description="Select a specific account to manage whitelist partnerships." />
        <div className="glass-panel py-16 text-center">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-body text-[14px] text-muted-foreground">Select a single account to view whitelisting deals.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Whitelisting"
        description="Track creator whitelist partnerships, deals, and ad account access."
        actions={
          <Button size="sm" onClick={() => openForm()} className="gap-1.5 bg-verdant text-white hover:bg-verdant/90">
            <Plus className="h-3.5 w-3.5" />New Deal
          </Button>
        }
      />

      {/* Expiration alerts */}
      {expiringSoon.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-card border border-amber-200 bg-amber-50 mb-6">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-body text-[13px] font-semibold text-amber-800">
              {expiringSoon.length} deal{expiringSoon.length > 1 ? "s" : ""} expiring soon
            </p>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {expiringSoon.map((c) => {
                const days = daysUntilExpiry(c.contract_end)!;
                return (
                  <button
                    key={c.id}
                    onClick={() => openForm(c)}
                    className="flex items-center gap-1.5 text-[12px] font-body text-amber-700 hover:text-amber-900 transition-colors"
                  >
                    <Clock className="h-3 w-3" />
                    <span className="font-medium">{c.name}</span>
                    <span className="text-amber-600">({days}d left)</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* View toggle */}
      <div className="flex items-center gap-2 mb-4">
        <Button
          size="sm"
          variant={view === "kanban" ? "default" : "outline"}
          onClick={() => setView("kanban")}
          className={cn("gap-1.5", view === "kanban" && "bg-verdant text-white hover:bg-verdant/90")}
        >
          <Kanban className="h-3.5 w-3.5" />Pipeline
        </Button>
        <Button
          size="sm"
          variant={view === "table" ? "default" : "outline"}
          onClick={() => setView("table")}
          className={cn("gap-1.5", view === "table" && "bg-verdant text-white hover:bg-verdant/90")}
        >
          <List className="h-3.5 w-3.5" />Table
        </Button>
        <div className="flex-1" />
        <span className="font-data text-[13px] text-muted-foreground tabular-nums">{wlCreators.length} deal{wlCreators.length !== 1 ? "s" : ""}</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : wlCreators.length === 0 ? (
        <div className="glass-panel py-16 text-center">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-heading text-[18px] text-foreground mb-1">No whitelist deals yet</h3>
          <p className="font-body text-[13px] text-muted-foreground mb-4">
            Start tracking creator partnerships and ad account access.
          </p>
          <Button size="sm" onClick={() => openForm()} className="gap-1.5 bg-verdant text-white hover:bg-verdant/90">
            <Plus className="h-3.5 w-3.5" />New Deal
          </Button>
        </div>
      ) : view === "kanban" ? (
        /* Kanban view */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {WL_STATUSES.map((status) => (
            <div key={status} className="space-y-3">
              <div className={cn("flex items-center justify-between px-3 py-2 rounded-card border", STATUS_META[status].bgColor)}>
                <span className={cn("font-label text-[11px] uppercase tracking-wider font-semibold", STATUS_META[status].color)}>
                  {STATUS_META[status].label}
                </span>
                <Badge variant="secondary" className="font-data text-[11px] h-5 min-w-5 justify-center">
                  {byStatus[status].length}
                </Badge>
              </div>
              <div className="space-y-2 min-h-[80px]">
                {byStatus[status].map((c) => (
                  <KanbanCard
                    key={c.id}
                    creator={c}
                    stats={creatorStats.get(c.id) || { count: 0, totalSpend: 0, avgRoas: 0 }}
                    onEdit={() => openForm(c)}
                  />
                ))}
                {byStatus[status].length === 0 && (
                  <div className="rounded-card border border-dashed border-border-light p-4 text-center">
                    <p className="font-body text-[11px] text-muted-foreground">No deals</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table view */
        <div className="glass-panel overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="bg-cream-dark">
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Creator</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Platform</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Status</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Deal</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Contract</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Page</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Ads</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">ROAS</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Spend</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wlCreators.map((c) => {
                const stats = creatorStats.get(c.id) || { count: 0, totalSpend: 0, avgRoas: 0 };
                const status = (c.wl_status as WlStatus) || "outreach";
                return (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-accent/50 border-b border-border-light" onClick={() => openForm(c)}>
                    <TableCell>
                      <div className="font-body text-[13px] font-semibold text-foreground">{c.name}</div>
                      {c.handle && <div className="font-body text-[11px] text-muted-foreground">{c.handle}</div>}
                    </TableCell>
                    <TableCell>
                      {c.platform && <Badge variant="outline" className="font-label text-[9px] capitalize">{c.platform}</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge className={cn("font-label text-[9px] border-0", STATUS_META[status]?.bgColor, STATUS_META[status]?.color)}>
                          {STATUS_META[status]?.label || status}
                        </Badge>
                        <ExpiryBadge contractEnd={c.contract_end} />
                      </div>
                    </TableCell>
                    <TableCell className="font-body text-[12px] text-foreground">
                      {c.deal_type && <span>{DEAL_LABELS[c.deal_type] || c.deal_type}</span>}
                      {c.rate && <span className="text-muted-foreground ml-1.5">· {c.rate}</span>}
                    </TableCell>
                    <TableCell className="font-data text-[12px] text-muted-foreground tabular-nums">
                      {c.contract_start && c.contract_end
                        ? `${new Date(c.contract_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(c.contract_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}`
                        : "—"}
                    </TableCell>
                    <TableCell className="font-body text-[12px] text-muted-foreground">
                      {c.wl_page_name || "—"}
                    </TableCell>
                    <TableCell className="font-data text-[13px] text-right tabular-nums">{stats.count}</TableCell>
                    <TableCell className="font-data text-[13px] text-right tabular-nums">{fmt(stats.avgRoas, "", "x")}</TableCell>
                    <TableCell className="font-data text-[13px] text-right tabular-nums">{fmt(stats.totalSpend, "$")}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openForm(c); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(v) => !v && setFormOpen(false)}>
        {formOpen && (
          <DealFormModal
            creator={editingCreator}
            accountId={selectedAccountId}
            onClose={() => setFormOpen(false)}
          />
        )}
      </Dialog>
    </AppLayout>
  );
};

export default WhitelistingPage;
