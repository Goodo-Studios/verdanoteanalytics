import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Search, Download, Archive, Vault as VaultIcon, X, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccountContext } from "@/contexts/AccountContext";
import { CreativeDetailModal } from "@/components/CreativeDetailModal";
import { saveCreativeToVault } from "@/lib/vaultSave";
import { useCreativeLibrary, type CreativeClass } from "./hooks/useCreativeLibrary";
import { archiveCreatives, exportCreativesZip, type LibraryCreative } from "./api";
import { LibraryCard } from "./components/LibraryCard";
import { CLASS_META } from "./components/classMeta";

// BUILDER dogfood gate (roadmap §4 rollout): the Creative Library ships behind
// the internal builder account (Goodo) first. Non-matching accounts see a notice
// until it is proven and rolled out. The env-overridable constant keeps the gate
// in one place for the eventual rollout story.
const BUILDER_ACCOUNT_ID =
  (import.meta.env.VITE_BUILDER_ACCOUNT_ID as string) || "act_782159176742035";

const WINDOWS: { label: string; days: number }[] = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 14 days", days: 14 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 180 days", days: 180 },
  { label: "Last 365 days", days: 365 },
];

type SortKey = "spend" | "roas" | "cpa" | "ctr" | "newest";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "spend", label: "Spend" },
  { key: "roas", label: "ROAS" },
  { key: "cpa", label: "CPA (low→high)" },
  { key: "ctr", label: "CTR" },
  { key: "newest", label: "Newest" },
];

const FILTERS: { key: CreativeClass | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "winner", label: CLASS_META.winner.short },
  { key: "rising", label: CLASS_META.rising.short },
  { key: "fatiguing", label: CLASS_META.fatiguing.short },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return d.toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);

