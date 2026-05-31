import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useUpdateBrief, type Brief } from "@/hooks/useBriefsApi";
import { useAccounts } from "@/hooks/useAccountsApi";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Copy, Save, Send, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { CreativePickerModal, type VisualItem } from "./CreativePickerModal";

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
  const [refItems, setRefItems] = useState<VisualItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (brief) {
      const c = brief.content || {};
      setName(brief.name);
      setContent({
        angle_goal: c.angle_goal ?? c.objective ?? "",
        brief: c.brief ?? [c.hook, c.key_message, c.cta].filter(Boolean).join("\n\n"),
      });
      // Hydrate selected items from stored visual_inspiration objects so vault
      // items render thumbnails without a live creative fetch. Backfill source
      // for legacy objects (pre-vault) that lack it.
      const stored: any[] = Array.isArray(c.visual_inspiration) ? c.visual_inspiration : [];
      setRefItems(stored.map((v: any) => ({
        ad_id: v.ad_id,
        thumbnail_url: v.thumbnail_url ?? null,
        ad_name: v.ad_name ?? null,
        unique_code: v.unique_code ?? null,
        source: v.source ?? (String(v.ad_id).startsWith("vault:") ? "vault" : "creative"),
      })));
      setDirty(false);
    }
  }, [brief]);

  if (!brief) return null;

  const updateField = (key: string, value: string) => {
    setContent((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const toggleItem = (item: VisualItem) => {
    setRefItems((prev) =>
      prev.some((i) => i.ad_id === item.ad_id)
        ? prev.filter((i) => i.ad_id !== item.ad_id)
        : [...prev, item],
    );
    setDirty(true);
  };

  const removeInspiration = (adId: string) => {
    setRefItems((prev) => prev.filter((i) => i.ad_id !== adId));
    setDirty(true);
  };

  const save = async () => {
    const cleanContent = {
      angle_goal: content.angle_goal || "",
      brief: content.brief || "",
      visual_inspiration: refItems,
    };
    await updateBrief.mutateAsync({
      id: brief.id,
      name,
      content: cleanContent,
      reference_ad_ids: refItems.map((i) => i.ad_id),
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
    if (refItems.length > 0) {
      lines.push("## Visual Inspiration");
      for (const c of refItems) {
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
            <Button size="sm" variant="outline" className="gap-1 font-body text-[11px]" onClick={() => setPickerOpen(true)}>
              <Plus className="h-3 w-3" /> Link creatives
            </Button>
          </div>

          {refItems.length > 0 ? (
            <div className="flex gap-2 flex-wrap">
              {refItems.map((c) => (
                <div key={c.ad_id} className="w-20 space-y-1 group relative">
                  <button
                    onClick={() => removeInspiration(c.ad_id)}
                    className="absolute -top-1.5 -right-1.5 z-10 h-4 w-4 rounded-full bg-charcoal text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                  {c.thumbnail_url ? (
                    <img src={c.thumbnail_url} alt={c.ad_name ?? ""} className="w-20 h-14 object-cover rounded border border-border-light" />
                  ) : (
                    <div className="w-20 h-14 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">No img</div>
                  )}
                  <p className="font-body text-[9px] text-muted-foreground truncate">{c.unique_code || c.ad_name}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-body text-[12px] text-muted-foreground">No visual inspiration linked yet. Use "Link creatives" to pull from your Vault or any ad-account creative.</p>
          )}
        </div>
      </DialogContent>

      <CreativePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        briefAccountId={brief.account_id}
        selectedIds={new Set(refItems.map((i) => i.ad_id))}
        onToggle={toggleItem}
      />
    </Dialog>
  );
}
