import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, FileText, ArrowRight } from "lucide-react";
import { SECTION_TYPE_META, SectionType, ReportSection, createSection } from "@/lib/reportSections";
import { useReportTemplates, type ReportTemplate } from "@/hooks/useReportTemplatesApi";
import { cn } from "@/lib/utils";

interface TemplateChooserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (sections: ReportSection[]) => void;
}

export function TemplateChooserDialog({ open, onOpenChange, onSelect }: TemplateChooserDialogProps) {
  const { data: templates, isLoading } = useReportTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleApply = () => {
    if (selectedId === "blank") {
      onSelect([]);
      onOpenChange(false);
      return;
    }
    const tpl = templates?.find((t) => t.id === selectedId);
    if (!tpl) return;
    // Create fresh section IDs so they're unique per report
    const freshSections: ReportSection[] = (tpl.sections || []).map((s: any) => ({
      ...createSection(s.type as SectionType),
      config: { ...s.config },
    }));
    onSelect(freshSections);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card rounded-lg p-6">
        <DialogHeader>
          <DialogTitle className="font-heading text-[20px]">Choose a Template</DialogTitle>
          <DialogDescription className="font-body text-[13px] text-muted-foreground">
            Start with a pre-built template or a blank report.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-2 max-h-[50vh] overflow-y-auto pr-1">
            {/* Blank option */}
            <button
              onClick={() => setSelectedId("blank")}
              className={cn(
                "w-full text-left rounded-lg border p-3 transition-colors hover:bg-accent/50",
                selectedId === "blank" ? "border-primary bg-primary/5" : "border-border"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="font-heading text-[14px] font-semibold text-foreground">Blank Report</span>
              </div>
              <p className="font-body text-[11px] text-muted-foreground">Start from scratch and add sections manually.</p>
            </button>

            {(templates || []).map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  "w-full text-left rounded-lg border p-3 transition-colors hover:bg-accent/50",
                  selectedId === t.id ? "border-primary bg-primary/5" : "border-border"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-heading text-[14px] font-semibold text-foreground">{t.name}</span>
                  {t.is_default && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">Default</Badge>
                  )}
                </div>
                {t.description && (
                  <p className="font-body text-[11px] text-muted-foreground mb-1.5">{t.description}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {(t.sections || []).map((s: any, i: number) => {
                    const meta = SECTION_TYPE_META[s.type as SectionType];
                    return meta ? (
                      <Badge key={i} variant="outline" className="text-[9px] font-normal gap-0.5 py-0">
                        <span className="text-[10px]">{meta.icon}</span> {meta.label}
                      </Badge>
                    ) : null;
                  })}
                </div>
              </button>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            disabled={!selectedId}
            onClick={handleApply}
            className="bg-verdant text-white hover:bg-verdant/90"
          >
            Apply <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
