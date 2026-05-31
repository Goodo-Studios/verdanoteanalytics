import { useState, useEffect, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUpdateBrief, type Brief } from "@/hooks/useBriefsApi";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useAccounts } from "@/hooks/useAccountsApi";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Copy, Save, Send, Plus, X, Search } from "lucide-react";
import { toast } from "sonner";

const SECTION_DEFS = [
  { key: "angle_goal", label: "Angle / Goal", type: "textarea", placeholder: "The strategic angle and what this ad needs to achieve…" },
  { key: "brief", label: "Brief", type: "textarea", placeholder: "Hook, key message, and call to action…" },
];

interface Props {
  brief: Brief | null;
  open: boolean;
  onClose: () => void;
  onCopyShareLink: (token: string) => void;
}

export function BriefEditorModal({ brief, open, onClose, onCopyShareLink }: Props) {
  const updateBrief = useUpdateBrief();
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts();
  const [name, setName] = useState("");
  const [content, setContent] = useState<Record<string, any>>({});
  const [refAdIds, setRefAdIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  // Load reference creatives
  const { data: allCreatives = [], isLoading: creativesLoading } = useAllCreatives({});
  const refCreatives = useMemo(
    () => allCreatives.filter((c: any) => refAdIds.includes(c.ad_id)),
    [allCreatives, refAdIds],
  );

  const accountName = (id: string) => accounts.find((a: any) => a.id === id)?.name || "";

  // Vault picker candidates: search across all accounts (brief's account first),
  // excluding ones already linked.
  const pickerResults = useMemo(() => {
    if (!brief) return [];
    const q = pickerSearch.trim().toLowerCase();
    return allCreatives
      .filter((c: any) =>
        !refAdIds.includes(c.ad_id) &&
        (!q ||
          (c.ad_name || "").toLowerCase().includes(q) ||
          (c.unique_code || "").toLowerCase().includes(q) ||
          (c.product || "").toLowerCase().includes(q)),
      )
      .sort((a: any, b: any) => {
        const am = a.account_id === brief.account_id ? 0 : 1;
        const bm = b.account_id === brief.account_id ? 0 : 1;
        return am - bm;
      })
      .slice(0, 80);
  }, [allCreatives, brief, refAdIds, pickerSearch]);

  useEffect(() => {
    if (brief) {
      const c = brief.content || {};
      setName(brief.name);
      setContent({
        angle_goal: c.angle_goal ?? c.objective ?? "",
        brief: c.brief ?? [c.hook, c.key_message, c.cta].filter(Boolean).join("\n\n"),
        visual_inspiration: Array.isArray(c.visual_inspiration) ? c.visual_inspiration : [],
      });
      setRefAdIds(brief.reference_ad_ids || []);
      setDirty(false);
    }
  }, [brief]);

  if (!brief) return null;

  const updateField = (key: string, value: string) => {
    setContent((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const addInspiration = (adId: string) => {
    setRefAdIds((prev) => (prev.includes(adId) ? prev : [...prev, adId]));
    setDirty(true);
  };

  const removeInspiration = (adId: string) => {
    setRefAdIds((prev) => prev.filter((id) => id !== adId));
    setDirty(true);
  };

  // Serialize selected creatives into light objects so the public share page
  // can render thumbnails without an authed creative fetch. Falls back to the
  // previously-stored object when a creative hasn't loaded yet.
  const buildVisualInspiration = () =>
    refAdIds.map((id) => {
      const c = allCreatives.find((x: any) => x.ad_id === id);
      if (c) return { ad_id: c.ad_id, thumbnail_url: c.thumbnail_url, ad_name: c.ad_name, unique_code: c.unique_code };
      const prior = (content.visual_inspiration || []).find((p: any) => p.ad_id === id);
      return prior || { ad_id: id };
    });

  const save = async () => {
    const cleanContent = {
      angle_goal: content.angle_goal || "",
      brief: content.brief || "",
      visual_inspiration: buildVisualInspiration(),
    };
    await updateBrief.mutateAsync({
      id: brief.id,
      name,
      content: cleanContent,
      reference_ad_ids: refAdIds,
    } as any);
    setDirty(false);
  };

  const buildBriefMarkdown = () => {
    const lines: string[] = [`# ${name || "Brief"}`, ""];
    for (const section of SECTION_DEFS) {
      const value = (content[section.key] || "").toString().trim();
      if (value) {
        lines.push(`## ${section.label}`);
        lines.push(value);
        lines.push("");
      }
    }
    if (refCreatives.length > 0) {
      lines.push("## Visual Inspiration");
      for (const c of refCreatives) {
        lines.push(`- ${c.unique_code || c.ad_name || c.ad_id}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  };

  const pushToCoda = async () => {
    if (dirty) await save();
    const account = accounts.find((a: any) => a.id === brief.account_id);
    setPushing(true);
    try {
      const { error } = await supabase.functions.invoke("create-coda-brief", {
        body: {
          account_id: brief.account_id,
          account_name: account?.name || brief.account_id,
          task_name: name,
          brief_note: buildBriefMarkdown(),
          user_id: user?.id,
        },
      });
      if (error) throw error;
      toast.success("Pushed to Coda");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to push to Coda");
    } finally {
      setPushing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card border-b border-border-light px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <DialogTitle className="sr-only">Edit Brief</DialogTitle>
            <DialogDescription className="sr-only">Edit brief details and content</DialogDescription>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              className="font-heading text-[18px] text-forest border-0 p-0 h-auto shadow-none focus-visible:ring-0"
              placeholder="Brief name…"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" className="gap-1 font-body text-[11px]" onClick={() => onCopyShareLink(brief.share_token)}>
              <Copy className="h-3 w-3" /> Share
            </Button>
            <Button size="sm" variant="outline" className="gap-1 font-body text-[11px]" onClick={save} disabled={!dirty || updateBrief.isPending}>
              <Save className="h-3 w-3" /> Save
            </Button>
            <Button size="sm" className="gap-1 bg-verdant hover:bg-verdant/90 text-white font-body text-[11px]" onClick={pushToCoda} disabled={pushing}>
              <Send className="h-3 w-3" /> {pushing ? "Pushing…" : "Push to Coda"}
            </Button>
          </div>
        </div>

        {/* Content sections */}
        <div className="px-6 pt-5 space-y-5">
          {SECTION_DEFS.map((section) => (
            <div key={section.key} className="space-y-1.5">
              <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">
                {section.label}
              </Label>
              <Textarea
                value={content[section.key] || ""}
                onChange={(e) => updateField(section.key, e.target.value)}
                placeholder={section.placeholder}
                className="font-body text-[13px] min-h-[100px] resize-y"
              />
            </div>
          ))}
        </div>

        <Separator className="my-4" />

        {/* Visual Inspiration */}
        <div className="px-6 pb-6 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Visual Inspiration</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1 font-body text-[11px]">
                  <Plus className="h-3 w-3" /> Link from Vault
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="p-2 border-b border-border-light">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="Search creatives…"
                      className="pl-8 h-8 font-body text-[12px]"
                    />
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto p-2 space-y-1">
                  {creativesLoading ? (
                    <p className="px-1 py-3 text-center font-body text-[12px] text-muted-foreground">Loading creatives…</p>
                  ) : pickerResults.length === 0 ? (
                    <p className="px-1 py-3 text-center font-body text-[12px] text-muted-foreground">
                      {allCreatives.length === 0 ? "No creatives synced yet." : "No matches."}
                    </p>
                  ) : (
                    pickerResults.map((c: any) => (
                      <button
                        key={c.ad_id}
                        onClick={() => { addInspiration(c.ad_id); setPickerSearch(""); }}
                        className="w-full flex items-center gap-2 p-1.5 rounded hover:bg-muted text-left"
                      >
                        {c.thumbnail_url ? (
                          <img src={c.thumbnail_url} alt={c.ad_name} className="w-12 h-9 object-cover rounded border border-border-light shrink-0" />
                        ) : (
                          <div className="w-12 h-9 rounded bg-muted flex items-center justify-center text-[9px] text-muted-foreground shrink-0">No img</div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-[11px] text-charcoal truncate">{c.unique_code || c.ad_name}</p>
                          {accountName(c.account_id) && (
                            <p className="font-body text-[9px] text-muted-foreground truncate">{accountName(c.account_id)}</p>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {refCreatives.length > 0 ? (
            <div className="flex gap-2 flex-wrap">
              {refCreatives.map((c: any) => (
                <div key={c.ad_id} className="w-20 space-y-1 group relative">
                  <button
                    onClick={() => removeInspiration(c.ad_id)}
                    className="absolute -top-1.5 -right-1.5 z-10 h-4 w-4 rounded-full bg-charcoal text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                  {c.thumbnail_url ? (
                    <img src={c.thumbnail_url} alt={c.ad_name} className="w-20 h-14 object-cover rounded border border-border-light" />
                  ) : (
                    <div className="w-20 h-14 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">No img</div>
                  )}
                  <p className="font-body text-[9px] text-muted-foreground truncate">{c.unique_code || c.ad_name}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-body text-[12px] text-muted-foreground">No visual inspiration linked yet. Use "Link from Vault" to add reference creatives.</p>
          )}
        </div>
      </DialogContent>

    </Dialog>
  );
}
