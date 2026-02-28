import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, Save, Plus, Trash2, Pencil, Check, X, Bot, BookOpen,
  ShieldCheck, History, Users, Swords,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BRAND_BRIEF_PLACEHOLDER = `Describe the brand: who they are, who they sell to, what makes their product different, and what their ideal customer says when they recommend it.`;

interface OfferRow {
  offer: string;
  period: string;
  result: string;
  notes: string;
}

interface AccountContextData {
  account_id: string;
  brand_brief: string | null;
  creative_rules: string[];
  offer_history: OfferRow[];
  audience_notes: string | null;
  competitor_notes: string | null;
  updated_at: string;
  updated_by: string | null;
}

function useAccountContext(accountId: string) {
  return useQuery({
    queryKey: ["account-context", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_context")
        .select("*")
        .eq("account_id", accountId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        account_id: data.account_id,
        brand_brief: data.brand_brief,
        creative_rules: (data.creative_rules as any) || [],
        offer_history: (data.offer_history as any) || [],
        audience_notes: data.audience_notes,
        competitor_notes: data.competitor_notes,
        updated_at: data.updated_at,
        updated_by: data.updated_by,
      } as AccountContextData;
    },
    enabled: !!accountId,
  });
}

function useSaveAccountContext() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ctx: Partial<AccountContextData> & { account_id: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        account_id: ctx.account_id,
        brand_brief: ctx.brand_brief,
        creative_rules: ctx.creative_rules as any,
        offer_history: ctx.offer_history as any,
        audience_notes: ctx.audience_notes,
        competitor_notes: ctx.competitor_notes,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      };
      const { error } = await supabase
        .from("account_context")
        .upsert(payload, { onConflict: "account_id" });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["account-context", vars.account_id] });
      toast.success("Account context saved");
    },
    onError: (e: any) => toast.error("Error saving context", { description: e.message }),
  });
}

// Concatenate all sections into a single string for AI context
function buildAIContext(
  brandBrief: string,
  rules: string[],
  offers: OfferRow[],
  audienceNotes: string,
  competitorNotes: string,
): string {
  const parts: string[] = [];
  if (brandBrief.trim()) parts.push(`## Brand Brief\n${brandBrief.trim()}`);
  if (rules.length > 0) parts.push(`## Creative Rules\n${rules.map(r => `- ${r}`).join("\n")}`);
  if (offers.length > 0) {
    const rows = offers.map(o => `| ${o.offer} | ${o.period} | ${o.result} | ${o.notes} |`).join("\n");
    parts.push(`## Offer History\n| Offer | Period | Result | Notes |\n|---|---|---|---|\n${rows}`);
  }
  if (audienceNotes.trim()) parts.push(`## Audience Notes\n${audienceNotes.trim()}`);
  if (competitorNotes.trim()) parts.push(`## Competitor Notes\n${competitorNotes.trim()}`);
  return parts.join("\n\n");
}

interface Props {
  account: any;
}

