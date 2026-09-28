import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useUpdateCreative } from "@/hooks/useCreatives";
import { useAuth } from "@/contexts/AuthContext";
import { TYPE_OPTIONS, PERSON_OPTIONS, STYLE_OPTIONS } from "@/lib/tagOptions";
import { TAG_FIELD_LABELS } from "@/lib/tagDisplay";
import { SyncFromNameDialog } from "@/components/creatives/SyncFromNameDialog";
import { FileText, Loader2, RotateCcw, Save } from "lucide-react";
import { useState, useEffect } from "react";

interface CreativeTagEditorProps {
  creative: any;
}

type TagState = {
  ad_type: string; person: string; style: string; product: string; hook: string; theme: string;
};

const CLEAR = "__clear__";

const SELECT_FIELDS = [
  { key: "ad_type", options: TYPE_OPTIONS },
  { key: "person", options: PERSON_OPTIONS },
  { key: "style", options: STYLE_OPTIONS },
] as const;

const TEXT_FIELDS = [
  { key: "product", placeholder: "Product name" },
  { key: "hook", placeholder: "Hook" },
  { key: "theme", placeholder: "Theme" },
] as const;

export function CreativeTagEditor({ creative }: CreativeTagEditorProps) {
  const updateCreative = useUpdateCreative();
  const { isBuilder, isEmployee } = useAuth();
  const canSyncFromName = isBuilder || isEmployee;
  const [syncOpen, setSyncOpen] = useState(false);
  const [tags, setTags] = useState<TagState>({
    ad_type: "", person: "", style: "", product: "", hook: "", theme: "",
  });

  useEffect(() => {
    if (creative) {
      setTags({
        ad_type: creative.ad_type || "",
        person: creative.person || "",
        style: creative.style || "",
        product: creative.product || "",
        hook: creative.hook || "",
        theme: creative.theme || "",
      });
    }
    // Re-seed when the creative or its stored tags change (e.g. after a sync).
  }, [creative?.ad_id, creative?.ad_type, creative?.person, creative?.style, creative?.product, creative?.hook, creative?.theme]);

  const handleSave = () => {
    const updates: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(tags)) updates[k] = v.trim() === "" ? null : v.trim();
    updateCreative.mutate({ adId: creative.ad_id, updates });
  };

  const handleResetToAuto = () => {
    updateCreative.mutate({ adId: creative.ad_id, updates: { tag_source: "untagged" } });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold">Tags</h3>
        <div className="flex gap-2 flex-wrap">
          {canSyncFromName && (
            <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)} disabled={updateCreative.isPending}>
              <FileText className="h-3 w-3 mr-1" />Sync from name
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleResetToAuto} disabled={updateCreative.isPending}>
            <RotateCcw className="h-3 w-3 mr-1" />Reset to Auto
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateCreative.isPending}>
            {updateCreative.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
            Save Tags
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {SELECT_FIELDS.map(({ key, options }) => {
          const label = TAG_FIELD_LABELS[key];
          const value = tags[key];
          const all = value && !(options as readonly string[]).includes(value) ? [value, ...options] : options;
          return (
            <div key={key} className="space-y-1.5">
              <Label className="text-xs">{label}</Label>
              <Select value={value} onValueChange={(v) => setTags({ ...tags, [key]: v === CLEAR ? "" : v })}>
                <SelectTrigger aria-label={label} className="bg-background h-8 text-xs"><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger>
                <SelectContent>
                  {value && <SelectItem value={CLEAR} className="italic text-muted-foreground">Clear</SelectItem>}
                  {all.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          );
        })}
        {TEXT_FIELDS.map(({ key, placeholder }) => (
          <div key={key} className="space-y-1.5">
            <Label className="text-xs" htmlFor={`tag-${key}`}>{TAG_FIELD_LABELS[key]}</Label>
            <Input
              id={`tag-${key}`}
              className="bg-background h-8 text-xs"
              value={tags[key]}
              onChange={(e) => setTags({ ...tags, [key]: e.target.value })}
              placeholder={placeholder}
            />
          </div>
        ))}
      </div>
      {canSyncFromName && creative?.ad_id && (
        <SyncFromNameDialog open={syncOpen} onClose={() => setSyncOpen(false)} adIds={[creative.ad_id]} />
      )}
    </div>
  );
}
