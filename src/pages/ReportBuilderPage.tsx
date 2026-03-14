import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SectionRenderer } from "@/components/reports/SectionRenderer";
import {
  ReportSection,
  SECTION_TYPE_META,
  standardReportSections,
  legacySectionsFromReport,
} from "@/lib/reportSections";
import { useParams } from "react-router-dom";
import { useRoleNavigate } from "@/hooks/useRolePath";
import { useState, useCallback, useEffect } from "react";
import { useReports, useUpdateReportSections } from "@/hooks/useReportsApi";
import { ArrowLeft, Save, Loader2, Eye, Pencil } from "lucide-react";

const ReportBuilderPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useRoleNavigate();
  const { data: reports, isLoading } = useReports();
  const updateSections = useUpdateReportSections();

  const report = reports?.find((r: any) => r.id === id);

  const [sections, setSections] = useState<ReportSection[]>([]);
  const [reportName, setReportName] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (report && !initialized) {
      setReportName(report.report_name || "");
      if (report.sections && Array.isArray(report.sections) && report.sections.length > 0) {
        setSections(report.sections as ReportSection[]);
      } else {
        setSections(legacySectionsFromReport(report));
      }
      setInitialized(true);
    }
  }, [report, initialized]);

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

        {/* Fixed Sections */}
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.id}>
              {!previewMode && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">{SECTION_TYPE_META[section.type]?.icon}</span>
                  <Badge variant="secondary" className="font-label text-[10px] uppercase tracking-wider">
                    {SECTION_TYPE_META[section.type]?.label}
                  </Badge>
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
      </div>
    </AppLayout>
  );
};

export default ReportBuilderPage;
