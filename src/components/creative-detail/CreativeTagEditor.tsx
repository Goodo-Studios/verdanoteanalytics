import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useUpdateCreative } from "@/hooks/useCreatives";
import { TYPE_OPTIONS, PERSON_OPTIONS, STYLE_OPTIONS, HOOK_OPTIONS } from "@/lib/tagOptions";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useState, useEffect } from "react";

interface CreativeTagEditorProps {
  creative: any;
}

export function CreativeTagEditor({ creative }: CreativeTagEditorProps) {
  const updateCreative = useUpdateCreative();
  const [tags, setTags] = useState({
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
  }, [creative?.ad_id]);

  const handleSave = () => {
    updateCreative.mutate({ adId: creative.ad_id, updates: tags });
  };

  const handleResetToAuto = () => {
    updateCreative.mutate({ adId: creative.ad_id, updates: { tag_source: "untagged" } });
  };

  const selectFields = [
    { key: "ad_type", label: "Type", options: TYPE_OPTIONS },
    { key: "person", label: "Person", options: PERSON_OPTIONS },
    { key: "style", label: "Style", options: STYLE_OPTIONS },
    { key: "hook", label: "Hook", options: HOOK_OPTIONS },
  ] as const;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Tags</h3>
        <div className="flex gap-2">
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
        {selectFields.map(({ key, label, options }) => (
          <div key={key} className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            <Select value={tags[key]} onValueChange={(v) => setTags({ ...tags, [key]: v })}>
              <SelectTrigger className="bg-background h-8 text-xs"><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger>
              <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}
        <div className="space-y-1.5">
          <Label className="text-xs">Product</Label>
          <Input className="bg-background h-8 text-xs" value={tags.product} onChange={(e) => setTags({ ...tags, product: e.target.value })} placeholder="Product name" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Theme</Label>
          <Input className="bg-background h-8 text-xs" value={tags.theme} onChange={(e) => setTags({ ...tags, theme: e.target.value })} placeholder="Theme / angle" />
        </div>
      </div>
    </div>
  );
}
