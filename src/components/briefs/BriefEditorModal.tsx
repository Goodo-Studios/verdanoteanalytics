import { useState, useEffect, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useUpdateBrief, type Brief } from "@/hooks/useBriefsApi";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { useAccounts } from "@/hooks/useAccountsApi";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Copy, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { NamingValidator } from "@/components/briefs/NamingValidator";

const SECTION_DEFS = [
  { key: "concept_name", label: "Concept Name", type: "text" },
  { key: "objective", label: "Objective", type: "textarea", placeholder: "What this ad needs to achieve…" },
  { key: "hook", label: "Hook (opening 3 seconds)", type: "textarea", placeholder: "Describe the opening hook…" },
  { key: "key_message", label: "Key Message", type: "textarea", placeholder: "The one thing viewers must remember…" },
  { key: "cta", label: "Call to Action", type: "text", placeholder: "e.g. Shop Now, Learn More…" },
  { key: "format_specs", label: "Format & Specs", type: "textarea", placeholder: "Auto-filled or custom specs…" },
  { key: "dos", label: "Do's", type: "textarea", placeholder: "Things to include…" },
  { key: "donts", label: "Don'ts", type: "textarea", placeholder: "Things to avoid…" },
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
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [content, setContent] = useState<Record<string, any>>({});
  const [refAdIds, setRefAdIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pushing, setPushing] = useState(false);

  // Load reference creatives
  const { data: allCreatives = [] } = useAllCreatives({});
  const refCreatives = useMemo(
    () => allCreatives.filter((c: any) => refAdIds.includes(c.ad_id)),
    [allCreatives, refAdIds],
  );

  useEffect(() => {
    if (brief) {
      setName(brief.name);
      setAssignee(brief.assignee_name || "");
      setDueDate(brief.due_date || "");
      setContent(brief.content || {});
      setRefAdIds(brief.reference_ad_ids || []);
      setDirty(false);
    }
  }, [brief]);

  if (!brief) return null;

  const updateField = (key: string, value: string) => {
    setContent((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    await updateBrief.mutateAsync({
      id: brief.id,
      name,
      assignee_name: assignee || null,
      due_date: dueDate || null,
      content,
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

        {/* Meta fields */}
        <div className="px-6 pt-4 grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Assignee</Label>
            <Input
              value={assignee}
              onChange={(e) => { setAssignee(e.target.value); setDirty(true); }}
              placeholder="Editor or creator name"
              className="font-body text-[13px] h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Due Date</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => { setDueDate(e.target.value); setDirty(true); }}
              className="font-body text-[13px] h-9"
            />
          </div>
        </div>

        {/* Reference Ads */}
        {refCreatives.length > 0 && (
          <div className="px-6 pt-4 space-y-2">
            <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">Reference Ads</Label>
            <div className="flex gap-2 flex-wrap">
              {refCreatives.map((c: any) => (
                <div key={c.ad_id} className="w-20 space-y-1">
                  {c.thumbnail_url ? (
                    <img src={c.thumbnail_url} alt={c.ad_name} className="w-20 h-14 object-cover rounded border border-border-light" />
                  ) : (
                    <div className="w-20 h-14 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">No img</div>
                  )}
                  <p className="font-body text-[9px] text-muted-foreground truncate">{c.unique_code || c.ad_name}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator className="my-4" />

        {/* Content sections */}
        <div className="px-6 pb-6 space-y-5">
          {SECTION_DEFS.map((section) => (
            <div key={section.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </Label>
              </div>
              {section.type === "textarea" ? (
                <Textarea
                  value={content[section.key] || ""}
                  onChange={(e) => updateField(section.key, e.target.value)}
                  placeholder={section.placeholder}
                  className="font-body text-[13px] min-h-[80px] resize-y"
                />
              ) : (
                <Input
                  value={content[section.key] || ""}
                  onChange={(e) => updateField(section.key, e.target.value)}
                  placeholder={section.placeholder}
                  className="font-body text-[13px] h-9"
                />
              )}
              {section.key === "concept_name" && content[section.key] && (
                <NamingValidator value={content[section.key] || ""} />
              )}
            </div>
          ))}
        </div>
      </DialogContent>

    </Dialog>
  );
}
