import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bookmark } from "lucide-react";
import { useCreateSegment } from "@/hooks/useSegmentsApi";
import type { AdvancedConditions } from "@/components/creatives/AdvancedFiltersPanel";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

interface SaveAsSegmentButtonProps {
  conditions: AdvancedConditions;
  accountId?: string | null;
}

export function SaveAsSegmentButton({ conditions, accountId }: SaveAsSegmentButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const createSegment = useCreateSegment();

  const handleSave = () => {
    if (!name.trim()) return;
    createSegment.mutate({
      name: name.trim(),
      description: desc.trim() || undefined,
      filter_config: conditions.map(({ field, operator, value, valueTo, multiValues }) =>
        ({ field, operator, value, valueTo, multiValues })
      ),
      account_id: accountId && accountId !== "all" ? accountId : null,
      color,
    }, {
      onSuccess: () => {
        setOpen(false);
        setName("");
        setDesc("");
      },
    });
  };

  if (conditions.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 font-body text-[12px] w-full">
          <Bookmark className="h-3.5 w-3.5" />
          Save as Segment
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <p className="font-heading text-[14px] text-foreground">Save Segment</p>
        <div>
          <Label className="font-label text-[11px] uppercase">Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. UGC Winners" className="mt-1 h-8 text-[13px]" />
        </div>
        <div>
          <Label className="font-label text-[11px] uppercase">Description</Label>
          <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional" className="mt-1 h-8 text-[13px]" />
        </div>
        <div>
          <Label className="font-label text-[11px] uppercase">Color</Label>
          <div className="flex gap-2 mt-1.5">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-5 w-5 rounded-full border-2 transition-all ${color === c ? "border-foreground scale-110" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <Button size="sm" onClick={handleSave} disabled={!name.trim() || createSegment.isPending} className="w-full">
          Save Segment
        </Button>
      </PopoverContent>
    </Popover>
  );
}
