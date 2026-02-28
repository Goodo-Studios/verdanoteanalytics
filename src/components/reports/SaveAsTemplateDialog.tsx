import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, BookmarkPlus } from "lucide-react";
import { ReportSection } from "@/lib/reportSections";
import { useCreateReportTemplate } from "@/hooks/useReportTemplatesApi";

interface SaveAsTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: ReportSection[];
}

export function SaveAsTemplateDialog({ open, onOpenChange, sections }: SaveAsTemplateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createMut = useCreateReportTemplate();

  const handleSave = () => {
    if (!name.trim()) return;
    createMut.mutate(
      { name: name.trim(), description: description.trim() || undefined, sections },
      {
        onSuccess: () => {
          onOpenChange(false);
          setName("");
          setDescription("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-card rounded-lg p-6">
        <DialogHeader>
          <DialogTitle className="font-heading text-[18px] flex items-center gap-2">
            <BookmarkPlus className="h-4.5 w-4.5 text-muted-foreground" />
            Save as Template
          </DialogTitle>
          <DialogDescription className="font-body text-[13px] text-muted-foreground">
            Save this report's {sections.length} section{sections.length !== 1 ? "s" : ""} as a reusable template.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="font-body text-[13px]">Template Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Monthly Performance Report"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label className="font-body text-[13px]">Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of when to use this template..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!name.trim() || createMut.isPending}
            className="bg-verdant text-white hover:bg-verdant/90"
          >
            {createMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
