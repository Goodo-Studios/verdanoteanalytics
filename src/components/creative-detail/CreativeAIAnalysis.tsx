import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

interface CreativeAIAnalysisProps {
  creative: any;
}

export function CreativeAIAnalysis({ creative }: CreativeAIAnalysisProps) {
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const roasLabel = creative.roas ? `${creative.roas.toFixed(2)}x` : "unknown";
  const spendLabel = creative.spend ? `$${creative.spend.toFixed(0)}` : "unknown";

  const generateDiagnosis = async () => {
    setLoading(true);
    setDiagnosis(null);
    try {
      const prompt = `Analyze this specific creative and explain its performance. Be specific and data-driven.

CREATIVE: "${creative.ad_name}"
METRICS:
- ROAS: ${roasLabel}
- Spend: ${spendLabel}
- CPA: ${creative.cpa ? `$${creative.cpa.toFixed(2)}` : "N/A"}
- CTR: ${creative.ctr ? `${(creative.ctr * 100).toFixed(2)}%` : "N/A"}
- Hook Rate: ${creative.thumb_stop_rate ? `${(creative.thumb_stop_rate * 100).toFixed(1)}%` : "N/A"}
- Hold Rate: ${creative.hold_rate ? `${(creative.hold_rate * 100).toFixed(1)}%` : "N/A"}
- Frequency: ${creative.frequency?.toFixed(2) || "N/A"}
- Format: ${creative.ad_type || "Unknown"}
- Status: ${creative.ad_status || "Unknown"}

TAGS: Hook="${creative.hook || "?"}" | Theme="${creative.theme || "?"}" | Style="${creative.style || "?"}" | Product="${creative.product || "?"}"

Please provide:
1. **Performance Diagnosis** — Why is this creative performing at ${roasLabel} ROAS? What's working or failing?
2. **Strength Analysis** — Which metrics stand out positively compared to typical benchmarks?
3. **Weakness Analysis** — Which metrics are underperforming and why?
4. **Actionable Recommendations** — 3 specific, tactical next steps to either scale this creative or iterate on it.

Keep your analysis concise but specific. Reference the actual numbers.`;

      const result = await apiFetch("ai-chat", "", {
        method: "POST",
        body: JSON.stringify({
          message: prompt,
          accountId: creative.account_id,
        }),
      });
      setDiagnosis(result.answer || "No analysis generated.");
    } catch (err: any) {
      toast.error("Analysis failed", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Auto-generate on mount
  useEffect(() => {
    if (!diagnosis && !loading) {
      generateDiagnosis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creative.ad_id]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-heading text-[15px] text-foreground">AI Performance Analysis</span>
        </div>
        {diagnosis && (
          <Button
            size="sm"
            variant="ghost"
            onClick={generateDiagnosis}
            disabled={loading}
            className="gap-1.5 text-[12px]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="font-body text-[12px] text-muted-foreground">Analyzing creative performance…</p>
        </div>
      )}

      {diagnosis && !loading && (
        <div className="prose prose-sm max-w-none font-body text-[13px] text-foreground
          prose-headings:font-heading prose-headings:text-foreground
          prose-h2:text-[15px] prose-h2:mt-4 prose-h2:mb-1.5
          prose-h3:text-[13px] prose-h3:mt-3 prose-h3:mb-1
          prose-li:text-[13px] prose-li:text-foreground
          prose-strong:text-foreground
          prose-p:leading-relaxed">
          <ReactMarkdown>{diagnosis}</ReactMarkdown>
        </div>
      )}

      {!diagnosis && !loading && (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="font-body text-[12px] text-muted-foreground">Analysis not yet generated.</p>
          <Button size="sm" onClick={generateDiagnosis} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Generate Analysis
          </Button>
        </div>
      )}
    </div>
  );
}
