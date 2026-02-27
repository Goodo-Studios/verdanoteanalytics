import { useState, useCallback, useEffect } from "react";

export interface DashboardSection {
  id: string;
  label: string;
  description: string;
  visible: boolean;
}

const DEFAULT_SECTIONS: DashboardSection[] = [
  { id: "metrics", label: "Metrics Row", description: "Spend, ROAS, CPA, CTR, Win Rate", visible: true },
  { id: "goals", label: "Goals Bar", description: "Progress toward account targets", visible: true },
  { id: "insights", label: "Insight Cards", description: "Top performer & biggest concern", visible: true },
  { id: "killscale", label: "Scale / Watch / Kill", description: "Action buckets based on KPI thresholds", visible: true },
  { id: "activity", label: "Recent Activity", description: "Iteration diagnostics & tagging progress", visible: true },
];

const STORAGE_KEY = "verdanote_dashboard_layout";

function loadLayout(): DashboardSection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SECTIONS;
    const saved: DashboardSection[] = JSON.parse(raw);
    // Merge with defaults so new sections get added
    const savedIds = new Set(saved.map((s) => s.id));
    const merged = [
      ...saved,
      ...DEFAULT_SECTIONS.filter((d) => !savedIds.has(d.id)),
    ];
    return merged;
  } catch {
    return DEFAULT_SECTIONS;
  }
}

function saveLayout(sections: DashboardSection[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sections));
}

export function useDashboardLayout() {
  const [sections, setSections] = useState<DashboardSection[]>(loadLayout);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    saveLayout(sections);
  }, [sections]);

  const toggleVisibility = useCallback((id: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)),
    );
  }, []);

  const moveSection = useCallback((id: string, direction: "up" | "down") => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    setSections(DEFAULT_SECTIONS);
  }, []);

  return {
    sections,
    editing,
    setEditing,
    toggleVisibility,
    moveSection,
    resetLayout,
    visibleSections: sections.filter((s) => s.visible),
  };
}
