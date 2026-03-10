import { LayoutGrid, FileText, FileEdit, Users, FlaskConical, Hash } from "lucide-react";

export const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  creatives: { label: "Creatives", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  concepts: { label: "Concepts", icon: <Hash className="h-3.5 w-3.5" /> },
  reports: { label: "Reports", icon: <FileText className="h-3.5 w-3.5" /> },
  briefs: { label: "Briefs", icon: <FileEdit className="h-3.5 w-3.5" /> },
  creators: { label: "Creators", icon: <Users className="h-3.5 w-3.5" /> },
  tests: { label: "Tests", icon: <FlaskConical className="h-3.5 w-3.5" /> },
};
