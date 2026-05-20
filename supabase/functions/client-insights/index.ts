import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";


const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { accountId } = await req.json();
    if (!accountId) {
      return new Response(JSON.stringify({ error: "accountId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch top creatives for this account
    const { data: creatives } = await supabase
      .from("creatives")
      .select("ad_name, spend, roas, cpa, ctr, ad_type, style, hook, theme, product")
      .eq("account_id", accountId)
      .order("spend", { ascending: false })
      .limit(50);

    if (!creatives || creatives.length === 0) {
      return new Response(JSON.stringify({ insights: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build a summary for the AI
    const totalSpend = creatives.reduce((s: number, c: any) => s + (c.spend || 0), 0);
    const totalPV = creatives.reduce((s: number, c: any) => s + (c.spend || 0) * (c.roas || 0), 0);
    const avgRoas = totalSpend > 0 ? totalPV / totalSpend : 0;

    const topBySpend = [...creatives].filter(c => (c.spend || 0) > 50)
      .sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 5);

    const byType: Record<string, { spend: number; pv: number; count: number }> = {};
    for (const c of creatives) {
      const t = c.ad_type || c.style || "unknown";
      if (!byType[t]) byType[t] = { spend: 0, pv: 0, count: 0 };
      byType[t].spend += c.spend || 0;
      byType[t].pv += (c.spend || 0) * (c.roas || 0);
      byType[t].count++;
    }

    const typeBreakdown = Object.entries(byType)
      .filter(([_, v]) => v.spend > 0)
      .map(([t, v]) => `${t}: ROAS ${(v.pv / v.spend).toFixed(2)}x, ${v.count} ads, $${v.spend.toFixed(0)} spend`)
      .join("\n");

    const creativeSummary = topBySpend
      .map(c => `"${c.ad_name}" — Spend: $${(c.spend || 0).toFixed(0)}, ROAS: ${(c.roas || 0).toFixed(2)}x, CPA: $${(c.cpa || 0).toFixed(2)}, Type: ${c.ad_type || c.style || "N/A"}`)
      .join("\n");

    const prompt = `You are a creative performance analyst writing insights for a business owner who is NOT a marketer.

DATA SUMMARY:
- ${creatives.length} creatives, $${totalSpend.toFixed(0)} total spend, ${avgRoas.toFixed(2)}x blended ROAS

TOP PERFORMERS (by spend — highest spend = most trusted by media buyers):
${creativeSummary}

PERFORMANCE BY FORMAT/TYPE:
${typeBreakdown}

Generate EXACTLY 3 short, plain-English insights. Each must be ONE sentence, conversational, and specific with real numbers from the data. Use the ad names directly. Do NOT use jargon.

Examples of tone:
- "Your top creative this week is 'Summer Sale V2' with a 4.2x return on ad spend."
- "Video ads are outperforming static images by 35% on average."
- "'Beach Lifestyle' has your best cost per purchase at $12.50."

Return ONLY a JSON array of 3 strings, no other text. Example: ["insight 1", "insight 2", "insight 3"]`;

    const aiResponse = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY!,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: "You output only valid JSON arrays. No markdown, no code fences.",
        messages: [
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("OpenRouter error:", status, await aiResponse.text());
      return new Response(JSON.stringify({ insights: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    let raw = aiData.content?.[0]?.text ?? "[]";
    
    // Strip markdown fences if present
    raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    
    let insights: string[] = [];
    try {
      insights = JSON.parse(raw);
      if (!Array.isArray(insights)) insights = [];
    } catch {
      console.error("Failed to parse AI insights:", raw);
      insights = [];
    }

    return new Response(JSON.stringify({ insights: insights.slice(0, 3) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("client-insights error:", err);
    return new Response(JSON.stringify({ error: "Failed to generate insights" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
