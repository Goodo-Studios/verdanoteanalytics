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
import { Checkbox } from "@/components/ui/checkbox";
import { useAccountContext } from "@/contexts/AccountContext";
import { useCreators, useUpsertCreator, useDeleteCreator, useCreativesByCreator, useLinkCreativesToCreator, type Creator } from "@/hooks/useCreatorsApi";
import { useCreatives } from "@/hooks/useCreatives";
import { useCachedMedia } from "@/hooks/useCachedMedia";
import { Plus, Pencil, Trash2, Link2, ArrowLeft, Search, LayoutGrid, Users } from "lucide-react";
import { useState, useMemo } from "react";

const CREATOR_TYPES = ["ugc", "whitelisted", "internal", "influencer"];
const TYPE_COLORS: Record<string, string> = {
  ugc: "bg-primary/10 text-primary",
  whitelisted: "bg-amber-100 text-amber-700",
  internal: "bg-blue-100 text-blue-700",
  influencer: "bg-purple-100 text-purple-700",
};

function CreatorForm({ creator, accountId, onClose }: { creator?: Creator; accountId: string; onClose: () => void }) {
  const upsert = useUpsertCreator();
  const [name, setName] = useState(creator?.name || "");
  const [handle, setHandle] = useState(creator?.handle || "");
  const [type, setType] = useState(creator?.type || "ugc");
  const [notes, setNotes] = useState(creator?.notes || "");

  const handleSave = () => {
    if (!name.trim()) return;
    upsert.mutate(
      { id: creator?.id, account_id: accountId, name: name.trim(), handle: handle.trim() || null, type, notes: notes.trim() || null },
      { onSuccess: () => onClose() }
    );
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="font-heading text-foreground">{creator ? "Edit Creator" : "Add Creator"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="font-label text-[11px] uppercase tracking-wider">Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-[13px] font-body" placeholder="Creator name" />
        </div>
        <div className="space-y-1.5">
          <Label className="font-label text-[11px] uppercase tracking-wider">Handle</Label>
          <Input value={handle} onChange={(e) => setHandle(e.target.value)} className="h-8 text-[13px] font-body" placeholder="@handle" />
        </div>
        <div className="space-y-1.5">
          <Label className="font-label text-[11px] uppercase tracking-wider">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-8 text-[13px] font-body"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CREATOR_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="font-label text-[11px] uppercase tracking-wider">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-[13px] font-body min-h-[60px]" placeholder="Optional notes…" />
        </div>
      </div>
      <DialogFooter className="mt-3">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!name.trim() || upsert.isPending}>
          {creator ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function LinkCreativesModal({ creatorId, accountId, onClose }: { creatorId: string; accountId: string; onClose: () => void }) {
  const { data: result } = useCreatives({ account_id: accountId }, 0);
  const creatives = result?.data || [];
  const link = useLinkCreativesToCreator();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!search) return creatives.slice(0, 50);
    const q = search.toLowerCase();
    return creatives.filter((c: any) => (c.ad_name || "").toLowerCase().includes(q)).slice(0, 50);
  }, [creatives, search]);

  const toggle = (adId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(adId)) next.delete(adId); else next.add(adId);
      return next;
    });
  };

  const handleLink = () => {
    if (selected.size === 0) return;
    link.mutate({ creatorId, adIds: [...selected] }, { onSuccess: () => onClose() });
  };

  return (
    <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle className="font-heading text-foreground">Link Creatives</DialogTitle>
      </DialogHeader>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8 text-[13px] font-body" placeholder="Search ad names…" />
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 min-h-[200px] max-h-[400px]">
        {filtered.map((c: any) => (
          <label key={c.ad_id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-accent cursor-pointer">
            <Checkbox checked={selected.has(c.ad_id)} onCheckedChange={() => toggle(c.ad_id)} className="h-3.5 w-3.5" />
            <CreativeThumb url={c.thumbnail_url} />
            <span className="font-body text-[12px] text-foreground truncate flex-1">{c.ad_name}</span>
          </label>
        ))}
        {filtered.length === 0 && <p className="text-center text-[13px] text-muted-foreground py-8">No creatives found</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleLink} disabled={selected.size === 0 || link.isPending}>
          Link {selected.size} creative{selected.size !== 1 ? "s" : ""}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function CreativeThumb({ url }: { url?: string }) {
  const { url: cachedUrl } = useCachedMedia(url);
  if (!url) return <div className="h-7 w-7 rounded bg-muted flex-shrink-0" />;
  return <img src={cachedUrl} alt="" className="h-7 w-7 rounded object-cover flex-shrink-0" />;
}

function CreatorDetail({ creator, accountId, onBack }: { creator: Creator; accountId: string; onBack: () => void }) {
  const { data: creatives = [] } = useCreativesByCreator(creator.id);
  const [linkOpen, setLinkOpen] = useState(false);

  const stats = useMemo(() => {
    const withSpend = creatives.filter((c: any) => (Number(c.spend) || 0) > 0);
    const totalSpend = creatives.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
    const avgRoas = withSpend.length > 0
      ? withSpend.reduce((s: number, c: any) => s + (Number(c.roas) || 0), 0) / withSpend.length
      : 0;
    return { count: creatives.length, totalSpend, avgRoas };
  }, [creatives]);

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 font-body text-[13px] text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Back to creators
      </button>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-heading text-[24px] text-foreground">{creator.name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <Badge className={`${TYPE_COLORS[creator.type] || TYPE_COLORS.ugc} capitalize font-label text-[10px] border-0`}>{creator.type}</Badge>
            {creator.handle && <span className="font-body text-[13px] text-muted-foreground">{creator.handle}</span>}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)} className="gap-1.5">
          <Link2 className="h-3.5 w-3.5" />Link Creatives
        </Button>
      </div>

      {creator.notes && <p className="font-body text-[13px] text-muted-foreground mb-4">{creator.notes}</p>}

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="font-data text-[20px] font-bold text-foreground tabular-nums">{stats.count}</p>
          <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Creatives</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="font-data text-[20px] font-bold text-foreground tabular-nums">{stats.avgRoas.toFixed(2)}x</p>
          <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Avg ROAS</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="font-data text-[20px] font-bold text-foreground tabular-nums">${stats.totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
          <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Total Spend</p>
        </div>
      </div>

      {creatives.length === 0 ? (
        <div className="bg-card border border-border rounded-lg py-12 text-center">
          <LayoutGrid className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="font-body text-[13px] text-muted-foreground">No creatives linked yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {creatives.map((c: any) => (
            <div key={c.ad_id} className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="h-28 bg-muted flex items-center justify-center">
                {c.thumbnail_url ? (
                  <img src={c.thumbnail_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <LayoutGrid className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="p-2">
                <p className="font-body text-[11px] font-medium text-foreground truncate">{c.ad_name}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-data text-[11px] text-muted-foreground">{(Number(c.roas) || 0).toFixed(2)}x</span>
                  <span className="font-data text-[11px] text-muted-foreground">${Number(c.spend || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={linkOpen} onOpenChange={(v) => !v && setLinkOpen(false)}>
        {linkOpen && <LinkCreativesModal creatorId={creator.id} accountId={accountId} onClose={() => setLinkOpen(false)} />}
      </Dialog>
    </div>
  );
}

const CreatorsPage = () => {
  const { selectedAccountId } = useAccountContext();
  const { data: creators = [], isLoading } = useCreators(selectedAccountId);
  const { data: allCreativesResult } = useCreatives(
    selectedAccountId && selectedAccountId !== "all" ? { account_id: selectedAccountId } : {},
    0
  );
  const allCreatives = allCreativesResult?.data || [];
  const deleteCreator = useDeleteCreator();

  const [formOpen, setFormOpen] = useState(false);
  const [editingCreator, setEditingCreator] = useState<Creator | undefined>();
  const [selectedCreator, setSelectedCreator] = useState<Creator | null>(null);

  // Compute per-creator stats from allCreatives
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
      const withSpend = items.filter(c => (Number(c.spend) || 0) > 0);
      const totalSpend = items.reduce((s, c) => s + (Number(c.spend) || 0), 0);
      const avgRoas = withSpend.length > 0 ? withSpend.reduce((s, c) => s + (Number(c.roas) || 0), 0) / withSpend.length : 0;
      stats.set(cid, { count: items.length, totalSpend, avgRoas });
    }
    return stats;
  }, [allCreatives]);

  if (!selectedAccountId || selectedAccountId === "all") {
    return (
      <AppLayout>
        <PageHeader title="Creators" description="Select a specific account to manage creators." />
        <div className="bg-card border border-border rounded-lg py-16 text-center">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-body text-[14px] text-muted-foreground">Select a single account to view creators.</p>
        </div>
      </AppLayout>
    );
  }

  if (selectedCreator) {
    return (
      <AppLayout>
        <CreatorDetail creator={selectedCreator} accountId={selectedAccountId} onBack={() => setSelectedCreator(null)} />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Creators"
        description="Manage talent and creators attributed to your ad creatives."
        actions={
          <Button size="sm" onClick={() => { setEditingCreator(undefined); setFormOpen(true); }} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />Add Creator
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : creators.length === 0 ? (
        <div className="bg-card border border-border rounded-lg py-16 text-center">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-heading text-[18px] text-foreground mb-1">No creators yet</h3>
          <p className="font-body text-[13px] text-muted-foreground mb-4">Add your first creator to start tracking talent performance.</p>
          <Button size="sm" onClick={() => { setEditingCreator(undefined); setFormOpen(true); }} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />Add Creator
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {creators.map(c => {
            const stats = creatorStats.get(c.id) || { count: 0, totalSpend: 0, avgRoas: 0 };
            return (
              <div
                key={c.id}
                onClick={() => setSelectedCreator(c)}
                className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3 cursor-pointer hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-body text-[14px] font-medium text-foreground truncate">{c.name}</span>
                      <Badge className={`${TYPE_COLORS[c.type] || TYPE_COLORS.ugc} capitalize font-label text-[9px] border-0`}>{c.type}</Badge>
                    </div>
                    {c.handle && <p className="font-body text-[11px] text-muted-foreground">{c.handle}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="font-data text-[13px] font-medium text-foreground tabular-nums">{stats.count} creatives</p>
                    <p className="font-data text-[11px] text-muted-foreground tabular-nums">{stats.avgRoas.toFixed(2)}x avg · ${stats.totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingCreator(c); setFormOpen(true); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteCreator.mutate(c.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(v) => !v && setFormOpen(false)}>
        {formOpen && (
          <CreatorForm
            creator={editingCreator}
            accountId={selectedAccountId}
            onClose={() => setFormOpen(false)}
          />
        )}
      </Dialog>
    </AppLayout>
  );
};

export default CreatorsPage;
