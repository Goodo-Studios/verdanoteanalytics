// creative-embed — Entity Report (Feature 2), v1 TEXT clustering, step 1.
//
// Builds a per-creative text feature (ai_visual_notes + parsed tags) and embeds
// it via the SAME OpenRouter path vault-embed uses (openai/text-embedding-3-small,
// 512 dims), then upserts into creative_embeddings.
//
// Auth model: internal / service-role only — same as vault-embed. Invoked by the
// orchestrator (or a future pg_cron poke) with the service-role bearer; NOT
// linked from any client. Registered verify_jwt = false. No user JWT check.
//
// Body (all optional):
//   { account_id?: string, limit?: number, force?: boolean }
//   • account_id — restrict to one account (builder-account-first rollout).
//   • limit      — cap creatives processed this invocation (default 500).
//   • force      — re-embed even creatives that already have an embedding.
//
// v1 SKIPS creatives with no feature text (no ai_visual_notes AND no tags) rather
// than embedding noise; the skipped count is returned so coverage is visible.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { buildFeatureText } from "../_shared/entity-clustering.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MODEL = "openai/text-embedding-3-small";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Identical embedding call to vault-embed (single source of truth for the model
// + dims + provider). Kept inline to avoid coupling the two functions' deploys.
async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Verdanote",
    },
    body: JSON.stringify({ model: MODEL, input: text, dimensions: 512 }),
  });
  if (!res.ok) throw new Error(`Embedding API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding as number[];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await req.json().catch(() => ({}));
  const accountId: string | undefined = body.account_id;
  const limit: number = Math.min(Math.max(Number(body.limit) || 500, 1), 2000);
  const force: boolean = body.force === true;

  // Pull candidate creatives (tag + notes columns only — small).
  let q = db
    .from("creatives")
    .select("ad_id, account_id, ai_visual_notes, ad_type, person, style, product, hook, theme, tag_source")
    .limit(limit);
  if (accountId) q = q.eq("account_id", accountId);

  const { data: creatives, error } = await q;
  if (error) return json({ error: error.message }, 500);
  if (!creatives || creatives.length === 0) {
    return json({ ok: true, embedded: 0, skipped: 0, total: 0, coverage_pct: 0 });
  }

  // When not forcing, skip creatives that already have an embedding.
  let alreadyEmbedded = new Set<string>();
  if (!force) {
    let eq = db.from("creative_embeddings").select("ad_id");
    if (accountId) eq = eq.eq("account_id", accountId);
    const { data: existing } = await eq;
    alreadyEmbedded = new Set((existing ?? []).map((r: { ad_id: string }) => r.ad_id));
  }

  let embedded = 0;
  let skippedNoFeature = 0;
  let skippedExisting = 0;
  const errors: string[] = [];

  for (const c of creatives) {
    if (!force && alreadyEmbedded.has(c.ad_id)) {
      skippedExisting++;
      continue;
    }
    const text = buildFeatureText(c);
    if (!text) {
      skippedNoFeature++; // no ai_visual_notes and no tags — coverage loss, surfaced below
      continue;
    }
    try {
      const embedding = await embed(text);
      const { error: upErr } = await db.from("creative_embeddings").upsert(
        {
          ad_id: c.ad_id,
          account_id: c.account_id,
          embedding,
          source_text: text,
          model: MODEL,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "ad_id" },
      );
      if (upErr) errors.push(`${c.ad_id}: ${upErr.message}`);
      else embedded++;
    } catch (e) {
      errors.push(`${c.ad_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const total = creatives.length;
  const coveragePct = total > 0
    ? Math.round((1000 * (total - skippedNoFeature)) / total) / 10
    : 0;

  return json({
    ok: true,
    total,
    embedded,
    skipped_existing: skippedExisting,
    skipped_no_feature: skippedNoFeature,
    coverage_pct: coveragePct, // % of processed creatives that HAD a feature to embed
    errors: errors.slice(0, 20),
    error_count: errors.length,
  });
});
