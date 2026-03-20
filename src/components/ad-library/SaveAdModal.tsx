import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveAd } from "@/hooks/useAdLibrary";
import { useAccountContext } from "@/contexts/AccountContext";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaveAdModal({ open, onOpenChange }: Props) {
  const { selectedAccountId } = useAccountContext();
  const saveAd = useSaveAd();

  const [form, setForm] = useState({
    brand_name: "",
    headline: "",
    body_text: "",
    thumbnail_url: "",
    landing_page_url: "",
    media_type: "image",
    platform: "meta",
    tags: "",
    notes: "",
    source: "manual",
  });

  const set = (key: string, val: string) => setForm((p) => ({ ...p, [key]: val }));

  const handleSave = () => {
    saveAd.mutate(
      {
        ...form,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        account_id: selectedAccountId === "all" ? null : selectedAccountId,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setForm({
            brand_name: "",
            headline: "",
            body_text: "",
            thumbnail_url: "",
            landing_page_url: "",
            media_type: "image",
            platform: "meta",
            tags: "",
            notes: "",
            source: "manual",
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg text-forest">Save Ad to Library</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-sage">Brand Name</Label>
              <Input value={form.brand_name} onChange={(e) => set("brand_name", e.target.value)} placeholder="e.g. Nike" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-sage">Platform</Label>
              <Select value={form.platform} onValueChange={(v) => set("platform", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="meta">Meta</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-sage">Headline / Ad Name</Label>
            <Input value={form.headline} onChange={(e) => set("headline", e.target.value)} placeholder="Primary text or headline" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-sage">Body Text</Label>
            <Textarea value={form.body_text} onChange={(e) => set("body_text", e.target.value)} rows={2} placeholder="Ad copy" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-sage">Thumbnail URL</Label>
              <Input value={form.thumbnail_url} onChange={(e) => set("thumbnail_url", e.target.value)} placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-sage">Landing Page URL</Label>
              <Input value={form.landing_page_url} onChange={(e) => set("landing_page_url", e.target.value)} placeholder="https://..." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-sage">Media Type</Label>
              <Select value={form.media_type} onValueChange={(v) => set("media_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Image</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="carousel">Carousel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-sage">Tags (comma-separated)</Label>
              <Input value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="ugc, testimonial, hook" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-sage">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Why you're saving this ad..." />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saveAd.isPending}>
            {saveAd.isPending ? "Saving..." : "Save Ad"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
