import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type SectionSize = "sm" | "md" | "lg";

export interface DashboardSection {
  id: string;
  label: string;
  description: string;
  visible: boolean;
  size: SectionSize;
  /** Optional config for configurable sections */
  config?: Record<string, any>;
}

/** Registry of all available section types */
export const SECTION_REGISTRY: Omit<DashboardSection, "visible" | "size">[] = [
  { id: "metrics", label: "Metrics Row", description: "Spend, ROAS, CPA, CTR, Win Rate" },
  { id: "goals", label: "Goals Progress", description: "Progress toward account targets" },
  { id: "insights", label: "Insight Cards", description: "Top performer & biggest concern" },
  { id: "killscale", label: "Scale / Watch / Kill", description: "Action buckets based on KPI thresholds" },
  { id: "activity", label: "Recent Activity", description: "Iteration diagnostics & tagging progress" },
  { id: "topCreatives", label: "Top Creatives", description: "Best performing creatives by metric" },
  { id: "trendChart", label: "Trend Chart", description: "Daily metric trends over time" },
  { id: "recentTests", label: "Recent Tests", description: "Running & completed split tests" },
  { id: "tagPerformance", label: "Tag Performance", description: "Performance summary by creative tag" },
  { id: "recentChanges", label: "Recent Changes", description: "Latest performance changelog entries" },
  { id: "quickActions", label: "Quick Actions", description: "New Report, Trigger Sync, Generate Brief" },
];

const DEFAULT_SECTIONS: DashboardSection[] = [
  { id: "metrics", label: "Metrics Row", description: "Spend, ROAS, CPA, CTR, Win Rate", visible: true, size: "lg" },
  { id: "goals", label: "Goals Progress", description: "Progress toward account targets", visible: true, size: "lg" },
  { id: "insights", label: "Insight Cards", description: "Top performer & biggest concern", visible: true, size: "lg" },
  { id: "killscale", label: "Scale / Watch / Kill", description: "Action buckets based on KPI thresholds", visible: true, size: "lg" },
  { id: "activity", label: "Recent Activity", description: "Iteration diagnostics & tagging progress", visible: true, size: "lg" },
];

const STORAGE_KEY = "verdanote_dashboard_layout";

function loadFromLocal(): DashboardSection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SECTIONS;
    const saved: DashboardSection[] = JSON.parse(raw);
    return mergeSections(saved);
  } catch {
    return DEFAULT_SECTIONS;
  }
}

function mergeSections(saved: DashboardSection[]): DashboardSection[] {
  // Ensure size field exists on older saved data
  const withSize = saved.map((s) => ({ ...s, size: s.size || "lg" as SectionSize }));
  const savedIds = new Set(withSize.map((s) => s.id));
  return [
    ...withSize,
    ...DEFAULT_SECTIONS.filter((d) => !savedIds.has(d.id)),
  ];
}

function saveToLocal(sections: DashboardSection[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sections));
}

export function useDashboardLayout() {
  const { user } = useAuth();
  const [sections, setSections] = useState<DashboardSection[]>(loadFromLocal);
  const [editing, setEditing] = useState(false);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const dbLoaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // Load from DB on mount
  useEffect(() => {
    if (!user?.id || dbLoaded.current) return;
    (async () => {
      const { data } = await supabase
        .from("user_preferences" as any)
        .select("dashboard_layout")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data && (data as any).dashboard_layout) {
        const parsed = (data as any).dashboard_layout as DashboardSection[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const merged = mergeSections(parsed);
          setSections(merged);
          saveToLocal(merged);
        }
      }
      dbLoaded.current = true;
    })();
  }, [user?.id]);

  // Persist changes (debounced to DB + immediate to localStorage)
  useEffect(() => {
    saveToLocal(sections);
    if (!user?.id || !dbLoaded.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await supabase
        .from("user_preferences" as any)
        .upsert({ user_id: user.id, dashboard_layout: sections, updated_at: new Date().toISOString() } as any, { onConflict: "user_id" });
    }, 1000);
    return () => clearTimeout(saveTimer.current);
  }, [sections, user?.id]);

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

  const resizeSection = useCallback((id: string, size: SectionSize) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, size } : s)),
    );
  }, []);

  const addSection = useCallback((id: string) => {
    const reg = SECTION_REGISTRY.find((r) => r.id === id);
    if (!reg) return;
    setSections((prev) => {
      if (prev.some((s) => s.id === id)) {
        // Re-enable if hidden
        return prev.map((s) => (s.id === id ? { ...s, visible: true } : s));
      }
      return [...prev, { ...reg, visible: true, size: "lg" as SectionSize }];
    });
  }, []);

  const removeSection = useCallback((id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const resetLayout = useCallback(() => {
    setSections(DEFAULT_SECTIONS);
  }, []);

  const availableSections = SECTION_REGISTRY.filter(
    (r) => !sections.some((s) => s.id === r.id && s.visible),
  );

  return {
    sections,
    editing,
    setEditing,
    addPanelOpen,
    setAddPanelOpen,
    toggleVisibility,
    moveSection,
    resizeSection,
    addSection,
    removeSection,
    resetLayout,
    visibleSections: sections.filter((s) => s.visible),
    availableSections,
  };
}
