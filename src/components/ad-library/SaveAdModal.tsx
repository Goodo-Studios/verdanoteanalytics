import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveAd } from "@/hooks/useAdLibrary";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const INITIAL = {
  source_url: "",
  advertiser_name: "",
  headline: "",
  body_text: "",
  cta_text: "",
  thumbnail_url: "",
  landing_page_url: "",
  ad_format: "image",
  platform: "facebook",
  notes: "",
};

export function SaveAdModal({ open, onOpenChange }: Props) {
  const saveAd = useSaveAd();
  const [form, setForm] = useState({ ...INITIAL });
  const set = (key: string, val: string) => setForm((p) => ({ ...p, [key]: val }));

  const handleSave = () => {
    if (!form.source_url.trim()) return;
    saveAd.mutate(form, {
      onSuccess: () => {
        onOpenChange(false);
        setForm({ ...INITIAL });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg text-forest">Save Ad to Library</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-sage">Source URL *</Label>
            <Input value={form.source_url} onChange={(e) => set("source_url", e.target.value)} placeholder="https://www.facebook.com/ads/library/..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-sage">Advertiser Name</Label>
              <Input value={form.advertiser_name} onChange={(e) => set("advertiser_name", e.target.value)} placeholder="e.g. Nike" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-sage">Platform</Label>
              <Select value={form.platform} onValueChange={(v) => set("platform", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-sage">Headline</Label>
            <Input value={form.headline} onChange={(e) => set("headline", e.target.value)} placeholder="Primary text or headline" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-sage">Body Text</Label>
            <Textarea value={form.body_text} onChange={(e) => set("body_text", e.target.value)} rows={2} placeholder="Ad copy" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-sage">CTA Text</Label>
              <Input value={form.cta_text} onChange={(e) => set("cta_text", e.target.value)} placeholder="Shop Now" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-sage">Ad Format</Label>
              <Select value={form.ad_format} onValueChange={(v) => set("ad_format", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Image</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="carousel">Carousel</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          <div className="space-y-1.5">
            <Label className="text-xs text-sage">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Why you're saving this ad..." />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saveAd.isPending || !form.source_url.trim()}>
            {saveAd.isPending ? "Saving..." : "Save Ad"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
