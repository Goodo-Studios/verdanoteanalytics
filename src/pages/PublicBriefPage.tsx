import { useParams } from "react-router-dom";
import { useBriefByShareToken } from "@/hooks/useBriefsApi";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Leaf, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", sent: "Sent", in_production: "In Production", complete: "Complete",
};

const SECTION_LABELS: Record<string, string> = {
  concept_name: "Concept Name",
  objective: "Objective",
  hook: "Hook (opening 3 seconds)",
  key_message: "Key Message",
  cta: "Call to Action",
  format_specs: "Format & Specs",
  dos: "Do's",
  donts: "Don'ts",
};

const PublicBriefPage = () => {
  const { token } = useParams<{ token: string }>();
  const { data: brief, isLoading, error } = useBriefByShareToken(token);
  const [understood, setUnderstood] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`brief_understood_${token}`);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const toggleUnderstood = (key: string) => {
    setUnderstood((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(`brief_understood_${token}`, JSON.stringify([...next]));
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <div className="text-center space-y-2">
          <p className="font-heading text-[20px] text-forest">Brief not found</p>
          <p className="font-body text-[13px] text-muted-foreground">This link may have expired or been removed.</p>
        </div>
      </div>
    );
  }

  const content = brief.content || {};
  const sections = Object.entries(content).filter(
    ([key]) => key !== "reference_ads" && SECTION_LABELS[key],
  );

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-sage-light/50">
            <Leaf className="h-5 w-5 text-verdant" />
          </div>
          <div>
            <p className="font-label text-[9px] uppercase tracking-wider text-muted-foreground">Creative Brief</p>
            <h1 className="font-heading text-[24px] text-forest">{brief.name}</h1>
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-3">
          <Badge variant="secondary" className="font-label text-[9px] uppercase">
            {STATUS_LABELS[brief.status] || brief.status}
          </Badge>
          {brief.assignee_name && (
            <span className="font-body text-[12px] text-slate">Assigned to: <span className="font-medium">{brief.assignee_name}</span></span>
          )}
          {brief.due_date && (
            <span className="font-body text-[12px] text-slate">Due: <span className="font-data">{brief.due_date}</span></span>
          )}
        </div>

        <Separator />

        {/* Sections */}
        <div className="space-y-5">
          {sections.map(([key, value]) => (
            <div key={key} className="rounded-lg border border-border-light bg-white p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {SECTION_LABELS[key] || key}
                </h3>
                <button
                  onClick={() => toggleUnderstood(key)}
                  className={cn(
                    "flex items-center gap-1 font-body text-[11px] px-2 py-0.5 rounded-full transition-colors",
                    understood.has(key)
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {understood.has(key) ? "Understood" : "Mark as understood"}
                </button>
              </div>
              <p className="font-body text-[14px] text-charcoal whitespace-pre-wrap leading-relaxed">
                {(value as string) || <span className="text-muted-foreground italic">Not filled in yet</span>}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="text-center pt-4">
          <p className="font-body text-[11px] text-sage">Powered by Verdanote</p>
        </div>
      </div>
    </div>
  );
};

export default PublicBriefPage;
