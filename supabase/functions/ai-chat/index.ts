import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

type AnalysisMode = "free_chat" | "weekly_brief" | "competitive_debrief" | "concept_planner";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { message, conversationId, accountId, mode = "free_chat", modeInputs } = await req.json();
    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: "Message required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load existing conversation if continuing
    let existingMessages: { role: string; content: string }[] = [];
    let convId = conversationId;

    if (convId) {
      const { data: conv } = await supabase
        .from("ai_conversations")
        .select("messages")
        .eq("id", convId)
        .eq("user_id", user.id)
        .single();
      if (conv?.messages) existingMessages = conv.messages;
    }

    // Fetch creative context data
    const contextData = await fetchCreativeContext(supabase, accountId, user.id);

    // Fetch account settings for competitive debrief
    let accountSettings: any = null;
    if (accountId && accountId !== "all") {
      const { data: acc } = await supabase
        .from("ad_accounts")
        .select("industry_category, target_roas, target_cpa, target_monthly_spend, click_window, view_window")
        .eq("id", accountId)
        .single();
      accountSettings = acc;
    }

    const systemPrompt = buildSystemPrompt(contextData, mode as AnalysisMode, accountSettings, modeInputs);

    // Build messages array for AI
    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...existingMessages,
      { role: "user", content: message },
    ];

    // Call Lovable AI
    const aiResponse = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: aiMessages,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please top up your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const answer = aiData.choices?.[0]?.message?.content ?? "Sorry, I could not generate a response.";

    // Persist conversation
    const updatedMessages = [
      ...existingMessages,
      { role: "user", content: message },
      { role: "assistant", content: answer },
    ];

    if (convId) {
      await supabase
        .from("ai_conversations")
        .update({ messages: updatedMessages, updated_at: new Date().toISOString() })
        .eq("id", convId);
    } else {
      const { data: newConv } = await supabase
        .from("ai_conversations")
        .insert({
          user_id: user.id,
          account_id: accountId && accountId !== "all" ? accountId : null,
          messages: updatedMessages,
          context: { mode },
        })
        .select("id")
        .single();
      convId = newConv?.id;
    }

    return new Response(JSON.stringify({ answer, conversationId: convId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-chat error:", err);
    return new Response(JSON.stringify({ error: "Failed to process request" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function fetchCreativeContext(supabase: any, accountId: string | null, userId: string) {
  let creativesQuery = supabase
    .from("creatives")
    .select("ad_name, spend, roas, cpa, ctr, thumb_stop_rate, hold_rate, ad_type, tag_source, hook, theme, product, style, ad_status, person, unique_code, created_at")
    .order("spend", { ascending: false })
    .limit(60);

  if (accountId && accountId !== "all") {
    creativesQuery = creativesQuery.eq("account_id", accountId);
  }

  const { data: creatives } = await creativesQuery;

  let accountName = "All Accounts";
  if (accountId && accountId !== "all") {
    const { data: acc } = await supabase
      .from("ad_accounts")
      .select("name")
      .eq("id", accountId)
      .single();
    if (acc) accountName = acc.name;
  }

  return { creatives: creatives || [], accountName };
}

function formatCreativeTable(creatives: any[]): string {
  return creatives.slice(0, 40).map(c =>
    `${c.ad_name} | $${(c.spend||0).toFixed(0)} | ${(c.roas||0).toFixed(2)}x | $${(c.cpa||0).toFixed(0)} | ${((c.ctr||0)*100).toFixed(1)}% | ${((c.thumb_stop_rate||0)*100).toFixed(1)}% | ${((c.hold_rate||0)*100).toFixed(1)}% | ${c.ad_type||'?'} | ${c.hook||'?'} | ${c.style||'?'} | ${c.ad_status||'?'}`
  ).join("\n");
}

function computeStats(creatives: any[]) {
  const totalSpend = creatives.reduce((s, c) => s + (c.spend || 0), 0);
  const avgRoas = creatives.length
    ? creatives.reduce((s, c) => s + (c.roas || 0), 0) / creatives.length
    : 0;
  const avgCtr = creatives.length
    ? creatives.reduce((s, c) => s + (c.ctr || 0), 0) / creatives.length
    : 0;
  const avgCpa = creatives.length
    ? creatives.reduce((s, c) => s + (c.cpa || 0), 0) / creatives.length
    : 0;

  const topByRoas = [...creatives]
    .filter(c => c.roas > 0)
    .sort((a, b) => b.roas - a.roas)
    .slice(0, 5)
    .map(c => `"${c.ad_name}" (ROAS: ${c.roas?.toFixed(2)}, Spend: $${c.spend?.toFixed(0)})`)
    .join("; ");

  const topBySpend = [...creatives]
    .sort((a, b) => (b.spend || 0) - (a.spend || 0))
    .slice(0, 5)
    .map(c => `"${c.ad_name}" (Spend: $${c.spend?.toFixed(0)}, ROAS: ${c.roas?.toFixed(2)}x)`)
    .join("; ");

  return { totalSpend, avgRoas, avgCtr, avgCpa, topByRoas, topBySpend };
}

function buildSystemPrompt(
  ctx: { creatives: any[]; accountName: string },
  mode: AnalysisMode,
  accountSettings: any,
  modeInputs?: any
): string {
  const { creatives, accountName } = ctx;
  const stats = computeStats(creatives);
  const table = formatCreativeTable(creatives);

  const baseContext = `CURRENT ACCOUNT: ${accountName}
DATASET: ${creatives.length} creatives | Total Spend: $${stats.totalSpend.toFixed(0)} | Avg ROAS: ${stats.avgRoas.toFixed(2)}x | Avg CTR: ${(stats.avgCtr * 100).toFixed(2)}% | Avg CPA: $${stats.avgCpa.toFixed(0)}

TOP PERFORMERS BY ROAS: ${stats.topByRoas || "N/A"}
TOP SPENDERS: ${stats.topBySpend || "N/A"}

FULL CREATIVE DATA (name | spend | roas | cpa | ctr% | hook% | hold% | type | hook | style | status):
${table}`;

  switch (mode) {
    case "weekly_brief":
      return `You are Verdanote AI, an expert creative performance analyst. You generate structured weekly performance briefs.

${baseContext}

You MUST respond in EXACTLY this markdown format — no deviations:

## Week of [use today's date in Month Day, Year format]

### 🏆 What Worked
[Analyze the top 3 creatives by SPEND (highest spend = most trusted/scaled). For each, state: ad name, spend, ROAS, CPA, and a brief explanation of WHY it worked based on its type, hook, style, and metrics. High spend indicates the media buyer is confident in the ad.]

### ⚠️ What Didn't
[Analyze the 3 worst-performing creatives with spend > $500 by ROAS. For each, state: ad name, ROAS, spend, CPA, and diagnose WHY it underperformed — weak hook rate? low hold? bad CPA?]

### 📊 Patterns
[2-3 data-driven observations about patterns across the dataset. E.g. "UGC styles average 2.3x ROAS vs static at 1.1x", "Problem-solution hooks outperform by 40%"]

### ✅ Recommended Actions
[3 specific, numbered action items for next week. Be tactical — e.g. "Kill ad X (0.6x ROAS at $800 spend)", "Scale ad Y — increase budget 30%"]

### 💡 What to Make Next
[2-3 specific creative concepts to produce, each with: concept name, format (UGC/static/video), hook approach, and why based on the data]`;

    case "competitive_debrief":
      const industry = accountSettings?.industry_category || "General DTC";
      const targetRoas = accountSettings?.target_roas || 2.0;
      const targetCpa = accountSettings?.target_cpa;
      const clickWindow = accountSettings?.click_window || 7;
      const viewWindow = accountSettings?.view_window || 1;

      return `You are Verdanote AI, an expert creative strategist who provides competitive performance analysis.

${baseContext}

ACCOUNT SETTINGS:
- Industry: ${industry}
- Target ROAS: ${targetRoas}x
- Target CPA: ${targetCpa ? `$${targetCpa}` : "Not set"}
- Attribution: ${clickWindow}-day click, ${viewWindow === 0 ? "no view" : `${viewWindow}-day view`}

INDUSTRY BENCHMARKS (use these as reference):
- DTC General: ROAS 1.5-3.0x, CTR 1.5-3.0%, CPA $15-40
- Apparel: ROAS 2.0-4.0x, CTR 1.8-3.5%, CPA $20-50
- Beauty: ROAS 2.5-5.0x, CTR 2.0-4.0%, CPA $15-35
- Food & Bev: ROAS 1.5-3.0x, CTR 1.2-2.5%, CPA $10-30
- Health & Wellness: ROAS 2.0-4.0x, CTR 1.5-3.0%, CPA $25-60
- Software/SaaS: ROAS 1.0-2.5x, CTR 0.8-2.0%, CPA $30-100
- Pet: ROAS 2.0-3.5x, CTR 1.5-3.0%, CPA $20-45
- Home: ROAS 1.8-3.5x, CTR 1.2-2.5%, CPA $25-60

Respond in this structure:

## Competitive Analysis: ${accountName}

### 📈 Performance vs Industry
[Compare ROAS, CTR, CPA against the ${industry} benchmarks. Use specific numbers. State if above/at/below benchmark.]

### 🏆 Where You're Winning
[2-3 areas where the account outperforms. Cite specific creatives or patterns driving it.]

### ⚠️ Where You're Behind
[2-3 areas of underperformance. Diagnose root causes — is it creative quality, targeting, or funnel?]

### 🎯 Strategic Recommendations
[3-4 specific creative strategy recommendations to close gaps and double down on strengths. Be actionable.]`;

    case "concept_planner":
      const product = modeInputs?.product || "";
      const audience = modeInputs?.audience || "";
      const goal = modeInputs?.goal || "";

      return `You are Verdanote AI, an expert creative concept planner for paid social advertising.

${baseContext}

USER BRIEF:
- Product: ${product}
- Target Audience: ${audience}
- Goal: ${goal}

Based on the performance data from this account AND the user's brief, create a structured creative concept plan.

You MUST output EXACTLY 3 concepts in this format:

## Creative Concept Plan

### Concept 1: [Concept Name]
- **Hook** (opening 3 seconds): [Describe exactly what happens in the first 3 seconds]
- **Format**: [UGC / Static / Video / Carousel — pick one]
- **Angle**: [Offer / Social Proof / Problem-Solution / Aspirational / Fear-of-Missing / Education — pick one]
- **Why This Works**: [1-2 sentences explaining why this concept fits the audience, referencing performance data]
- **Reference**: [Name a similar creative from the account data that performed well, with its ROAS]
- **Suggested Ad Name**: [Follow the account's naming convention if visible, e.g. "PRODUCT_STYLE_HOOK_v1"]

### Concept 2: [Concept Name]
[Same structure]

### Concept 3: [Concept Name]
[Same structure]

### Production Notes
[2-3 sentences on shoot requirements, talent needs, and estimated production timeline]`;

    default: // free_chat
      return `You are Verdanote AI, an expert creative performance analyst for Meta advertising.

${baseContext}

You have deep knowledge of Meta advertising, creative strategy, and performance marketing. 
Answer questions concisely but thoroughly. When asked for recommendations, be specific and actionable.
Format responses with markdown when helpful (lists, bold key metrics).`;
  }
}