export function AccountContextSection({ account }: Props) {
  const { user } = useAuth();
  const { data: ctx, isLoading } = useAccountContext(account.id);
  const save = useSaveAccountContext();

  // Local state
  const [brandBrief, setBrandBrief] = useState("");
  const [rules, setRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState("");
  const [editingRuleIdx, setEditingRuleIdx] = useState<number | null>(null);
  const [editingRuleText, setEditingRuleText] = useState("");
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [audienceNotes, setAudienceNotes] = useState("");
  const [competitorNotes, setCompetitorNotes] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);

  // Sync from DB
  useEffect(() => {
    if (ctx && initialized !== account.id) {
      setBrandBrief(ctx.brand_brief || "");
      setRules(Array.isArray(ctx.creative_rules) ? ctx.creative_rules : []);
      setOffers(Array.isArray(ctx.offer_history) ? ctx.offer_history : []);
      setAudienceNotes(ctx.audience_notes || "");
      setCompetitorNotes(ctx.competitor_notes || "");
      setInitialized(account.id);
    } else if (!ctx && !isLoading && initialized !== account.id) {
      setBrandBrief("");
      setRules([]);
      setOffers([]);
      setAudienceNotes("");
      setCompetitorNotes("");
      setInitialized(account.id);
    }
  }, [ctx, isLoading, account.id, initialized]);

  const handleSave = useCallback(async () => {
    // Save to account_context
    await save.mutateAsync({
      account_id: account.id,
      brand_brief: brandBrief || null,
      creative_rules: rules as any,
      offer_history: offers as any,
      audience_notes: audienceNotes || null,
      competitor_notes: competitorNotes || null,
    });

    // Also update AI context field on the ad_account
    const aiContext = buildAIContext(brandBrief, rules, offers, audienceNotes, competitorNotes);
    await supabase.from("ad_accounts").update({ company_description: aiContext || null }).eq("id", account.id);
  }, [account.id, brandBrief, rules, offers, audienceNotes, competitorNotes, save]);

  // Rule helpers
  const addRule = () => {
    if (!newRule.trim()) return;
    setRules([...rules, newRule.trim()]);
    setNewRule("");
  };
  const deleteRule = (idx: number) => setRules(rules.filter((_, i) => i !== idx));
  const startEditRule = (idx: number) => {
    setEditingRuleIdx(idx);
    setEditingRuleText(rules[idx]);
  };
  const commitEditRule = () => {
    if (editingRuleIdx === null) return;
    const updated = [...rules];
    updated[editingRuleIdx] = editingRuleText.trim();
    setRules(updated);
    setEditingRuleIdx(null);
    setEditingRuleText("");
  };

  // Offer helpers
  const [newOffer, setNewOffer] = useState<OfferRow>({ offer: "", period: "", result: "", notes: "" });
  const addOffer = () => {
    if (!newOffer.offer.trim()) return;
    setOffers([...offers, { ...newOffer }]);
    setNewOffer({ offer: "", period: "", result: "", notes: "" });
  };
  const deleteOffer = (idx: number) => setOffers(offers.filter((_, i) => i !== idx));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* ── 1. BRAND BRIEF ── */}
      <section className="glass-panel p-6 space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-verdant" />
          <h2 className="font-heading text-[16px] text-forest">Brand Brief</h2>
        </div>
        <p className="font-body text-[12px] text-muted-foreground">
          Brand positioning, target audience, tone of voice, visual identity notes.
        </p>
        <Textarea
          value={brandBrief}
          onChange={(e) => setBrandBrief(e.target.value)}
          placeholder={BRAND_BRIEF_PLACEHOLDER}
          rows={6}
          className="font-body text-[13px] leading-relaxed resize-y"
        />
      </section>

      {/* ── 2. CREATIVE RULES ── */}
      <section className="glass-panel p-6 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-verdant" />
          <h2 className="font-heading text-[16px] text-forest">Creative Rules</h2>
        </div>
        <p className="font-body text-[12px] text-muted-foreground">
          Do's and don'ts for this account's creative output.
        </p>

        {rules.length > 0 && (
          <ul className="space-y-1.5">
            {rules.map((rule, idx) => (
              <li key={idx} className="flex items-start gap-2 group">
                {editingRuleIdx === idx ? (
                  <>
                    <Input
                      value={editingRuleText}
                      onChange={(e) => setEditingRuleText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && commitEditRule()}
                      className="flex-1 h-8 font-body text-[13px]"
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={commitEditRule}>
                      <Check className="h-3.5 w-3.5 text-verdant" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingRuleIdx(null)}>
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="font-body text-[13px] text-charcoal flex-1 pt-0.5">{rule}</span>
                    <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => startEditRule(idx)}>
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => deleteRule(idx)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <Input
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRule()}
            placeholder='e.g. ✅ Always show the product in use'
            className="flex-1 h-8 font-body text-[13px]"
          />
          <Button size="sm" variant="outline" onClick={addRule} className="h-8 gap-1 font-body text-[12px]">
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      </section>

      {/* ── 3. OFFER HISTORY ── */}
      <section className="glass-panel p-6 space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-verdant" />
          <h2 className="font-heading text-[16px] text-forest">Offer History</h2>
        </div>
        <p className="font-body text-[12px] text-muted-foreground">
          Past offers that worked and didn't — reference for future creative strategy.
        </p>

        {offers.length > 0 && (
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-label text-[10px] uppercase tracking-wider">Offer</TableHead>
                  <TableHead className="font-label text-[10px] uppercase tracking-wider">Period</TableHead>
                  <TableHead className="font-label text-[10px] uppercase tracking-wider">Result</TableHead>
                  <TableHead className="font-label text-[10px] uppercase tracking-wider">Notes</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((o, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-body text-[13px]">{o.offer}</TableCell>
                    <TableCell className="font-body text-[12px] text-muted-foreground">{o.period}</TableCell>
                    <TableCell className="font-body text-[12px]">{o.result}</TableCell>
                    <TableCell className="font-body text-[12px] text-muted-foreground">{o.notes}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteOffer(idx)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          <Input value={newOffer.offer} onChange={(e) => setNewOffer({ ...newOffer, offer: e.target.value })} placeholder="Offer" className="h-8 font-body text-[12px]" />
          <Input value={newOffer.period} onChange={(e) => setNewOffer({ ...newOffer, period: e.target.value })} placeholder="Period" className="h-8 font-body text-[12px]" />
          <Input value={newOffer.result} onChange={(e) => setNewOffer({ ...newOffer, result: e.target.value })} placeholder="✅ or ❌ Result" className="h-8 font-body text-[12px]" />
          <Input value={newOffer.notes} onChange={(e) => setNewOffer({ ...newOffer, notes: e.target.value })} placeholder="Notes" className="h-8 font-body text-[12px]" />
        </div>
        <Button size="sm" variant="outline" onClick={addOffer} className="h-8 gap-1 font-body text-[12px]">
          <Plus className="h-3 w-3" /> Add Offer
        </Button>
      </section>

      {/* ── 4. AUDIENCE NOTES ── */}
      <section className="glass-panel p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-verdant" />
          <h2 className="font-heading text-[16px] text-forest">Audience Notes</h2>
        </div>
        <p className="font-body text-[12px] text-muted-foreground">
          Who responds to this brand's ads. Age ranges, interests, what language resonates, what triggers conversion.
        </p>
        <Textarea
          value={audienceNotes}
          onChange={(e) => setAudienceNotes(e.target.value)}
          placeholder="Describe the ideal audience segments and what resonates with them..."
          rows={4}
          className="font-body text-[13px] leading-relaxed resize-y"
        />
      </section>

      {/* ── 5. COMPETITOR NOTES ── */}
      <section className="glass-panel p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-verdant" />
          <h2 className="font-heading text-[16px] text-forest">Competitor Notes</h2>
        </div>
        <p className="font-body text-[12px] text-muted-foreground">
          Key competitors, their creative approach, what differentiates this brand.
        </p>
        <Textarea
          value={competitorNotes}
          onChange={(e) => setCompetitorNotes(e.target.value)}
          placeholder="Note key competitors, their creative approach, and what Goodo does differently..."
          rows={4}
          className="font-body text-[13px] leading-relaxed resize-y"
        />
      </section>

      {/* ── 6. AI CONTEXT (read-only) ── */}
      <section className="glass-panel p-6 space-y-3 border-dashed">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-heading text-[16px] text-muted-foreground">AI Context</h2>
        </div>
        <p className="font-body text-[12px] text-muted-foreground">
          This context is used by the AI Analyst when answering questions about <span className="font-semibold text-charcoal">{account.name}</span>.
          When you save, all sections above are concatenated and stored as the account's AI context.
        </p>
        <div className="bg-muted/50 rounded-md p-3 max-h-40 overflow-y-auto">
          <pre className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {buildAIContext(brandBrief, rules, offers, audienceNotes, competitorNotes) || "(empty — fill in the sections above)"}
          </pre>
        </div>
      </section>

      {/* Save */}
      <Button onClick={handleSave} disabled={save.isPending} className="gap-2">
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save Account Context
      </Button>
    </div>
  );
}
