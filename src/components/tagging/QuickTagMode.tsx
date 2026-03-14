import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUpdateCreative } from "@/hooks/useCreatives";
import { TAG_OPTIONS_MAP } from "@/lib/tagOptions";
import { inferTags, hasInferredTags } from "@/lib/autoTagger";
import { extractConceptRoot } from "@/lib/conceptGrouping";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, X, Sparkles, LayoutGrid } from "lucide-react";

const TAG_FIELDS = ["ad_type", "hook", "person", "style", "theme", "product"] as const;
const TAG_LABELS: Record<string, string> = {
  ad_type: "Format", hook: "Hook Type", person: "Person",
  style: "Style", theme: "Angle", product: "Product",
};

interface QuickTagModeProps {
  creatives: any[];
  allCreatives?: any[];
  onExit: () => void;
}

function getSuggestions(
  creative: any,
  allCreatives: any[],
): Record<string, { value: string; source: string }[]> {
  const suggestions: Record<string, { value: string; source: string }[]> = {};

  // 1. Auto-tagger suggestions from ad name
  const inferred = inferTags(creative.ad_name || "");
  if (inferred.ad_type) {
    suggestions.ad_type = [{ value: inferred.ad_type, source: "name" }];
  }
  if (inferred.hook) {
    suggestions.hook = [{ value: inferred.hook, source: "name" }];
  }
  if (inferred.theme) {
    suggestions.theme = [{ value: inferred.theme, source: "name" }];
  }

  // 2. Same concept root → copy tags from siblings
  const root = extractConceptRoot(creative.ad_name || "");
  const siblings = allCreatives.filter(
    (c) => c.ad_id !== creative.ad_id && extractConceptRoot(c.ad_name || "") === root && c.tag_source !== "untagged"
  );
  if (siblings.length > 0) {
    const sibling = siblings[0];
    for (const field of TAG_FIELDS) {
      if (sibling[field] && !creative[field]) {
        if (!suggestions[field]) suggestions[field] = [];
        if (!suggestions[field].find((s) => s.value === sibling[field])) {
          suggestions[field].push({ value: sibling[field], source: "sibling" });
        }
      }
    }
  }

  // 3. Account pattern: if 80%+ of same format have a certain tag
  const sameFormat = allCreatives.filter(
    (c) => c.ad_type && c.ad_type === (creative.ad_type || inferred.ad_type) && c.tag_source !== "untagged"
  );
  if (sameFormat.length >= 5) {
    for (const field of ["hook", "person", "style", "theme"] as const) {
      if (creative[field]) continue;
      const counts: Record<string, number> = {};
      for (const c of sameFormat) {
        if (c[field]) counts[c[field]] = (counts[c[field]] || 0) + 1;
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] / sameFormat.length >= 0.8) {
        if (!suggestions[field]) suggestions[field] = [];
        if (!suggestions[field].find((s) => s.value === top[0])) {
          suggestions[field].push({ value: top[0], source: "pattern" });
        }
      }
    }
  }

  return suggestions;
}

