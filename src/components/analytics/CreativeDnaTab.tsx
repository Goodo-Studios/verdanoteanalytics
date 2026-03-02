import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dna, FileText, Video, Image, Mic, Target, Lightbulb, Clock, Trophy } from "lucide-react";
import { extractConceptRoot, groupByConcept } from "@/lib/conceptGrouping";
import { useRoleNavigate } from "@/hooks/useRolePath";

interface Props {
  creatives: any[];
  scaleThreshold: number;
  spendThreshold: number;
  accountName?: string;
  killScaleKpi?: string;
  killScaleKpiDirection?: string;
}

interface PatternResult {
  label: string;
  pct: number;
  count: number;
}

function topPattern(items: PatternResult[]): PatternResult | null {
  return items.length > 0 ? items[0] : null;
}

function analyzeField(winners: any[], field: string): PatternResult[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const c of winners) {
    const val = c[field];
    if (val && typeof val === "string" && val.trim()) {
      counts.set(val, (counts.get(val) || 0) + 1);
      total++;
    }
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, pct: total > 0 ? (count / winners.length) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
}

function analyzeVideoLength(winners: any[]): { range: string; pct: number } | null {
  const videos = winners.filter(
    (c) => c.ad_type?.toLowerCase().includes("video") && Number(c.video_avg_play_time) > 0
  );
  if (videos.length < 3) return null;

  const durations = videos.map((c) => Number(c.video_avg_play_time));
  const buckets = [
    { range: "0-15s", min: 0, max: 15, count: 0 },
    { range: "15-30s", min: 15, max: 30, count: 0 },
    { range: "30-45s", min: 30, max: 45, count: 0 },
    { range: "45-60s", min: 45, max: 60, count: 0 },
    { range: "60s+", min: 60, max: Infinity, count: 0 },
  ];

  for (const d of durations) {
    const bucket = buckets.find((b) => d >= b.min && d < b.max);
    if (bucket) bucket.count++;
  }

  const best = buckets.sort((a, b) => b.count - a.count)[0];
  return best.count > 0
    ? { range: best.range, pct: (best.count / videos.length) * 100 }
    : null;
}

function PatternRow({ icon, label, value, pct }: { icon: React.ReactNode; label: string; value: string; pct: number }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
      <Badge variant="secondary" className="text-xs shrink-0">{Math.round(pct)}% of winners</Badge>
    </div>
  );
}

function PctBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
      <div className="h-full bg-primary rounded-full transition-progress" style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export function CreativeDnaTab({ creatives, scaleThreshold, spendThreshold, accountName, killScaleKpi = "roas", killScaleKpiDirection = "gte" }: Props) {
  const navigate = useRoleNavigate();

  const { winners, taggedCount, dna } = useMemo(() => {
    const tagged = creatives.filter(
      (c) => c.tag_source !== "untagged" || c.hook || c.style || c.ad_type
    );
    const taggedCount = tagged.length;

    // Filter winners using scale threshold
    const kpi = killScaleKpi || "roas";
    const isGte = killScaleKpiDirection !== "lte";

    const winners = creatives.filter((c) => {
      const spend = Number(c.spend) || 0;
      if (spend < spendThreshold) return false;
      const val = Number(c[kpi]) || 0;
      return isGte ? val >= scaleThreshold : val <= scaleThreshold;
    });

    // Format analysis
    const formats = analyzeField(winners, "ad_type");
    const hooks = analyzeField(winners, "hook");
    const angles = analyzeField(winners, "style");
    const themes = analyzeField(winners, "theme");
    const videoLength = analyzeVideoLength(winners);

    // Concept root analysis
    const conceptGroups = groupByConcept(winners);
    const topConcept = conceptGroups.length > 0
      ? { name: conceptGroups[0].name, count: conceptGroups[0].iterations.length, totalInTop10: 0 }
      : null;

    // Count how many of top 10 spenders share the top concept
    if (topConcept) {
      const top10 = [...creatives]
        .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0))
        .slice(0, 10);
      topConcept.totalInTop10 = top10.filter(
        (c) => extractConceptRoot(c.ad_name || "") === topConcept.name
      ).length;
    }

    return {
      winners,
      taggedCount,
      dna: {
        format: topPattern(formats),
        hook: topPattern(hooks),
        angle: topPattern(angles),
        theme: topPattern(themes),
        videoLength,
        topConcept,
        allFormats: formats.slice(0, 5),
        allHooks: hooks.slice(0, 5),
        allAngles: angles.slice(0, 5),
      },
    };
  }, [creatives, scaleThreshold, spendThreshold, killScaleKpi, killScaleKpiDirection]);

  // Guard: need 20+ tagged creatives
  if (taggedCount < 20) {
    return (
      <div className="glass-panel p-8 text-center max-w-xl mx-auto">
        <Dna className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-heading mb-2">Tag More Creatives to Unlock DNA Analysis</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Creative DNA requires at least 20 tagged creatives to identify meaningful patterns.
          You currently have {taggedCount} tagged.
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate("/tagging")}>
          Go to Tagging
        </Button>
      </div>
    );
  }

  if (winners.length < 3) {
    return (
      <div className="glass-panel p-8 text-center max-w-xl mx-auto">
        <Dna className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-heading mb-2">Not Enough Top Performers</h3>
        <p className="text-sm text-muted-foreground">
          DNA analysis needs at least 3 creatives above the scale threshold ({scaleThreshold}x ROAS with ${spendThreshold}+ spend).
          You currently have {winners.length}.
        </p>
      </div>
    );
  }

  const handleApplyFormula = () => {
    // Navigate to briefs with DNA pre-fill params
    const parts: string[] = [];
    if (dna.format) parts.push(`Format: ${dna.format.label}`);
    if (dna.hook) parts.push(`Hook: ${dna.hook.label}`);
    if (dna.angle) parts.push(`Angle: ${dna.angle.label}`);
    if (dna.videoLength) parts.push(`Length: ${dna.videoLength.range}`);
    navigate(`/briefs?dna=${encodeURIComponent(parts.join(", "))}`);
  };

  return (
    <div className="space-y-6">
      {/* Fingerprint card */}
      <div className="glass-panel p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Dna className="h-5 w-5" />
          </div>
          <div>
            <h2 className="section-title">Your Creative DNA</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Based on {winners.length} top performers (above {scaleThreshold}x {killScaleKpi.toUpperCase()})
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          For <span className="font-medium text-foreground">{accountName || "this account"}</span>, your highest-performing creative tends to be:
        </p>

        <div className="divide-y divide-border">
          {dna.format && (
            <PatternRow
              icon={dna.format.label?.toLowerCase().includes("video") ? <Video className="h-4 w-4" /> : <Image className="h-4 w-4" />}
              label="Format"
              value={dna.format.label}
              pct={dna.format.pct}
            />
          )}
          {dna.hook && (
            <PatternRow
              icon={<Target className="h-4 w-4" />}
              label="Hook Type"
              value={dna.hook.label}
              pct={dna.hook.pct}
            />
          )}
          {dna.angle && (
            <PatternRow
              icon={<Lightbulb className="h-4 w-4" />}
              label="Angle / Style"
              value={dna.angle.label}
              pct={dna.angle.pct}
            />
          )}
          {dna.videoLength && (
            <PatternRow
              icon={<Clock className="h-4 w-4" />}
              label="Video Length Sweet Spot"
              value={dna.videoLength.range}
              pct={dna.videoLength.pct}
            />
          )}
          {dna.topConcept && (
            <PatternRow
              icon={<Trophy className="h-4 w-4" />}
              label="Top Concept Family"
              value={`${dna.topConcept.name} — ${dna.topConcept.totalInTop10} of your top 10 are from this family`}
              pct={(dna.topConcept.count / winners.length) * 100}
            />
          )}
        </div>

        <div className="mt-5">
          <Button size="sm" onClick={handleApplyFormula}>
            <FileText className="h-3.5 w-3.5 mr-1.5" />Apply This Formula → New Brief
          </Button>
        </div>
      </div>

      {/* Detailed breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Format breakdown */}
        <div className="glass-panel p-4 space-y-3">
          <h3 className="card-title">Format Mix</h3>
          {dna.allFormats.length === 0 ? (
            <p className="text-xs text-muted-foreground">No format data available. Tag creatives with ad type.</p>
          ) : (
            dna.allFormats.map((f) => (
              <div key={f.label} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{f.label}</span>
                  <span className="text-xs text-muted-foreground">{Math.round(f.pct)}%</span>
                </div>
                <PctBar pct={f.pct} />
              </div>
            ))
          )}
        </div>

        {/* Hook breakdown */}
        <div className="glass-panel p-4 space-y-3">
          <h3 className="card-title">Hook Types</h3>
          {dna.allHooks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hook data available. Tag creatives with hook types.</p>
          ) : (
            dna.allHooks.map((h) => (
              <div key={h.label} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{h.label}</span>
                  <span className="text-xs text-muted-foreground">{Math.round(h.pct)}%</span>
                </div>
                <PctBar pct={h.pct} />
              </div>
            ))
          )}
        </div>

        {/* Angle breakdown */}
        <div className="glass-panel p-4 space-y-3">
          <h3 className="card-title">Angles / Styles</h3>
          {dna.allAngles.length === 0 ? (
            <p className="text-xs text-muted-foreground">No angle data available. Tag creatives with styles.</p>
          ) : (
            dna.allAngles.map((a) => (
              <div key={a.label} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{a.label}</span>
                  <span className="text-xs text-muted-foreground">{Math.round(a.pct)}%</span>
                </div>
                <PctBar pct={a.pct} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
