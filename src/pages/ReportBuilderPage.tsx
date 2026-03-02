import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SectionRenderer } from "@/components/reports/SectionRenderer";
import { SaveAsTemplateDialog } from "@/components/reports/SaveAsTemplateDialog";
import {
  ReportSection,
  SectionType,
  SECTION_TYPE_META,
  createSection,
  legacySectionsFromReport,
} from "@/lib/reportSections";
import { useParams, useLocation } from "react-router-dom";
import { useRoleNavigate } from "@/hooks/useRolePath";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useReports, useUpdateReportSections } from "@/hooks/useReportsApi";
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Save, Loader2, Eye, Pencil, BookmarkPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ReportBuilderPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useRoleNavigate();
  const location = useLocation();
  const { data: reports, isLoading } = useReports();
  const updateSections = useUpdateReportSections();

  const report = useMemo(() => reports?.find((r: any) => r.id === id), [reports, id]);

  const [sections, setSections] = useState<ReportSection[]>([]);
  const [reportName, setReportName] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);

  useEffect(() => {
    if (report && !initialized) {
      setReportName(report.report_name || "");
      // Check if template sections were passed via navigation state
      const templateSections = (location.state as any)?.templateSections;
      if (templateSections && Array.isArray(templateSections) && templateSections.length > 0) {
        setSections(templateSections as ReportSection[]);
      } else if (report.sections && Array.isArray(report.sections) && report.sections.length > 0) {
        setSections(report.sections as ReportSection[]);
      } else {
        setSections(legacySectionsFromReport(report));
      }
      setInitialized(true);
    }
  }, [report, initialized, location.state]);

  const addSection = useCallback((type: SectionType) => {
    setSections((prev) => [...prev, createSection(type)]);
  }, []);

  const removeSection = useCallback((sectionId: string) => {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
  }, []);

  const moveSection = useCallback((index: number, direction: "up" | "down") => {
    setSections((prev) => {
      const next = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }, []);

  const updateSectionConfig = useCallback((sectionId: string, config: Record<string, any>) => {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, config } : s))
    );
  }, []);

  const handleSave = () => {
    if (!id) return;
    updateSections.mutate(
      { id, sections, report_name: reportName },
      { onSuccess: () => navigate(`/reports/${id}`) }
    );
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!report) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h3 className="font-heading text-[18px] text-foreground mb-2">Report not found</h3>
          <Button variant="outline" size="sm" onClick={() => navigate("/reports")}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Reports
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <button
              onClick={() => navigate(`/reports/${id}`)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />Back to Report
            </button>
            <Input
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              className="font-heading text-[24px] font-semibold text-foreground border-none bg-transparent p-0 h-auto focus-visible:ring-0 placeholder:text-muted-foreground"
              placeholder="Report name..."
            />
            <p className="font-body text-[13px] text-muted-foreground">
              {report.date_range_start && report.date_range_end
                ? `${new Date(report.date_range_start).toLocaleDateString()} – ${new Date(report.date_range_end).toLocaleDateString()}`
                : ""}
              {report.date_range_days ? ` · ${report.date_range_days} days` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-6">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPreviewMode(!previewMode)}
            >
              {previewMode ? <Pencil className="h-3.5 w-3.5 mr-1.5" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
              {previewMode ? "Edit" : "Preview"}
            </Button>
            {sections.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowSaveAsTemplate(true)}
              >
                <BookmarkPlus className="h-3.5 w-3.5 mr-1.5" />
                Save as Template
              </Button>
            )}
            <Button
              size="sm"
              className="bg-verdant text-white hover:bg-verdant/90"
              onClick={handleSave}
              disabled={updateSections.isPending}
            >
              {updateSections.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save
            </Button>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-4">
          {sections.map((section, index) => (
            <div key={section.id} className="group relative">
              {!previewMode && (
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{SECTION_TYPE_META[section.type].icon}</span>
                    <Badge variant="secondary" className="font-label text-[10px] uppercase tracking-wider">
                      {SECTION_TYPE_META[section.type].label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => moveSection(index, "up")}
                      disabled={index === 0}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => moveSection(index, "down")}
                      disabled={index === sections.length - 1}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive"
                      onClick={() => removeSection(section.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
              <div className={!previewMode ? "rounded-card border border-border-light bg-card p-4 shadow-card" : ""}>
                <SectionRenderer
                  section={section}
                  report={report}
                  isEditing={!previewMode}
                  onConfigChange={(config) => updateSectionConfig(section.id, config)}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Add Section Button */}
        {!previewMode && (
          <div className="flex justify-center py-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="border-dashed border-2 px-6">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Section
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-56">
                {(Object.entries(SECTION_TYPE_META) as [SectionType, typeof SECTION_TYPE_META[SectionType]][]).map(
                  ([type, meta]) => (
                    <DropdownMenuItem
                      key={type}
                      onClick={() => addSection(type)}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <span>{meta.icon}</span>
                      <div>
                        <div className="font-body text-[13px] font-medium">{meta.label}</div>
                        <div className="font-body text-[11px] text-muted-foreground">{meta.description}</div>
                      </div>
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <SaveAsTemplateDialog open={showSaveAsTemplate} onOpenChange={setShowSaveAsTemplate} sections={sections} />
    </AppLayout>
  );
};

export default ReportBuilderPage;
