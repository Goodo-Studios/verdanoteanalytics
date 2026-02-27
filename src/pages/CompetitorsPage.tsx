import { useState, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Radar, Plus, Trash2, Search, ExternalLink, Loader2, Eye, Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccountContext } from "@/contexts/AccountContext";
import { useCompetitors, useCreateCompetitor, useDeleteCompetitor, useAdLibrary, usePageSearch } from "@/hooks/useCompetitorsApi";
import { format } from "date-fns";

interface AdLibraryAd {
  id: string;
  page_name: string;
  page_id: string;
  bodies: string[];
  titles: string[];
  captions: string[];
  descriptions: string[];
  start_date: string | null;
  stop_date: string | null;
  platforms: string[];
  audience_size: { lower_bound?: number; upper_bound?: number } | null;
}

export default function CompetitorsPage() {
  const { selectedAccountId, accounts } = useAccountContext();
  const { data: competitors = [], isLoading } = useCompetitors();
  const createCompetitor = useCreateCompetitor();
  const deleteCompetitor = useDeleteCompetitor();

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ brand_name: "", facebook_page_id: "", facebook_page_name: "", notes: "" });
  const [pageSearchQuery, setPageSearchQuery] = useState("");
  const { data: pageResults = [], isLoading: searchingPages } = usePageSearch(pageSearchQuery);

  const [selectedCompetitor, setSelectedCompetitor] = useState<any>(null);
  const [adSearchTerms, setAdSearchTerms] = useState("");

  // Ad library query — either by page_id or search terms
  const libraryPageId = selectedCompetitor?.facebook_page_id || null;
  const librarySearch = adSearchTerms || null;
  const { data: libraryData, isLoading: loadingAds } = useAdLibrary(
    libraryPageId,
    librarySearch,
    !!(libraryPageId || librarySearch)
  );

  const ads: AdLibraryAd[] = libraryData?.ads || [];

  const handleAddCompetitor = async () => {
    if (!addForm.brand_name) return;
    const accountId = selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : accounts[0]?.id;
    if (!accountId) return;

    await createCompetitor.mutateAsync({
      account_id: accountId,
      brand_name: addForm.brand_name,
      facebook_page_id: addForm.facebook_page_id || undefined,
      facebook_page_name: addForm.facebook_page_name || undefined,
      notes: addForm.notes || undefined,
    });
    setShowAddModal(false);
    setAddForm({ brand_name: "", facebook_page_id: "", facebook_page_name: "", notes: "" });
    setPageSearchQuery("");
  };

  const selectPage = (page: { page_id: string; page_name: string }) => {
    setAddForm(prev => ({ ...prev, facebook_page_id: page.page_id, facebook_page_name: page.page_name, brand_name: prev.brand_name || page.page_name }));
    setPageSearchQuery("");
  };

  return (
    <AppLayout>
      <PageHeader
        title="Competitors"
        description="Track competitor ads from the Meta Ad Library"
        actions={
          <Button size="sm" onClick={() => setShowAddModal(true)} className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-[13px] font-semibold rounded-button">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Competitor
          </Button>
        }
      />

      <div className="flex gap-5">
        {/* Competitor List — Left Panel */}
        <div className="w-72 flex-shrink-0 space-y-2">
          <div className="glass-panel p-3">
            <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Tracked Brands ({competitors.length})
            </p>
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : competitors.length === 0 ? (
              <div className="text-center py-6">
                <Radar className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                <p className="font-body text-[13px] text-muted-foreground">No competitors tracked yet.</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowAddModal(true)}>
                  <Plus className="h-3 w-3 mr-1" /> Add first
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {competitors.map((c: any) => (
                  <div
                    key={c.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-md cursor-pointer transition-colors",
                      selectedCompetitor?.id === c.id ? "bg-primary/10 text-primary" : "hover:bg-accent/40"
                    )}
                    onClick={() => { setSelectedCompetitor(c); setAdSearchTerms(""); }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-[13px] font-semibold text-charcoal truncate">{c.brand_name}</p>
                      {c.facebook_page_name && (
                        <p className="font-data text-[11px] text-muted-foreground truncate">{c.facebook_page_name}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteCompetitor.mutate(c.id); if (selectedCompetitor?.id === c.id) setSelectedCompetitor(null); }}
                      className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ad search by keyword */}
          <div className="glass-panel p-3 space-y-2">
            <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">
              Search Ad Library
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-8 bg-background font-body text-[13px]"
                placeholder="Search by keyword..."
                value={adSearchTerms}
                onChange={(e) => { setAdSearchTerms(e.target.value); setSelectedCompetitor(null); }}
              />
            </div>
          </div>
        </div>

        {/* Main Content — Ad Library Results */}
        <div className="flex-1 min-w-0">
          {!selectedCompetitor && !adSearchTerms ? (
            <div className="glass-panel p-12 text-center">
              <Radar className="h-12 w-12 mx-auto text-muted-foreground/20 mb-4" />
              <h3 className="font-heading text-[18px] text-forest mb-2">Select a competitor or search</h3>
              <p className="font-body text-[13px] text-muted-foreground max-w-md mx-auto">
                Choose a tracked competitor from the left panel to view their active ads, or search the Meta Ad Library by keyword.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-heading text-[20px] text-forest">
                    {selectedCompetitor ? selectedCompetitor.brand_name : `Search: "${adSearchTerms}"`}
                  </h2>
                  {selectedCompetitor?.facebook_page_id && (
                    <a
                      href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=${selectedCompetitor.facebook_page_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-body text-[12px] text-primary hover:underline inline-flex items-center gap-1 mt-0.5"
                    >
                      View in Meta Ad Library <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {ads.length > 0 && (
                  <Badge variant="secondary" className="font-data text-[11px]">
                    {ads.length} active ads
                  </Badge>
                )}
              </div>

              {loadingAds ? (
                <div className="glass-panel p-12 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-2" />
                  <p className="font-body text-[13px] text-muted-foreground">Loading ads from Meta Ad Library...</p>
                </div>
              ) : ads.length === 0 ? (
                <div className="glass-panel p-12 text-center">
                  <p className="font-body text-[13px] text-muted-foreground">No active ads found.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ads.map((ad) => (
                    <div key={ad.id} className="glass-panel p-4 space-y-3">
                      {/* Page name */}
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="font-body text-[12px] font-semibold text-charcoal truncate">{ad.page_name}</span>
                      </div>

                      {/* Ad body */}
                      {ad.bodies.length > 0 && (
                        <p className="font-body text-[13px] text-foreground leading-relaxed line-clamp-4">
                          {ad.bodies[0]}
                        </p>
                      )}

                      {/* Title */}
                      {ad.titles.length > 0 && (
                        <p className="font-body text-[12px] font-semibold text-charcoal truncate">
                          {ad.titles[0]}
                        </p>
                      )}

                      {/* Description */}
                      {ad.descriptions.length > 0 && (
                        <p className="font-body text-[11px] text-muted-foreground line-clamp-2">
                          {ad.descriptions[0]}
                        </p>
                      )}

                      <Separator />

                      {/* Meta */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {ad.start_date && (
                            <span className="font-data text-[11px] text-muted-foreground tabular-nums">
                              Since {format(new Date(ad.start_date), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {ad.platforms.map((p: string) => (
                            <Badge key={p} variant="outline" className="text-[9px] px-1.5 py-0 capitalize">
                              {p}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* View in library */}
                      <a
                        href={`https://www.facebook.com/ads/library/?id=${ad.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-body text-[11px] text-primary hover:underline"
                      >
                        <Eye className="h-3 w-3" /> View full ad
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Competitor Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-md bg-white rounded-[8px] shadow-modal p-6">
          <DialogHeader>
            <DialogTitle className="font-heading text-[18px] text-forest flex items-center gap-2">
              <Radar className="h-4 w-4 text-sage" />
              Add Competitor
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Page search */}
            <div className="space-y-1.5">
              <Label className="font-body text-[13px] font-medium text-charcoal">Find Facebook Page</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-8 bg-background font-body text-[13px]"
                  placeholder="Search for a brand..."
                  value={pageSearchQuery}
                  onChange={(e) => setPageSearchQuery(e.target.value)}
                />
              </div>
              {searchingPages && <p className="font-body text-[11px] text-muted-foreground">Searching...</p>}
              {pageResults.length > 0 && (
                <div className="max-h-[150px] overflow-y-auto border border-border-light rounded-[6px] divide-y divide-border-light">
                  {pageResults.map((p: any) => (
                    <button
                      key={p.page_id}
                      onClick={() => selectPage(p)}
                      className="w-full text-left px-3 py-2 hover:bg-accent/40 transition-colors"
                    >
                      <span className="font-body text-[13px] text-charcoal">{p.page_name}</span>
                      <span className="font-data text-[10px] text-muted-foreground ml-2">ID: {p.page_id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-1.5">
              <Label className="font-body text-[13px] font-medium text-charcoal">Brand Name *</Label>
              <Input
                className="bg-background font-body text-[13px]"
                value={addForm.brand_name}
                onChange={(e) => setAddForm(prev => ({ ...prev, brand_name: e.target.value }))}
                placeholder="e.g. Competitor Brand"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="font-body text-[12px] text-muted-foreground">Page ID</Label>
                <Input
                  className="bg-background font-body text-[12px]"
                  value={addForm.facebook_page_id}
                  onChange={(e) => setAddForm(prev => ({ ...prev, facebook_page_id: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="font-body text-[12px] text-muted-foreground">Page Name</Label>
                <Input
                  className="bg-background font-body text-[12px]"
                  value={addForm.facebook_page_name}
                  onChange={(e) => setAddForm(prev => ({ ...prev, facebook_page_name: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="font-body text-[12px] text-muted-foreground">Notes</Label>
              <Textarea
                className="bg-background font-body text-[13px] min-h-[60px]"
                value={addForm.notes}
                onChange={(e) => setAddForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Internal notes about this competitor..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleAddCompetitor}
              disabled={!addForm.brand_name || createCompetitor.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {createCompetitor.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Add Competitor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
