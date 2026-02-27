import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Save } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

interface WeeklyRetroModalProps {
  open: boolean;
  onClose: () => void;
  account: { id: string; name: string; iteration_spend_threshold?: number; scale_threshold?: number; kill_threshold?: number } | null;
}

export function WeeklyRetroModal({ open, onClose, account }: WeeklyRetroModalProps) {
  const [retro, setRetro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && account && !retro && !loading) {
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);

  const handleGenerate = async () => {
    if (!account) return;
    setLoading(true);
    setRetro(null);

    try {
      const spendMin = account.iteration_spend_threshold ?? 50;
      const scaleT = account.scale_threshold ?? 2;
      const killT = account.kill_threshold ?? 1;
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

      // Top 5 by spend this week
      const { data: topSpend } = await supabase
        .from("creative_daily_metrics")
        .select("ad_id, spend, roas, ctr")
        .eq("account_id", account.id)
        .gte("date", weekAgo);

      // Aggregate daily metrics by ad_id
      const byAd: Record<string, { spend: number; weightedRoas: number; weightedCtr: number }> = {};
      for (const r of topSpend || []) {
        if (!byAd[r.ad_id]) byAd[r.ad_id] = { spend: 0, weightedRoas: 0, weightedCtr: 0 };
        const s = r.spend || 0;
        byAd[r.ad_id].spend += s;
        byAd[r.ad_id].weightedRoas += (r.roas || 0) * s;
        byAd[r.ad_id].weightedCtr += (r.ctr || 0) * s;
      }

      const adIds = Object.keys(byAd);
      let nameMap: Record<string, string> = {};
      if (adIds.length > 0) {
        const { data: names } = await supabase
          .from("creatives")
          .select("ad_id, ad_name, hook, theme, style, ad_type, prior_roas, roas")
          .eq("account_id", account.id)
          .in("ad_id", adIds);
        for (const n of names || []) {
          nameMap[n.ad_id] = n.ad_name;
        }
        // Enrich byAd with creative-level data for threshold crossings
        var creativesData = names || [];
      }

      const sorted = Object.entries(byAd)
        .map(([id, d]) => ({
          id, spend: d.spend,
          roas: d.spend > 0 ? d.weightedRoas / d.spend : 0,
          ctr: d.spend > 0 ? d.weightedCtr / d.spend : 0,
          name: nameMap[id] || id,
        }))
        .filter(c => c.spend > 0);

      const topBySpend = [...sorted].sort((a, b) => b.spend - a.spend).slice(0, 5);
      const bottomByRoas = [...sorted].filter(c => c.spend >= spendMin).sort((a, b) => a.roas - b.roas).slice(0, 5);

      // WoW ROAS
      const totalSpend = sorted.reduce((s, c) => s + c.spend, 0);
      const totalWeightedRoas = sorted.reduce((s, c) => s + c.roas * c.spend, 0);
      const weekRoas = totalSpend > 0 ? totalWeightedRoas / totalSpend : 0;

      // Threshold crossings
      const crossed = (creativesData || []).filter(c => {
        const prev = c.prior_roas;
        const cur = c.roas;
        if (prev == null || cur == null) return false;
        return (cur >= scaleT && prev < scaleT) || (cur < killT && prev >= killT);
      }).map(c => `- "${c.ad_name}" — ${(c.roas || 0).toFixed(2)}x (was ${(c.prior_roas || 0).toFixed(2)}x)`);

      const topBlock = topBySpend.map(c => `- "${c.name}" | Spend: $${c.spend.toFixed(0)} | ROAS: ${c.roas.toFixed(2)}x | CTR: ${(c.ctr * 100).toFixed(1)}%`).join("\n");
      const bottomBlock = bottomByRoas.map(c => `- "${c.name}" | ROAS: ${c.roas.toFixed(2)}x | Spend: $${c.spend.toFixed(0)}`).join("\n");

      const prompt = `You are a creative strategist. Generate a weekly creative retrospective for the ad account "${account.name}".

DATA (last 7 days):

TOP 5 BY SPEND:
${topBlock || "No data"}

BOTTOM 5 BY ROAS (min spend $${spendMin}):
${bottomBlock || "No data"}

ACCOUNT BLENDED ROAS THIS WEEK: ${weekRoas.toFixed(2)}x
SCALE THRESHOLD: ${scaleT}x | KILL THRESHOLD: ${killT}x

THRESHOLD CROSSINGS THIS WEEK:
${crossed.length > 0 ? crossed.join("\n") : "None"}

Please structure your response with EXACTLY these sections:

## What Worked This Week
3-5 bullets on winning creatives — what made them work, citing specific data.

## What to Cut
Specific creatives to pause with data-backed reasoning.

## Iterate This
1-2 concepts worth testing a new version of, with direction on what to change.

## This Week's Number
One standout metric — the most impressive single data point from the week. Make it punchy.

## Next Week's Bet
One specific, actionable recommendation for what to ship next week.`;

      const result = await apiFetch("ai-chat", "", {
        method: "POST",
        body: JSON.stringify({ message: prompt, accountId: account.id }),
      });

      setRetro(result.answer || "No response generated.");
    } catch (err: any) {
      toast.error("Failed to generate retro", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!retro) return;
    await navigator.clipboard.writeText(retro);
    toast.success("Retro copied to clipboard");
  };

  const handleSaveToReports = async () => {
    if (!retro || !account) return;
    try {
      await apiFetch("reports", "", {
        method: "POST",
        body: JSON.stringify({
          report_name: `Weekly Retro — ${account.name} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
          account_id: account.id,
          ai_brief_content: retro,
        }),
      });
      toast.success("Retro saved to Reports");
    } catch (err: any) {
      toast.error("Failed to save", { description: err.message });
    }
  };

  const handleClose = () => {
    setRetro(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-[20px] text-forest">
            Weekly Creative Retro — {account?.name}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="font-body text-[13px] text-slate">Analyzing this week's performance…</p>
          </div>
        )}

        {retro && (
          <div className="space-y-4">
            <div className="prose prose-sm max-w-none font-body text-[13px] text-charcoal
              prose-headings:font-heading prose-headings:text-forest
              prose-h2:text-[16px] prose-h2:mt-5 prose-h2:mb-2
              prose-li:text-[13px] prose-li:text-charcoal
              prose-table:text-[12px]
              prose-td:px-2 prose-td:py-1 prose-th:px-2 prose-th:py-1
              prose-th:text-left prose-th:font-label prose-th:text-slate prose-th:uppercase prose-th:text-[11px]
              prose-tr:border-b prose-tr:border-border-light">
              <ReactMarkdown>{retro}</ReactMarkdown>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-border-light">
              <Button size="sm" variant="secondary" onClick={handleCopy} className="gap-1.5">
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
              <Button size="sm" variant="secondary" onClick={handleSaveToReports} className="gap-1.5">
                <Save className="h-3.5 w-3.5" />
                Save to Reports
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
