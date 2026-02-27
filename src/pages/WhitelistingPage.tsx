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
import { useCreators, type Creator } from "@/hooks/useCreatorsApi";
import {
  useWhitelistingDeals,
  useUpsertWhitelistingDeal,
  useDeleteWhitelistingDeal,
  type WhitelistingDeal,
} from "@/hooks/useWhitelistingApi";
import { useCreatives } from "@/hooks/useCreatives";
import {
  Plus, AlertTriangle, Share2, Clock, Trash2, Handshake,
} from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

const STATUSES = ["active", "pending", "expired"] as const;
type DealStatus = typeof STATUSES[number];

const STATUS_META: Record<DealStatus, { label: string; color: string; bgColor: string }> = {
  active: { label: "Active", color: "text-verdant", bgColor: "bg-emerald-50 border-emerald-200" },
  pending: { label: "Pending", color: "text-amber-700", bgColor: "bg-amber-50 border-amber-200" },
  expired: { label: "Expired", color: "text-destructive", bgColor: "bg-red-50 border-red-200" },
};

function daysUntilExpiry(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function ExpiryCell({ date }: { date: string | null }) {
  const days = daysUntilExpiry(date);
  if (!date) return <span className="text-muted-foreground">—</span>;
  const formatted = new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  if (days !== null && days < 0) {
    return <span className="font-data text-[12px] text-destructive tabular-nums">{formatted} <Badge variant="destructive" className="font-label text-[9px] ml-1">Expired</Badge></span>;
  }
  if (days !== null && days <= 14) {
    return <span className="font-data text-[12px] text-destructive tabular-nums">{formatted} <Badge className="bg-red-100 text-red-700 border-0 font-label text-[9px] ml-1">{days}d left</Badge></span>;
  }
  return <span className="font-data text-[12px] text-muted-foreground tabular-nums">{formatted}</span>;
}

// ── Deal Form Modal ──────────────────────────────────
function DealFormModal({ deal, accountId, creators, onClose }: {
  deal?: WhitelistingDeal;
  accountId: string;
  creators: Creator[];
  onClose: () => void;
}) {
  const upsert = useUpsertWhitelistingDeal();
  const deleteDeal = useDeleteWhitelistingDeal();

  const [creatorName, setCreatorName] = useState(deal?.creator_name || "");
  const [creatorId, setCreatorId] = useState(deal?.creator_id || "");
  const [platform, setPlatform] = useState(deal?.platform || "meta");
  const [status, setStatus] = useState(deal?.status || "active");
  const [accessGranted, setAccessGranted] = useState(deal?.access_granted_at || "");
  const [accessExpires, setAccessExpires] = useState(deal?.access_expires_at || "");
  const [notes, setNotes] = useState(deal?.notes || "");
  const [spendToDate, setSpendToDate] = useState(String(deal?.spend_to_date ?? 0));

  const handleCreatorSelect = (id: string) => {
    setCreatorId(id);
    if (id === "__manual__") return;
    const c = creators.find((cr) => cr.id === id);
    if (c) setCreatorName(c.name);
  };

  const handleSave = () => {
    if (!creatorName.trim()) return;
    upsert.mutate(
      {
        id: deal?.id,
        account_id: accountId,
        creator_id: creatorId && creatorId !== "__manual__" ? creatorId : null,
        creator_name: creatorName.trim(),
        platform,
        status,
        access_granted_at: accessGranted || null,
        access_expires_at: accessExpires || null,
        notes: notes.trim() || null,
        spend_to_date: Number(spendToDate) || 0,
      } as any,
      { onSuccess: () => onClose() },
    );
  };

  const handleDelete = () => {
    if (!deal?.id) return;
    deleteDeal.mutate(deal.id, { onSuccess: () => onClose() });
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-heading text-foreground">
          {deal ? "Edit Whitelist Deal" : "Add Whitelist Deal"}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        {/* Creator link */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Link to Creator</Label>
            <Select value={creatorId || "__manual__"} onValueChange={handleCreatorSelect}>
              <SelectTrigger className="h-8 text-[13px]"><SelectValue placeholder="Type name manually" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__manual__">Type name manually</SelectItem>
                {creators.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}{c.handle ? ` (${c.handle})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Creator Name *</Label>
            <Input value={creatorName} onChange={(e) => setCreatorName(e.target.value)} className="h-8 text-[13px]" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Platform</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="meta">Meta</SelectItem>
                <SelectItem value="tiktok">TikTok</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Access Granted</Label>
            <Input type="date" value={accessGranted} onChange={(e) => setAccessGranted(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-label text-[10px] uppercase tracking-wider">Access Expires</Label>
            <Input type="date" value={accessExpires} onChange={(e) => setAccessExpires(e.target.value)} className="h-8 text-[13px]" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="font-label text-[10px] uppercase tracking-wider">Spend to Date ($)</Label>
          <Input type="number" value={spendToDate} onChange={(e) => setSpendToDate(e.target.value)} className="h-8 text-[13px]" />
        </div>

        <div className="space-y-1.5">
          <Label className="font-label text-[10px] uppercase tracking-wider">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-[13px] min-h-[50px]" placeholder="Additional notes…" />
        </div>
      </div>
      <DialogFooter className="mt-3">
        {deal && (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive mr-auto" onClick={handleDelete} disabled={deleteDeal.isPending}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!creatorName.trim() || upsert.isPending}
          className="bg-verdant text-white hover:bg-verdant/90">
          {deal ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Whitelisted creatives helper ──────────────────────
const WL_PATTERN = /\bwhl\b|\bwhitelist(?:ing|ed)?\b/i;

function isWhitelistedCreative(adName: string) {
  return WL_PATTERN.test(adName);
}

// ── Main Page ──────────────────────────────────────
const WhitelistingPage = () => {
  const { selectedAccountId } = useAccountContext();
  const { data: deals = [], isLoading } = useWhitelistingDeals(selectedAccountId);
  const { data: creators = [] } = useCreators(selectedAccountId);
  const { data: creativesResult } = useCreatives(
    selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {},
    0,
  );
  const allCreatives = creativesResult?.data || [];

  const [formOpen, setFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<WhitelistingDeal | undefined>();
  const [tab, setTab] = useState<string>("active");

  // Auto-detect whitelisted creatives
  const whitelistedCreatives = useMemo(
    () => allCreatives.filter((c: any) => isWhitelistedCreative(c.ad_name || "")),
    [allCreatives],
  );

  // Deals expiring within 14 days
  const expiringSoon = useMemo(
    () => deals.filter((d) => {
      if (d.status !== "active") return false;
      const days = daysUntilExpiry(d.access_expires_at);
      return days !== null && days >= 0 && days <= 14;
    }),
    [deals],
  );

  // Filter deals by tab
  const filtered = useMemo(
    () => deals.filter((d) => d.status === tab),
    [deals, tab],
  );

  const openForm = (deal?: WhitelistingDeal) => {
    setEditingDeal(deal);
    setFormOpen(true);
  };

  if (!selectedAccountId || selectedAccountId === "all") {
    return (
      <AppLayout>
        <PageHeader title="Whitelisting" description="Select a specific account to manage whitelist deals." />
        <div className="glass-panel py-16 text-center">
          <Share2 className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-body text-[14px] text-muted-foreground">Select a single account to view whitelisting deals.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Whitelisting"
        description="Run ads through a creator's personal page instead of the brand page."
        actions={
          <Button size="sm" onClick={() => openForm()} className="gap-1.5 bg-verdant text-white hover:bg-verdant/90">
            <Plus className="h-3.5 w-3.5" />Add Deal
          </Button>
        }
      />

      {/* Expiration alerts */}
      {expiringSoon.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-card border border-amber-200 bg-amber-50 mb-6">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-body text-[13px] font-semibold text-amber-800">
              {expiringSoon.length} deal{expiringSoon.length > 1 ? "s" : ""} expiring within 14 days
            </p>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {expiringSoon.map((d) => {
                const days = daysUntilExpiry(d.access_expires_at)!;
                return (
                  <button key={d.id} onClick={() => openForm(d)}
                    className="flex items-center gap-1.5 text-[12px] font-body text-amber-700 hover:text-amber-900 transition-colors">
                    <Clock className="h-3 w-3" />
                    <span className="font-medium">{d.creator_name}</span>
                    <span className="text-amber-600">({days}d left)</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Status tabs */}
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="active" className="gap-1.5 font-body text-[13px]">
            Active
            <Badge variant="secondary" className="font-data text-[11px] h-5 min-w-5 justify-center ml-1">
              {deals.filter((d) => d.status === "active").length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5 font-body text-[13px]">
            Pending
            <Badge variant="secondary" className="font-data text-[11px] h-5 min-w-5 justify-center ml-1">
              {deals.filter((d) => d.status === "pending").length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="expired" className="gap-1.5 font-body text-[13px]">
            Expired
            <Badge variant="secondary" className="font-data text-[11px] h-5 min-w-5 justify-center ml-1">
              {deals.filter((d) => d.status === "expired").length}
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
          <Share2 className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-heading text-[18px] text-foreground mb-1">No {tab} deals</h3>
          <p className="font-body text-[13px] text-muted-foreground mb-4">
            {tab === "active" ? "Start tracking creator whitelist partnerships." : `No deals with "${tab}" status.`}
          </p>
          {tab === "active" && (
            <Button size="sm" onClick={() => openForm()} className="gap-1.5 bg-verdant text-white hover:bg-verdant/90">
              <Plus className="h-3.5 w-3.5" />Add Deal
            </Button>
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Creator</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Platform</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Access Expires</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Spend to Date</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Status</TableHead>
              <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((d) => (
              <TableRow key={d.id} className="cursor-pointer hover:bg-accent/50" onClick={() => openForm(d)}>
                <TableCell>
                  <div className="font-body text-[13px] font-semibold text-foreground">{d.creator_name}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-label text-[9px] capitalize">{d.platform}</Badge>
                </TableCell>
                <TableCell><ExpiryCell date={d.access_expires_at} /></TableCell>
                <TableCell className="font-data text-[13px] text-right tabular-nums">
                  ${(d.spend_to_date || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell>
                  <Badge className={cn("font-label text-[9px] border-0",
                    STATUS_META[d.status as DealStatus]?.bgColor,
                    STATUS_META[d.status as DealStatus]?.color,
                  )}>
                    {STATUS_META[d.status as DealStatus]?.label || d.status}
                  </Badge>
                </TableCell>
                <TableCell className="font-body text-[12px] text-muted-foreground max-w-[200px] truncate">
                  {d.notes || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Auto-linked whitelisted creatives */}
      {whitelistedCreatives.length > 0 && (
        <div className="mt-8">
          <h3 className="font-heading text-[15px] text-foreground mb-3 flex items-center gap-2">
            <Handshake className="h-4 w-4 text-verdant" />
            Auto-Detected Whitelisted Creatives
            <Badge variant="secondary" className="font-data text-[11px]">{whitelistedCreatives.length}</Badge>
          </h3>
          <p className="font-body text-[12px] text-muted-foreground mb-3">
            Creatives with "WHL", "whitelist", or "whitelisting" in the ad name are automatically tagged.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {whitelistedCreatives.slice(0, 9).map((c: any) => (
              <div key={c.ad_id} className="flex items-center gap-3 p-3 rounded-card border border-border-light bg-card">
                <span className="text-lg">🤝</span>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[13px] font-medium text-foreground truncate">{c.ad_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-data text-[11px] text-muted-foreground tabular-nums">
                      {(c.roas || 0).toFixed(2)}x ROAS
                    </span>
                    <span className="font-data text-[11px] text-muted-foreground tabular-nums">
                      ${(c.spend || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
                <Badge className="bg-emerald-50 text-verdant border-0 font-label text-[9px]">Whitelisted</Badge>
              </div>
            ))}
          </div>
          {whitelistedCreatives.length > 9 && (
            <p className="font-body text-[12px] text-muted-foreground mt-2">
              + {whitelistedCreatives.length - 9} more whitelisted creatives
            </p>
          )}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(v) => !v && setFormOpen(false)}>
        {formOpen && (
          <DealFormModal
            deal={editingDeal}
            accountId={selectedAccountId}
            creators={creators}
            onClose={() => setFormOpen(false)}
          />
        )}
      </Dialog>
    </AppLayout>
  );
};

export default WhitelistingPage;
