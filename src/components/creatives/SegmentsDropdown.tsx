import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter } from "lucide-react";
import { useSegments, type Segment } from "@/hooks/useSegmentsApi";
import type { AdvancedConditions } from "@/components/creatives/AdvancedFiltersPanel";
import { useState } from "react";

interface SegmentsDropdownProps {
  onApply: (conditions: AdvancedConditions) => void;
}

let _idCounter = 1000;

export function SegmentsDropdown({ onApply }: SegmentsDropdownProps) {
  const { data: segments = [] } = useSegments();
  const [open, setOpen] = useState(false);

  if (segments.length === 0) return null;

  const handleApply = (seg: Segment) => {
    const conditions: AdvancedConditions = (seg.filter_config || []).map((c: any) => ({
      ...c,
      id: `seg_${++_idCounter}`,
    }));
    onApply(conditions);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 font-body text-[12px]">
          <Filter className="h-3.5 w-3.5" />
          Segments
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2 space-y-0.5">
        <p className="font-label text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
          Apply segment filters
        </p>
        {segments.map(seg => (
          <button
            key={seg.id}
            onClick={() => handleApply(seg)}
            className="flex items-center gap-2 w-full px-2 py-2 rounded-md hover:bg-accent transition-colors text-left"
          >
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color || "#6366f1" }} />
            <span className="font-body text-[13px] text-foreground truncate">{seg.name}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
