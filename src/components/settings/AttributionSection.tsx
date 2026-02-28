import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useUpdateAccountSettings } from "@/hooks/useAccountsApi";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";

export const INDUSTRY_CATEGORIES = [
  { value: "dtc_general", label: "DTC General", avgRoas: "1.5–3.0x" },
  { value: "apparel", label: "Apparel", avgRoas: "2.0–4.0x" },
  { value: "beauty", label: "Beauty", avgRoas: "2.5–5.0x" },
  { value: "food_bev", label: "Food & Bev", avgRoas: "1.2–2.5x" },
  { value: "pet", label: "Pet", avgRoas: "1.8–3.5x" },
  { value: "home", label: "Home", avgRoas: "1.5–3.0x" },
  { value: "health", label: "Health", avgRoas: "2.0–4.5x" },
  { value: "software", label: "Software", avgRoas: "1.0–2.0x" },
] as const;

interface AttributionSectionProps {
  account: any;
}

export function AttributionSection({ account }: AttributionSectionProps) {
  const update = useUpdateAccountSettings();
  const [clickWindow, setClickWindow] = useState<string>(String(account?.click_window ?? 7));
  const [viewWindow, setViewWindow] = useState<string>(String(account?.view_window ?? 1));
  const [attrModel, setAttrModel] = useState<string>(account?.attribution_model ?? "last_touch");
  const [notes, setNotes] = useState<string>(account?.attribution_notes ?? "");
  const [category, setCategory] = useState<string>(account?.industry_category ?? "");

  useEffect(() => {
    if (account) {
      setClickWindow(String(account.click_window ?? 7));
      setViewWindow(String(account.view_window ?? 1));
      setAttrModel(account.attribution_model ?? "last_touch");
      setNotes(account.attribution_notes ?? "");
      setCategory(account.industry_category ?? "");
    }
  }, [account?.id]);

  const handleSave = () => {
    if (!account) return;
    update.mutate({
      id: account.id,
      click_window: parseInt(clickWindow),
      view_window: parseInt(viewWindow),
      attribution_model: attrModel,
      attribution_notes: notes || null,
      industry_category: category || null,
    } as any);
  };

  const clickLabel = clickWindow === "1" ? "1-day click" : clickWindow === "7" ? "7-day click" : "28-day click";
  const viewLabel = viewWindow === "0" ? "No view-through" : "1-day view";

  return (
    <section className="glass-panel p-6 space-y-5">
      <div>
        <h2 className="font-heading text-[20px] text-forest">Attribution Window</h2>
        <p className="font-body text-[12px] text-muted-foreground mt-0.5">
          Configure the attribution window that matches your Meta Ads Manager setup.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="font-label text-[11px] uppercase tracking-wide text-slate">Click Window</Label>
          <Select value={clickWindow} onValueChange={setClickWindow}>
            <SelectTrigger className="font-body text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1-day click</SelectItem>
              <SelectItem value="7">7-day click</SelectItem>
              <SelectItem value="28">28-day click</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="font-label text-[11px] uppercase tracking-wide text-slate">View Window</Label>
          <Select value={viewWindow} onValueChange={setViewWindow}>
            <SelectTrigger className="font-body text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Off</SelectItem>
              <SelectItem value="1">1-day view</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="font-label text-[11px] uppercase tracking-wide text-slate">Attribution Model</Label>
          <Select value={attrModel} onValueChange={setAttrModel}>
            <SelectTrigger className="font-body text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="last_touch">Last Touch</SelectItem>
              <SelectItem value="linear">Linear</SelectItem>
              <SelectItem value="data_driven">Data-Driven</SelectItem>
            </SelectContent>
          </Select>
          <p className="font-body text-[10px] text-muted-foreground">Informational only — set in Meta Ads Manager.</p>
        </div>

        <div className="space-y-1.5">
          <Label className="font-label text-[11px] uppercase tracking-wide text-slate">Industry Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="font-body text-[13px]">
              <SelectValue placeholder="Select category…" />
            </SelectTrigger>
            <SelectContent>
              {INDUSTRY_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Preview badge */}
      <div className="flex items-center gap-2">
        <span className="font-label text-[10px] uppercase tracking-wide text-muted-foreground">Preview:</span>
        <span className="font-data text-[12px] font-medium bg-muted px-2 py-1 rounded-md text-foreground">
          {clickLabel} · {viewLabel}
        </span>
      </div>

      <div className="space-y-1.5">
        <Label className="font-label text-[11px] uppercase tracking-wide text-slate">Attribution Notes</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="font-body text-[13px] min-h-[60px]"
          placeholder='e.g. "We use 7-day click because our product has a 5-day consideration period"'
        />
      </div>

      <Button onClick={handleSave} disabled={update.isPending} className="gap-1.5 font-body text-[12px]">
        {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Save Attribution Settings
      </Button>
    </section>
  );
}
