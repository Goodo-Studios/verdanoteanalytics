import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Save, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

interface AIBriefModalProps {
  open: boolean;
  onClose: () => void;
  account: { id: string; name: string; iteration_spend_threshold?: number } | null;
}

export function AIBriefModal({ open, onClose, account }: AIBriefModalProps) {
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!account) return;
    setLoading(true);
    setBrief(null);

    try {
      const spendMin = account.iteration_spend_threshold ?? 50;

      // Fetch top 10 creatives by ROAS with minimum spend
      const { data: topCreatives } = await supabase
        .from("creatives")
        .select("ad_name, roas, spend, ctr, ad_type, hook, theme, product, style, thumb_stop_rate, hold_rate")
        .eq("account_id", account.id)
        .gt("spend", spendMin)
        .order("roas", { ascending: false })
        .limit(10);

      // Fetch tag performance summary
      const { data: tagData } = await supabase
        .from("creatives")
        .select("hook, theme, product, style, ad_type, roas, spend")
        .eq("account_id", account.id)
        .gt("spend", spendMin);

      // Build tag summary
      const tagSummary = buildTagSummary(tagData || []);

      const creativesBlock = (topCreatives || [])
        .map(c => `- "${c.ad_name}" | ROAS: ${(c.roas || 0).toFixed(2)}x | Spend: $${(c.spend || 0).toFixed(0)} | CTR: ${((c.ctr || 0) * 100).toFixed(1)}% | Type: ${c.ad_type || "?"} | Hook: ${c.hook || "?"} | Theme: ${c.theme || "?"} | Style: ${c.style || "?"}`)
        .join("\n");

      const prompt = `Based on this account's top performing creatives and tag patterns, generate a structured creative brief for the next production cycle.

TOP 10 CREATIVES BY ROAS (min spend $${spendMin}):
${creativesBlock || "No qualifying creatives found."}

TAG PERFORMANCE SUMMARY:
${tagSummary}

Please structure your response with exactly these sections:

## Recommended Concepts
Three numbered concepts to test, each with a rationale tied to the data above.

## Winning Hooks
Bulleted list of hooks that are working well and should be modeled.

## Format Performance
A markdown table with columns: Format | Avg ROAS | Recommendation

## Kill This Angle
One specific angle/approach to stop using, with data-backed reasoning why.`;

      const result = await apiFetch("ai-chat", "", {
        method: "POST",
        body: JSON.stringify({
          message: prompt,
          accountId: account.id,
        }),
      });

      setBrief(result.answer || "No response generated.");
    } catch (err: any) {
      toast.error("Failed to generate brief", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!brief) return;
    await navigator.clipboard.writeText(brief);
    toast.success("Brief copied to clipboard");
  };

  const handleSaveToReports = async () => {
    if (!brief || !account) return;
    try {
      await apiFetch("reports", "", {
        method: "POST",
        body: JSON.stringify({
          report_name: `Creative Brief — ${account.name}`,
          account_id: account.id,
          ai_brief_content: brief,
        }),
      });
      toast.success("Brief saved to Reports");
    } catch (err: any) {
      toast.error("Failed to save", { description: err.message });
    }
  };

  const handleClose = () => {
    setBrief(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-[20px] text-forest">
            Creative Brief — {account?.name}
          </DialogTitle>
        </DialogHeader>

        {!brief && !loading && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="font-body text-[13px] text-slate text-center max-w-sm">
              Generate an AI-powered creative brief based on this account's top performers and tag patterns.
            </p>
            <Button onClick={handleGenerate} className="gap-2">
              <Sparkles className="h-4 w-4" />
              Generate Brief
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="font-body text-[13px] text-slate">Analyzing creatives and generating brief…</p>
          </div>
        )}

        {brief && (
          <div className="space-y-4">
            <div className="prose prose-sm max-w-none font-body text-[13px] text-charcoal
              prose-headings:font-heading prose-headings:text-forest
              prose-h2:text-[16px] prose-h2:mt-5 prose-h2:mb-2
              prose-li:text-[13px] prose-li:text-charcoal
              prose-table:text-[12px]
              prose-td:px-2 prose-td:py-1 prose-th:px-2 prose-th:py-1
              prose-th:text-left prose-th:font-label prose-th:text-slate prose-th:uppercase prose-th:text-[11px]
              prose-tr:border-b prose-tr:border-border-light">
              <ReactMarkdown>{brief}</ReactMarkdown>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-border-light">
              <Button size="sm" variant="secondary" onClick={handleCopy} className="gap-1.5">
                <Copy className="h-3.5 w-3.5" />
                Copy as Brief
              </Button>
              <Button size="sm" variant="secondary" onClick={handleSaveToReports} className="gap-1.5">
                <Save className="h-3.5 w-3.5" />
                Save to Reports
              </Button>
              <Button size="sm" variant="ghost" onClick={handleGenerate} className="gap-1.5 ml-auto">
                <Sparkles className="h-3.5 w-3.5" />
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function buildTagSummary(creatives: any[]): string {
  const tagTypes = ["hook", "theme", "product", "style", "ad_type"] as const;
  const lines: string[] = [];

  for (const tag of tagTypes) {
    const grouped: Record<string, { spend: number; weightedRoas: number }> = {};
    for (const c of creatives) {
      const val = c[tag];
      if (!val) continue;
      if (!grouped[val]) grouped[val] = { spend: 0, weightedRoas: 0 };
      grouped[val].spend += c.spend || 0;
      grouped[val].weightedRoas += (c.roas || 0) * (c.spend || 0);
    }
    const sorted = Object.entries(grouped)
      .map(([name, d]) => ({ name, avgRoas: d.spend > 0 ? d.weightedRoas / d.spend : 0, spend: d.spend }))
      .sort((a, b) => b.avgRoas - a.avgRoas)
      .slice(0, 5);
    if (sorted.length > 0) {
      lines.push(`${tag.toUpperCase()}: ${sorted.map(s => `${s.name} (${s.avgRoas.toFixed(2)}x, $${s.spend.toFixed(0)})`).join(", ")}`);
    }
  }
  return lines.join("\n") || "No tag data available.";
}
