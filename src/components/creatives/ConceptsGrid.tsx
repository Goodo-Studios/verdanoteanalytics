import { useMemo } from "react";
import { groupByConcept } from "@/lib/conceptGrouping";
import { ConceptCard } from "./ConceptCard";
import type { GradeInfo } from "@/lib/creativeGrading";

interface ConceptsGridProps {
  creatives: any[];
  gradeMap?: Map<string, GradeInfo>;
}

export function ConceptsGrid({ creatives, gradeMap }: ConceptsGridProps) {
  const concepts = useMemo(() => groupByConcept(creatives), [creatives]);

  if (concepts.length === 0) {
    return (
      <div className="glass-panel flex flex-col items-center justify-center py-20 text-center">
        <h3 className="font-heading text-[20px] text-foreground mb-1">No concepts found</h3>
        <p className="font-body text-[14px] text-muted-foreground max-w-md">
          Concepts are grouped from your ad names. Sync creatives to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {concepts.map(c => (
        <ConceptCard key={c.name} concept={c} gradeMap={gradeMap} />
      ))}
    </div>
  );
}
