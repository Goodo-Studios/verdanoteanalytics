import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useUpdateCreative } from "@/hooks/useCreatives";
import { TYPE_OPTIONS, PERSON_OPTIONS, STYLE_OPTIONS } from "@/lib/tagOptions";
import { TAG_FIELD_LABELS } from "@/lib/tagDisplay";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface BulkTagModalProps {
  open: boolean;
  onClose: () => void;
  adIds: string[];
}

const EMPTY = "__empty__";

export function BulkTagModal({ open, onClose, adIds }: BulkTagModalProps) {
  const updateCreative = useUpdateCreative();
  const [tags, setTags] = useState({
    ad_type: EMPTY, person: EMPTY, style: EMPTY, product: "", hook: "", theme: "",
  });
  const [saving, setSaving] = useState(false);

  const selectFields = [
    { key: "ad_type" as const, label: TAG_FIELD_LABELS.ad_type, options: TYPE_OPTIONS },
    { key: "person" as const, label: TAG_FIELD_LABELS.person, options: PERSON_OPTIONS },
    { key: "style" as const, label: TAG_FIELD_LABELS.style, options: STYLE_OPTIONS },
  ];
  // Free-text columns: a blank field means "no change".
  const textFields = [
    { key: "product" as const, label: TAG_FIELD_LABELS.product },
    { key: "hook" as const, label: TAG_FIELD_LABELS.hook },
    { key: "theme" as const, label: TAG_FIELD_LABELS.theme },
  ];

  const handleSave = async () => {
    const updates: Record<string, string> = {};
    if (tags.ad_type !== EMPTY) updates.ad_type = tags.ad_type;
    if (tags.person !== EMPTY) updates.person = tags.person;
    if (tags.style !== EMPTY) updates.style = tags.style;
    if (tags.product.trim()) updates.product = tags.product.trim();
    if (tags.hook.trim()) updates.hook = tags.hook.trim();
    if (tags.theme.trim()) updates.theme = tags.theme.trim();

    if (Object.keys(updates).length === 0) {
      toast.info("No tags selected to apply");
      return;
    }

    setSaving(true);
    try {
      const results = await Promise.allSettled(adIds.map(adId => updateCreative.mutateAsync({ adId, updates })));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed.length === 0) {
        toast.success(`Tags applied to ${adIds.length} creatives`);
        onClose();
      } else {
        const reason = failed[0].reason instanceof Error ? failed[0].reason.message : String(failed[0].reason);
        toast.error(`Tags failed to apply to ${failed.length} of ${adIds.length} creatives`, { description: reason });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-forest">Tag {adIds.length} Creatives</DialogTitle>
        </DialogHeader>
        <p className="font-body text-[13px] text-muted-foreground mb-2">
          Only changed fields will be applied. Leave a field as "No change" to keep existing values.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {selectFields.map(({ key, label, options }) => (
            <div key={key} className="space-y-1.5">
              <Label className="font-label text-[11px] uppercase tracking-wider">{label}</Label>
              <Select value={tags[key]} onValueChange={(v) => setTags({ ...tags, [key]: v })}>
                <SelectTrigger className="bg-background h-8 text-xs font-body">
                  <SelectValue placeholder="No change" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY}>No change</SelectItem>
                  {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
          {textFields.map(({ key, label }) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`bulk-tag-${key}`} className="font-label text-[11px] uppercase tracking-wider">{label}</Label>
              <Input id={`bulk-tag-${key}`} className="bg-background h-8 text-xs font-body" value={tags[key]} onChange={(e) => setTags({ ...tags, [key]: e.target.value })} placeholder="Leave blank to skip" />
            </div>
          ))}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
            Apply to {adIds.length} creatives
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
