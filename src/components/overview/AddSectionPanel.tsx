import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface AddSectionPanelProps {
  sections: { id: string; label: string; description: string }[];
  onAdd: (id: string) => void;
  open: boolean;
  onClose: () => void;
}

export function AddSectionPanel({ sections, onAdd, open, onClose }: AddSectionPanelProps) {
  if (!open) return null;

  return (
    <div className="rounded-card border border-verdant/30 bg-verdant/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-[15px] text-forest">Add Section</h3>
        <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onClose}>Close</Button>
      </div>
      {sections.length === 0 ? (
        <p className="font-body text-[12px] text-muted-foreground">All sections are already on your dashboard.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => { onAdd(s.id); onClose(); }}
              className={cn(
                "text-left border border-border-light rounded-[8px] p-3 hover:border-verdant/50 hover:bg-verdant/[0.03] transition-all cursor-pointer",
              )}
            >
              <div className="flex items-center gap-2">
                <Plus className="h-3.5 w-3.5 text-verdant shrink-0" />
                <span className="font-body text-[13px] font-medium text-charcoal">{s.label}</span>
              </div>
              <p className="font-body text-[11px] text-slate mt-1 ml-5.5">{s.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
