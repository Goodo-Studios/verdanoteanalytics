import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Bookmark, Plus, Trash2, ExternalLink, Loader2, Pencil, Copy, GripVertical, Users, Pin } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAccountContext } from "@/contexts/AccountContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToggleShared, useTogglePinned } from "@/hooks/useSavedViews";
import { toast } from "sonner";

interface ViewConfig {
  page: string;
  account_id?: string;
  apply_account?: boolean;
  analytics_tab?: string;
  slice_by?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  sort_column?: string;
  sort_direction?: string;
  group_by?: string;
}

interface SavedView {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  config: ViewConfig;
  sort_order: number;
  is_shared: boolean;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

const PAGE_OPTIONS = [
  { value: "/", label: "Creatives" },
  { value: "/analytics", label: "Analytics" },
];

const ANALYTICS_TABS = [
  { value: "trends", label: "Trends" },
  { value: "winrate", label: "Win Rate" },
  { value: "killscale", label: "Kill / Scale" },
  { value: "iterations", label: "Iteration Priorities" },
];

const SLICE_OPTIONS = [
  { value: "ad_type", label: "Type" },
  { value: "person", label: "Person" },
  { value: "style", label: "Style" },
  { value: "hook", label: "Hook" },
  { value: "product", label: "Product" },
  { value: "theme", label: "Theme" },
];

const SavedViewsPage = () => {
  const { user, isBuilder, isEmployee } = useAuth();
  const { accounts, setSelectedAccountId } = useAccountContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const toggleShared = useToggleShared();
  const togglePinned = useTogglePinned();
  const canShare = isBuilder || isEmployee;

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [page, setPage] = useState("/");
  const [accountId, setAccountId] = useState("all");
  const [applyAccount, setApplyAccount] = useState(false);
  const [analyticsTab, setAnalyticsTab] = useState("trends");
  const [sliceBy, setSliceBy] = useState("ad_type");
  const [groupBy, setGroupBy] = useState("");

  const { data: allViews = [], isLoading } = useQuery({
    queryKey: ["saved-views"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_views")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as unknown as SavedView[]) || [];
    },
    enabled: !!user,
  });

  // Fetch owner profiles for shared views
  const sharedViewUserIds = useMemo(() => {
    return [...new Set(allViews.filter(v => v.user_id !== user?.id).map(v => v.user_id))];
  }, [allViews, user]);

  const { data: ownerProfiles = [] } = useQuery({
    queryKey: ["owner-profiles", sharedViewUserIds],
    queryFn: async () => {
      if (sharedViewUserIds.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name, email")
        .in("user_id", sharedViewUserIds);
      return data || [];
    },
    enabled: sharedViewUserIds.length > 0,
  });

  const getOwnerName = (userId: string) => {
    const profile = ownerProfiles.find((p: any) => p.user_id === userId);
    return profile?.display_name || profile?.email?.split("@")[0] || "Team member";
  };

  // Split into own views and shared views
  const myViews = useMemo(() => allViews.filter(v => v.user_id === user?.id), [allViews, user]);
  const sharedViews = useMemo(() => allViews.filter(v => v.user_id !== user?.id && v.is_shared), [allViews, user]);

  // Count pinned
  const pinnedCount = useMemo(() => myViews.filter(v => v.pinned).length, [myViews]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const config: ViewConfig = { page };
      if (accountId && accountId !== "all") {
        config.account_id = accountId;
        config.apply_account = applyAccount;
      }
      if (groupBy) config.group_by = groupBy;

      const { error } = await supabase.from("saved_views").insert([{
        user_id: user!.id,
        name,
        description: description || null,
        config: config as any,
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-views"] });
      toast.success("View saved");
      setDialogOpen(false);
      resetForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("saved_views").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-views"] });
      toast.success("View deleted");
    },
  });

  const [editView, setEditView] = useState<SavedView | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAccountId, setEditAccountId] = useState("all");
  const [editApplyAccount, setEditApplyAccount] = useState(false);
  const [editPage, setEditPage] = useState("/");
  const [editAnalyticsTab, setEditAnalyticsTab] = useState("trends");
  const [editSliceBy, setEditSliceBy] = useState("ad_type");
  const [editGroupBy, setEditGroupBy] = useState("");

  const startEditing = (view: SavedView) => {
    setEditView(view);
    setEditName(view.name);
    setEditDescription(view.description || "");
    setEditAccountId(view.config.account_id || "all");
    setEditApplyAccount(view.config.apply_account || false);
    setEditPage(view.config.page);
    setEditAnalyticsTab(view.config.analytics_tab || "trends");
    setEditSliceBy(view.config.slice_by || "ad_type");
    setEditGroupBy(view.config.group_by || "");
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editView) return;
      const config: ViewConfig = { page: editPage };
      if (editAccountId && editAccountId !== "all") {
        config.account_id = editAccountId;
        config.apply_account = editApplyAccount;
      }
      if (editPage === "/analytics") {
        config.analytics_tab = editAnalyticsTab;
        if (editAnalyticsTab === "winrate") config.slice_by = editSliceBy;
      }
      if (editPage === "/" && editGroupBy) config.group_by = editGroupBy;

      const { error } = await supabase
        .from("saved_views")
        .update({
          name: editName,
          description: editDescription || null,
          config: config as any,
        })
        .eq("id", editView.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-views"] });
      toast.success("View updated");
      setEditView(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (view: SavedView) => {
      const { error } = await supabase.from("saved_views").insert([{
        user_id: user!.id,
        name: `${view.name} (copy)`,
        description: view.description,
        config: view.config as any,
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-views"] });
      toast.success("View duplicated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Drag-and-drop reorder state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const reorderMutation = useMutation({
    mutationFn: async (newOrder: { id: string; sort_order: number }[]) => {
      // Update all sort_orders in parallel
      const promises = newOrder.map(({ id, sort_order }) =>
        supabase.from("saved_views").update({ sort_order }).eq("id", id)
      );
      const results = await Promise.all(promises);
      const err = results.find(r => r.error);
      if (err?.error) throw err.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-views"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setOverIdx(idx);
  }, []);

  const handleDrop = useCallback((targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    const reordered = [...myViews];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    const newOrder = reordered.map((v, i) => ({ id: v.id, sort_order: i }));
    reorderMutation.mutate(newOrder);
    setDragIdx(null);
    setOverIdx(null);
  }, [dragIdx, myViews, reorderMutation]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setOverIdx(null);
  }, []);

  const resetForm = () => {
    setName("");
    setDescription("");
    setPage("/");
    setAccountId("all");
    setApplyAccount(false);
    setAnalyticsTab("trends");
    setSliceBy("ad_type");
    setGroupBy("");
  };

  const applyView = (view: SavedView) => {
    const c = view.config;
    if (c.account_id && c.apply_account) {
      setSelectedAccountId(c.account_id);
    }
    const params = new URLSearchParams();
    if (c.analytics_tab) params.set("tab", c.analytics_tab);
    if (c.slice_by) params.set("slice", c.slice_by);
    if (c.group_by) params.set("group", c.group_by);
    if (c.date_from) params.set("from", c.date_from);
    if (c.date_to) params.set("to", c.date_to);
    if (c.search) params.set("q", c.search);
    if ((c as any).delivery) params.set("delivery", (c as any).delivery);
    if ((c as any).filters) params.set("filters", JSON.stringify((c as any).filters));
    const qs = params.toString();
    navigate(`${c.page}${qs ? `?${qs}` : ""}`);
  };

  const getPageLabel = (path: string) => PAGE_OPTIONS.find((p) => p.value === path)?.label || path;
  const getAccountName = (id?: string) => {
    if (!id) return "All Accounts";
    return accounts.find((a: any) => a.id === id)?.name || id;
  };

  return (
    <AppLayout>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-heading text-[32px] text-forest">Saved Views</h1>
          <p className="font-body text-[13px] text-slate font-light mt-1">
            Save and quickly switch between different analysis configurations.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <p className="font-data text-[14px] font-medium text-sage">{myViews.length} saved view{myViews.length !== 1 ? "s" : ""}</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 bg-verdant text-white hover:bg-verdant/90">
              <Plus className="h-3.5 w-3.5" />
              New View
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Saved View</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TOF Hook Analysis" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description (optional)</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this view shows" className="h-9 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Page</Label>
                  <Select value={page} onValueChange={setPage}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAGE_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Account</Label>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All Accounts</SelectItem>
                      {[...accounts].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((acc: any) => (
                        <SelectItem key={acc.id} value={acc.id} className="text-xs">{acc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {accountId && accountId !== "all" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="apply-account"
                    checked={applyAccount}
                    onCheckedChange={(checked) => setApplyAccount(checked === true)}
                  />
                  <Label htmlFor="apply-account" className="text-xs text-muted-foreground cursor-pointer">
                    Switch to this account when opening view
                  </Label>
                </div>
              )}
              {page === "/analytics" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Analytics Tab</Label>
                    <Select value={analyticsTab} onValueChange={setAnalyticsTab}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ANALYTICS_TABS.map((t) => (
                          <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {analyticsTab === "winrate" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Slice By</Label>
                      <Select value={sliceBy} onValueChange={setSliceBy}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SLICE_OPTIONS.map((s) => (
                            <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}
              {page === "/" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Group By (optional)</Label>
                  <Select value={groupBy || "none"} onValueChange={(v) => setGroupBy(v === "none" ? "" : v)}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">None</SelectItem>
                      {SLICE_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending} className="w-full">
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save View
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Shared with me section */}
          {sharedViews.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-sage" />
                <h2 className="font-heading text-[18px] text-forest">Shared with me</h2>
                <Badge variant="secondary" className="font-label text-[10px]">{sharedViews.length}</Badge>
              </div>
              <div className="divide-y divide-border-light border border-border-light rounded-lg overflow-hidden">
                {sharedViews.map((view) => (
                  <div key={view.id} className="py-3 px-4 flex items-center justify-between group bg-sage-light/30">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-body text-[15px] font-semibold text-charcoal truncate">{view.name}</span>
                        <span className="font-label text-[10px] font-medium tracking-wide bg-sage-light text-forest rounded-[4px] px-2 py-0.5 flex-shrink-0">{getPageLabel(view.config.page)}</span>
                        <span className="font-label text-[10px] text-sage">by {getOwnerName(view.user_id)}</span>
                      </div>
                      {view.description && (
                        <p className="font-body text-[12px] text-sage truncate">{view.description}</p>
                      )}
                    </div>
                    <button className="font-body text-[13px] font-medium text-verdant hover:underline px-2 py-1 ml-4" onClick={() => applyView(view)}>
                      Open
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* My views */}
          {myViews.length === 0 ? (
            <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
              <Bookmark className="h-10 w-10 text-sage mb-3" />
              <h3 className="font-heading text-[20px] text-forest mb-1">No saved views yet</h3>
              <p className="font-body text-[14px] text-slate max-w-[400px]">Create views to quickly jump between different analysis configurations across Creatives and Analytics.</p>
            </div>
          ) : (
            <div className="divide-y divide-border-light">
              {myViews.map((view, idx) => (
                <div
                  key={view.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={handleDragEnd}
                  className={`py-4 px-1 flex items-center justify-between group ${
                    dragIdx === idx ? "opacity-50" : ""
                  } ${overIdx === idx && dragIdx !== idx ? "border-t-2 border-primary" : ""}`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab flex-shrink-0 hover:text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-body text-[15px] font-semibold text-charcoal truncate cursor-pointer hover:underline" onDoubleClick={() => startEditing(view)}>{view.name}</span>
                        <span className="font-label text-[10px] font-medium tracking-wide bg-sage-light text-forest rounded-[4px] px-2 py-0.5 flex-shrink-0">{getPageLabel(view.config.page)}</span>
                        {view.config.account_id && (
                          <span className="font-label text-[10px] font-medium tracking-wide bg-sage-light text-forest rounded-[4px] px-2 py-0.5 flex-shrink-0">
                            {view.config.apply_account ? "→ " : ""}{getAccountName(view.config.account_id)}
                          </span>
                        )}
                        {view.config.analytics_tab && (
                          <span className="font-label text-[10px] font-medium tracking-wide bg-sage-light text-forest rounded-[4px] px-2 py-0.5 flex-shrink-0 capitalize">{view.config.analytics_tab}</span>
                        )}
                        {view.config.slice_by && (
                          <span className="font-label text-[10px] font-medium tracking-wide bg-sage-light text-forest rounded-[4px] px-2 py-0.5 flex-shrink-0">Slice: {view.config.slice_by}</span>
                        )}
                        {view.config.group_by && (
                          <span className="font-label text-[10px] font-medium tracking-wide bg-sage-light text-forest rounded-[4px] px-2 py-0.5 flex-shrink-0">Group: {view.config.group_by}</span>
                        )}
                        {view.is_shared && (
                          <span className="font-label text-[10px] font-medium tracking-wide bg-verdant/10 text-verdant rounded-[4px] px-2 py-0.5 flex-shrink-0">Shared</span>
                        )}
                        {view.pinned && (
                          <span className="font-label text-[10px] font-medium tracking-wide bg-gold/15 text-gold rounded-[4px] px-2 py-0.5 flex-shrink-0">Pinned</span>
                        )}
                      </div>
                      {view.description && (
                        <p className="font-body text-[12px] text-sage ml-5.5 truncate">{view.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 ml-4">
                    <button className="font-body text-[13px] font-medium text-verdant hover:underline px-2 py-1" onClick={() => applyView(view)}>
                      Open
                    </button>
                    {canShare && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 w-8 p-0 transition-opacity ${view.is_shared ? "text-verdant opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100"}`}
                            onClick={() => toggleShared.mutate({ id: view.id, is_shared: !view.is_shared })}
                          >
                            <Users className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">{view.is_shared ? "Unshare" : "Share with team"}</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-8 w-8 p-0 transition-opacity ${view.pinned ? "text-gold opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100"}`}
                          onClick={() => {
                            if (!view.pinned && pinnedCount >= 3) {
                              toast.error("Maximum 3 pinned views");
                              return;
                            }
                            togglePinned.mutate({ id: view.id, pinned: !view.pinned });
                          }}
                        >
                          <Pin className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">{view.pinned ? "Unpin" : "Pin to Creatives"}</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => startEditing(view)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => duplicateMutation.mutate(view)}
                      disabled={duplicateMutation.isPending}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setDeleteId(view.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Edit Modal */}
      <Dialog open={!!editView} onOpenChange={(open) => !open && setEditView(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Saved View</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description (optional)</Label>
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="What this view shows" className="h-9 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Page</Label>
                <Select value={editPage} onValueChange={setEditPage}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Account</Label>
                <Select value={editAccountId} onValueChange={setEditAccountId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Accounts</SelectItem>
                    {[...accounts].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((acc: any) => (
                      <SelectItem key={acc.id} value={acc.id} className="text-xs">{acc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editAccountId && editAccountId !== "all" && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-apply-account"
                  checked={editApplyAccount}
                  onCheckedChange={(checked) => setEditApplyAccount(checked === true)}
                />
                <Label htmlFor="edit-apply-account" className="text-xs text-muted-foreground cursor-pointer">
                  Switch to this account when opening view
                </Label>
              </div>
            )}
            {editPage === "/analytics" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Analytics Tab</Label>
                  <Select value={editAnalyticsTab} onValueChange={setEditAnalyticsTab}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ANALYTICS_TABS.map((t) => (
                        <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {editAnalyticsTab === "winrate" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Slice By</Label>
                    <Select value={editSliceBy} onValueChange={setEditSliceBy}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SLICE_OPTIONS.map((s) => (
                          <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            {editPage === "/" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Group By (optional)</Label>
                <Select value={editGroupBy || "none"} onValueChange={(v) => setEditGroupBy(v === "none" ? "" : v)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">None</SelectItem>
                    {SLICE_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={() => updateMutation.mutate()} disabled={!editName.trim() || updateMutation.isPending} className="w-full">
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Update View
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved view?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The saved view will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) deleteMutation.mutate(deleteId);
                setDeleteId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
};

export default SavedViewsPage;