export function QuickTagMode({ creatives, allCreatives = [], onExit }: QuickTagModeProps) {
  const [index, setIndex] = useState(0);
  const updateCreative = useUpdateCreative();
  const [localTags, setLocalTags] = useState<Record<string, string>>({});

  const creative = creatives[index];
  const total = creatives.length;

  // Reset local tags when index changes
  useEffect(() => {
    if (!creative) return;
    const existing: Record<string, string> = {};
    for (const f of TAG_FIELDS) {
      if (creative[f]) existing[f] = creative[f];
    }
    setLocalTags(existing);
  }, [index, creative?.ad_id]);

  const suggestions = useMemo(
    () => creative ? getSuggestions(creative, allCreatives) : {},
    [creative, allCreatives]
  );

  const handleSelectTag = useCallback((field: string, value: string) => {
    setLocalTags((prev) => {
      if (prev[field] === value) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return { ...prev, [field]: value };
    });
  }, []);

  const saveAndNext = useCallback(() => {
    if (!creative) return;
    const hasAnyTag = Object.values(localTags).some(Boolean);
    if (hasAnyTag) {
      updateCreative.mutate({
        adId: creative.ad_id,
        updates: { ...localTags, tag_source: "manual" },
      });
    }
    if (index < total - 1) setIndex((i) => i + 1);
  }, [creative, localTags, updateCreative, index, total]);

  const goPrev = useCallback(() => {
    if (index > 0) setIndex((i) => i - 1);
  }, [index]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onExit(); return; }
      if (e.key === "ArrowRight") { saveAndNext(); return; }
      if (e.key === "ArrowLeft") { goPrev(); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onExit, saveAndNext, goPrev]);

  if (!creative) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="font-heading text-[24px] text-foreground">All done! 🎉</p>
          <Button onClick={onExit}>Exit Quick Tag</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onExit}>
            <X className="h-4 w-4 mr-1" /> Exit
          </Button>
          <span className="font-label text-[11px] uppercase tracking-wider text-muted-foreground">Quick Tag</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-data text-[17px] font-medium tabular-nums text-foreground">
            {index + 1} of {total}
          </span>
          <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${((index + 1) / total) * 100}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={goPrev} disabled={index === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={saveAndNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-4xl mx-auto w-full space-y-6">
        {/* Creative preview */}
        <div className="flex gap-6 items-start">
          <div className="w-64 h-64 rounded-lg bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center border border-border">
            {creative.thumbnail_url ? (
              <img src={creative.thumbnail_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <LayoutGrid className="h-12 w-12 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-2 min-w-0">
            <h2 className="font-heading text-[22px] text-foreground leading-tight">{creative.ad_name}</h2>
            {creative.unique_code && (
              <p className="font-body text-[12px] text-muted-foreground">{creative.unique_code}</p>
            )}
            <div className="flex items-center gap-4 mt-3">
              <div>
                <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">Spend</p>
                <p className="font-data text-[18px] font-semibold tabular-nums text-foreground">
                  ${Number(creative.spend || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div>
                <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">ROAS</p>
                <p className="font-data text-[18px] font-semibold tabular-nums text-foreground">
                  {Number(creative.roas || 0).toFixed(2)}x
                </p>
              </div>
              <div>
                <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">CTR</p>
                <p className="font-data text-[18px] font-semibold tabular-nums text-foreground">
                  {Number(creative.ctr || 0).toFixed(2)}%
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Tag categories */}
        <div className="space-y-4">
          {TAG_FIELDS.map((field) => {
            const options = TAG_OPTIONS_MAP[field] || [];
            const fieldSuggestions = suggestions[field] || [];
            const selected = localTags[field];

            return (
              <div key={field} className="space-y-1.5">
                <label className="font-label text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {TAG_LABELS[field]}
                </label>

                {/* Suggestions */}
                {fieldSuggestions.length > 0 && !selected && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span className="font-body text-[10px] text-muted-foreground">Suggested:</span>
                    {fieldSuggestions.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => handleSelectTag(field, s.value)}
                        className="px-2.5 py-1 rounded-full border border-dashed border-primary/40 text-primary font-body text-[11px] hover:bg-primary/10 transition-colors"
                      >
                        {s.value}
                        <span className="ml-1 text-[9px] text-muted-foreground">({s.source})</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Option chips */}
                {options.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {options.map((opt, i) => (
                      <button
                        key={opt}
                        onClick={() => handleSelectTag(field, opt)}
                        className={cn(
                          "px-3 py-1.5 rounded-md font-body text-[12px] border transition-colors",
                          selected === opt
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card text-foreground border-border hover:border-primary/50"
                        )}
                      >
                        <span className="text-[10px] text-muted-foreground mr-1 font-data">{i + 1}</span>
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    className="h-8 px-3 rounded-md border border-border bg-card font-body text-[12px] text-foreground w-64"
                    value={localTags[field] || ""}
                    onChange={(e) => handleSelectTag(field, e.target.value)}
                    placeholder={`Enter ${TAG_LABELS[field].toLowerCase()}...`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Keyboard hint */}
        <div className="flex items-center gap-4 text-muted-foreground font-body text-[11px] pt-2">
          <span>← Prev</span>
          <span>→ Save & Next</span>
          <span>Esc Exit</span>
        </div>
      </div>
    </div>
  );
}
