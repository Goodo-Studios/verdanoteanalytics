import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Pencil, Plus, Filter } from "lucide-react";
import { useSegments, useCreateSegment, useDeleteSegment, useUpdateSegment, type Segment } from "@/hooks/useSegmentsApi";
import { useAllCreatives } from "@/hooks/useAllCreatives";
import { applyAdvancedFilters, type AdvancedConditions } from "@/components/creatives/AdvancedFiltersPanel";
import { gradeCreatives } from "@/lib/creativeGrading";
import { computeFatigueMap } from "@/lib/fatigueScore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

function summarizeFilters(config: any[]): string {
  if (!Array.isArray(config) || config.length === 0) return "No filters";
  return config.map((c: any) => {
    const val = c.multiValues?.length ? c.multiValues.join(", ") : c.value || "";
    return `${c.field} ${c.operator} ${val}`;
  }).join(" + ");
}

const SegmentsPage = () => {
  const { data: segments = [], isLoading } = useSegments();
  const { data: allCreatives = [] } = useAllCreatives({});
  const createSegment = useCreateSegment();
  const deleteSegment = useDeleteSegment();
  const updateSegment = useUpdateSegment();
  const navigate = useNavigate();

  const [editSegment, setEditSegment] = useState<Segment | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editColor, setEditColor] = useState(COLORS[0]);

  const creativesArr = Array.isArray(allCreatives) ? allCreatives : [];
  const gradeMap = useMemo(() => gradeCreatives(creativesArr, 1.0), [creativesArr]);
  const fatigueMap = useMemo(() => computeFatigueMap(creativesArr), [creativesArr]);

  const getCount = (config: any[]) => {
    const conditions = (config || []) as AdvancedConditions;
    return applyAdvancedFilters(creativesArr, conditions, gradeMap, fatigueMap).length;
  };

  const handleEdit = (seg: Segment) => {
    setEditSegment(seg);
    setEditName(seg.name);
    setEditDesc(seg.description || "");
    setEditColor(seg.color || COLORS[0]);
  };

  const handleSaveEdit = () => {
    if (!editSegment) return;
    updateSegment.mutate({
      id: editSegment.id,
      name: editName,
      description: editDesc || undefined,
      color: editColor,
    }, { onSuccess: () => setEditSegment(null) });
  };

  const handleApply = (seg: Segment) => {
    const params = new URLSearchParams();
    params.set("adv", JSON.stringify(seg.filter_config));
    navigate(`/creatives?${params.toString()}`);
  };

  return (
    <AppLayout>
      <PageHeader
        title="Segments"
        description="Named filter groups to track creative cohorts over time."
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : segments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Filter className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-heading text-[20px] text-foreground mb-1">No segments yet</h3>
          <p className="font-body text-[14px] text-muted-foreground max-w-md">
            Create segments from the Advanced Filters panel on the Creatives page to track creative cohorts.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {segments.map(seg => (
            <div key={seg.id} className="bg-card border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color || COLORS[0] }} />
                  <h4 className="font-heading text-[15px] text-foreground">{seg.name}</h4>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(seg)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteSegment.mutate(seg.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {seg.description && (
                <p className="font-body text-[12px] text-muted-foreground">{seg.description}</p>
              )}

              <p className="font-body text-[11px] text-muted-foreground">
                {summarizeFilters(seg.filter_config)}
              </p>

              <div className="flex items-center justify-between pt-1 border-t border-border">
                <span className="font-data text-[14px] font-semibold text-foreground tabular-nums">
                  {getCount(seg.filter_config)} creatives
                </span>
                <Button size="sm" variant="outline" onClick={() => handleApply(seg)} className="font-body text-[12px]">
                  Apply filters →
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      <Dialog open={!!editSegment} onOpenChange={v => !v && setEditSegment(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-[18px]">Edit Segment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="font-label text-[11px] uppercase">Name</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="font-label text-[11px] uppercase">Description</Label>
              <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} className="mt-1" placeholder="Optional" />
            </div>
            <div>
              <Label className="font-label text-[11px] uppercase">Color</Label>
              <div className="flex gap-2 mt-1.5">
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setEditColor(c)}
                    className={`h-6 w-6 rounded-full border-2 transition-all ${editColor === c ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <Button onClick={handleSaveEdit} disabled={!editName.trim() || updateSegment.isPending} className="w-full">
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default SegmentsPage;
