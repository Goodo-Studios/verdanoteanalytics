import { Button } from "@/components/ui/button";
import { GripVertical, ChevronUp, ChevronDown, Eye, EyeOff, Maximize2, Minimize2, Square, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardSection, SectionSize } from "@/hooks/useDashboardLayout";
import { ReactNode } from "react";

const SIZE_LABELS: Record<SectionSize, string> = { sm: "¼", md: "½", lg: "Full" };
const SIZE_CYCLE: SectionSize[] = ["sm", "md", "lg"];

interface Props {
  section: DashboardSection;
  index: number;
  total: number;
  editing: boolean;
  onToggle: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onResize: (id: string, size: SectionSize) => void;
  onRemove: (id: string) => void;
  children: ReactNode;
}

export function EditableSectionWrapper({
  section, index, total, editing, onToggle, onMove, onResize, onRemove, children,
}: Props) {
  if (!editing) return <>{children}</>;

  const cycleSize = () => {
    const idx = SIZE_CYCLE.indexOf(section.size);
    onResize(section.id, SIZE_CYCLE[(idx + 1) % SIZE_CYCLE.length]);
  };

  return (
    <div className={cn(
      "relative rounded-lg border-2 border-dashed transition-all",
      section.visible
        ? "border-verdant/40 bg-verdant/[0.02]"
        : "border-border-light bg-muted/30 opacity-60",
    )}>
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/50 rounded-t-lg border-b border-border-light">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab" />
        <span className="font-label text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex-1">
          {section.label}
        </span>
        <div className="flex items-center gap-0.5">
          {/* Size toggle */}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={cycleSize} title={`Size: ${SIZE_LABELS[section.size]}`}>
            {section.size === "sm" ? <Minimize2 className="h-3 w-3" /> : section.size === "md" ? <Square className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          <span className="font-label text-[9px] text-muted-foreground w-5 text-center">{SIZE_LABELS[section.size]}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMove(section.id, "up")} disabled={index === 0}>
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMove(section.id, "down")} disabled={index === total - 1}>
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className={cn("h-6 w-6", !section.visible && "text-muted-foreground")} onClick={() => onToggle(section.id)}>
            {section.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-600" onClick={() => onRemove(section.id)} title="Remove section">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {section.visible && <div className="p-0">{children}</div>}
      {!section.visible && (
        <div className="py-6 text-center">
          <p className="font-body text-[12px] text-muted-foreground">{section.label} — hidden</p>
        </div>
      )}
    </div>
  );
}
