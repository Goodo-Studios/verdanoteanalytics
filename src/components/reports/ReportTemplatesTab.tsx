import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Trash2, Pencil, Star, Loader2, FileText } from "lucide-react";
import { SECTION_TYPE_META, SectionType } from "@/lib/reportSections";
import {
  useReportTemplates,
  useDeleteReportTemplate,
  useUpdateReportTemplate,
  type ReportTemplate,
} from "@/hooks/useReportTemplatesApi";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

export function ReportTemplatesTab() {
  const { data: templates, isLoading } = useReportTemplates();
  const deleteMut = useDeleteReportTemplate();
  const updateMut = useUpdateReportTemplate();
  const [editing, setEditing] = useState<ReportTemplate | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const openEdit = (t: ReportTemplate) => {
    setEditing(t);
    setEditName(t.name);
    setEditDesc(t.description || "");
  };

  const handleSaveEdit = () => {
    if (!editing) return;
    updateMut.mutate(
      { id: editing.id, name: editName, description: editDesc },
      { onSuccess: () => setEditing(null) }
    );
  };

  const handleSetDefault = (t: ReportTemplate) => {
    updateMut.mutate({ id: t.id, is_default: !t.is_default });
  };

  if (isLoading) return <TableSkeleton rows={4} cols={3} />;

  return (
    <div className="space-y-4">
      {!templates?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-heading text-[18px] text-foreground mb-1">No templates</h3>
          <p className="font-body text-[13px] text-muted-foreground max-w-[360px]">
            Save a report's section structure as a template from the report editor.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-border bg-card p-4 flex items-start justify-between gap-4 group"
            >
              <div className="space-y-2 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-heading text-[15px] font-semibold text-foreground truncate">{t.name}</h3>
                  {t.is_default && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">Default</Badge>
                  )}
                </div>
                {t.description && (
                  <p className="font-body text-[12px] text-muted-foreground line-clamp-1">{t.description}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {(t.sections || []).map((s: any, i: number) => {
                    const meta = SECTION_TYPE_META[s.type as SectionType];
                    return meta ? (
                      <Badge key={i} variant="outline" className="text-[10px] font-normal gap-1 py-0.5">
                        <span>{meta.icon}</span> {meta.label}
                      </Badge>
                    ) : null;
                  })}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  title={t.is_default ? "Remove default" : "Set as default"}
                  onClick={() => handleSetDefault(t)}
                >
                  <Star className={`h-3.5 w-3.5 ${t.is_default ? "fill-gold text-gold" : "text-muted-foreground"}`} />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(t)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive"
                  onClick={() => deleteMut.mutate(t.id)}
                  disabled={deleteMut.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm bg-card rounded-lg p-6">
          <DialogHeader>
            <DialogTitle className="font-heading text-[18px]">Edit Template</DialogTitle>
            <DialogDescription className="font-body text-[13px] text-muted-foreground">
              Update this template's name and description.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="font-body text-[13px]">Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="font-body text-[13px]">Description</Label>
              <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" onClick={handleSaveEdit} disabled={updateMut.isPending || !editName.trim()}>
              {updateMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