export default function CreativeLibraryPage() {
  const { selectedAccountId } = useAccountContext();
  const [windowDays, setWindowDays] = useState(30);
  const [filter, setFilter] = useState<CreativeClass | "all">("all");
  const [sort, setSort] = useState<SortKey>("spend");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<LibraryCreative | null>(null);

  const from = useMemo(() => isoDaysAgo(windowDays), [windowDays]);
  const to = useMemo(() => today(), []);

  const gated = !!selectedAccountId && selectedAccountId !== BUILDER_ACCOUNT_ID;

  const { data, isLoading, isError, error, refetch } = useCreativeLibrary(
    gated ? null : selectedAccountId,
    from,
    to,
  );

  const toggleSelect = (adId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(adId)) next.delete(adId);
      else next.add(adId);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  // ── Filter + search + sort (client-side, over the fetched rows) ────────────
  const visible = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    if (filter !== "all") {
      rows = rows.filter((r) => data.classification.get(r.ad_id)?.klass === filter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.ad_name?.toLowerCase().includes(q) ||
          r.unique_code?.toLowerCase().includes(q) ||
          r.hook?.toLowerCase().includes(q) ||
          r.theme?.toLowerCase().includes(q),
      );
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (sort) {
        case "roas": return b.roas - a.roas;
        case "cpa": return (a.cpa || Infinity) - (b.cpa || Infinity);
        case "ctr": return b.ctr - a.ctr;
        case "newest":
          return new Date(b.created_time ?? b.first_seen ?? 0).getTime() -
            new Date(a.created_time ?? a.first_seen ?? 0).getTime();
        case "spend":
        default: return b.spend - a.spend;
      }
    });
    return sorted;
  }, [data, filter, search, sort]);

  // ── Bulk actions ───────────────────────────────────────────────────────────
  const { mutate: doArchive, isPending: archiving } = useMutation({
    mutationFn: async (adIds: string[] | undefined) =>
      archiveCreatives(selectedAccountId!, adIds),
    onSuccess: (res) => {
      toast.success(`Archived ${res.archived} creative${res.archived === 1 ? "" : "s"} durably`);
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Archive failed"),
  });

  const { mutate: doExport, isPending: exporting } = useMutation({
    mutationFn: async (adIds: string[]) => exportCreativesZip(selectedAccountId!, adIds),
    onSuccess: (res) => {
      if (res.download_url) {
        window.open(res.download_url, "_blank", "noopener");
        toast.success(`Zip ready — ${res.file_count} file${res.file_count === 1 ? "" : "s"}`);
      } else {
        toast.error(res.error ?? "Export produced no file");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Export failed"),
  });

  const { mutate: doSaveToVault, isPending: savingVault } = useMutation({
    mutationFn: async (rows: LibraryCreative[]) => {
      const results = await Promise.allSettled(
        rows.map((r) => saveCreativeToVault(r as unknown as Parameters<typeof saveCreativeToVault>[0])),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      toast.success(`Saved ${ok} to Vault${failed ? `, ${failed} failed` : ""}`);
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save to Vault failed"),
  });

  const selectedRows = useMemo(
    () => visible.filter((r) => selected.has(r.ad_id)),
    [visible, selected],
  );

  // ── Gate / empty states ─────────────────────────────────────────────────────
  if (gated) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <PageHeader title="Creative Library" description="Every live creative for this account, as playable cards." />
        <div className="text-center py-24 space-y-2">
          <LayoutGrid className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">
            The Creative Library is being dogfooded on the builder account first and isn't enabled for this account yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p-6 max-w-7xl mx-auto">
        <PageHeader
          title="Creative Library"
          description="Every live creative for this account — playable, classified, and archivable."
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => doArchive(undefined)}
              disabled={archiving || !selectedAccountId}
            >
              {archiving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Archive className="w-4 h-4 mr-1" />}
              Archive all live
            </Button>
          }
        />

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, hook, angle…"
              className="pl-8"
            />
          </div>
          <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w.days} value={String(w.days)}>{w.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Sort" /></SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.key} value={s.key}>Sort: {s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Class filter chips */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {FILTERS.map((f) => {
            const count =
              f.key === "all"
                ? (data?.rows.length ?? 0)
                : (data?.counts[f.key] ?? 0);
            return (
              <button
                key={f.key}
                data-active={filter === f.key}
                onClick={() => setFilter(f.key)}
                className="rounded-full border border-border-light px-3 py-1 text-[12px] font-medium text-charcoal transition-colors data-[active=true]:border-transparent data-[active=true]:bg-charcoal data-[active=true]:text-white hover:bg-cream-dark"
              >
                {f.label} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Grid */}
        <div className="mt-5">
          {isLoading ? (
            <div className="text-center py-20 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading creatives…
            </div>
          ) : isError ? (
            <div className="text-center py-20 space-y-2">
              <p className="text-destructive">{error instanceof Error ? error.message : "Failed to load"}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-20 space-y-2">
              <LayoutGrid className="w-10 h-10 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">
                {data?.rows.length ? "No creatives match the current filters." : "No live creatives in this window."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visible.map((c) => (
                <LibraryCard
                  key={c.ad_id}
                  creative={c}
                  classification={data?.classification.get(c.ad_id)}
                  onOpen={setDetail}
                  selected={selected.has(c.ad_id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-background border border-border rounded-full shadow-xl px-5 py-3 animate-in slide-in-from-bottom-4">
          <span className="text-sm font-medium text-foreground">{selected.size} selected</span>
          <div className="w-px h-4 bg-border" />
          <Button size="sm" variant="outline" onClick={() => doArchive([...selected])} disabled={archiving}>
            {archiving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Archive className="w-3.5 h-3.5 mr-1" />}
            Archive
          </Button>
          <Button size="sm" variant="outline" onClick={() => doSaveToVault(selectedRows)} disabled={savingVault}>
            {savingVault ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <VaultIcon className="w-3.5 h-3.5 mr-1" />}
            Save to Vault
          </Button>
          <Button size="sm" onClick={() => doExport([...selected])} disabled={exporting}>
            {exporting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
            Download ZIP
          </Button>
          <button
            onClick={clearSelection}
            className="p-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Drill-in detail (reuses the existing modal — includes Save-to-Vault). */}
      {detail && (
        <CreativeDetailModal
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          creative={detail as any}
          open={!!detail}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
