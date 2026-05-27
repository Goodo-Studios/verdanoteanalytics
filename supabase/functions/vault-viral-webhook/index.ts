// vault-viral-webhook — Apify run completion handler.
// Apify calls this URL once an actor run finishes (succeeded / failed / aborted /
// timed out). On success we fetch the dataset, normalize via TRENDING_CONFIGS,
// classify each item with a single Claude Haiku call, and upsert into
// viral_feed_items.
//
// Ported from Creative Vault with workspace_id stripped — viral_feed_items in
// Verdanote is a global table. Upsert conflict key is (source_url, search_query)
// per the schema's UNIQUE constraint.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.1";
import { corsHeaders, json } from "../_shared/cors.ts";
import { TRENDING_CONFIGS } from "../_shared/trending-configs.ts";

const APIFY_BASE = "https://api.apify.com/v2";

const CATEGORIES = [
  "Beauty",
  "Fashion",
  "Health & Wellness",
  "Food & Beverage",
  "Fitness",
  "Tech & Gadgets",
  "Home & Lifestyle",
  "Pet Care",
  "Kids & Parenting",
  "Travel",
  "Finance",
  "Education",
  "Entertainment",
  "Other",
] as const;

type NormalizedRow = {
  platform: string;
  source_url: string;
  search_query: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  creator_handle: string | null;
  view_count: number | null;
  like_count: number | null;
  share_count: number | null;
  fetched_at: string;
  category?: string | null;
};

async function classifyCategories(
  rows: NormalizedRow[],
  anthropicKey: string
): Promise<string[]> {
  const client = new Anthropic({ apiKey: anthropicKey });

  const items = rows.map((r, i) => ({
    index: i,
    title: r.title ?? "",
    description: (r.description ?? "").slice(0, 200),
  }));

  const prompt = `Classify each video into exactly one category from this list:
${CATEGORIES.join(", ")}

Videos (JSON array):
${JSON.stringify(items)}

Respond with ONLY a JSON array of objects like: [{"index":0,"category":"Beauty"},{"index":1,"category":"Fitness"},...]
Include ALL items. No extra text, no code fences.`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    let text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "[]";
    // Strip markdown code fences the model sometimes adds
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      // Build index→category map; fill missing indices with "Other"
      const map: Record<number, string> = {};
      for (const item of parsed) {
        if (item && typeof item.index === "number" && typeof item.category === "string") {
          map[item.index] = item.category;
        }
      }
      return rows.map((_, i) => map[i] ?? "Other");
    }
  } catch (err) {
    console.error("Category classification failed:", err);
  }

  return rows.map(() => "Other");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apifyToken = Deno.env.get("APIFY_TOKEN")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const db = createClient(supabaseUrl, serviceRoleKey);

  try {
    const url = new URL(req.url);
    const platform = url.searchParams.get("platform") ?? "";
    const searchQuery = url.searchParams.get("search_query") ?? "";

    const body = await req.json();
    const eventType = (body.eventType ?? "") as string;
    const runId = (body.resource?.id ?? body.eventData?.actorRunId ?? "") as string;

    console.log(`vault-viral-webhook: platform=${platform} eventType=${eventType} runId=${runId}`);

    if (!platform) return json({ error: "platform required" }, 400);

    if (eventType !== "ACTOR.RUN.SUCCEEDED") {
      console.log(`Non-success event for ${platform}: ${eventType}`);
      return json({ ok: true });
    }

    const config = TRENDING_CONFIGS[platform];
    if (!config) {
      console.error(`Unknown platform: ${platform}`);
      return json({ error: `Unknown platform: ${platform}` }, 400);
    }

    const datasetRes = await fetch(
      `${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${apifyToken}`
    );
    if (!datasetRes.ok) {
      throw new Error(`Failed to fetch Apify dataset for run ${runId}: status ${datasetRes.status}`);
    }

    const rawItems = await datasetRes.json();
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      console.log(`No items in dataset for run ${runId}`);
      return json({ ok: true, upserted: 0 });
    }

    console.log(`Processing ${rawItems.length} items for ${platform}`);

    const rows: NormalizedRow[] = rawItems
      .map((item) => {
        const normalized = config.normalize(item);
        if (!normalized) return null;
        return {
          platform,
          source_url: normalized.sourceUrl,
          search_query: searchQuery,
          title: normalized.title,
          description: normalized.description,
          thumbnail_url: normalized.thumbnailUrl,
          creator_handle: normalized.creatorHandle,
          view_count: normalized.viewCount,
          like_count: normalized.likeCount,
          share_count: normalized.shareCount,
          fetched_at: new Date().toISOString(),
        } as NormalizedRow;
      })
      .filter(Boolean) as NormalizedRow[];

    if (rows.length === 0) {
      console.log("No normalizable items from dataset");
      return json({ ok: true, upserted: 0 });
    }

    // Classify categories in a single Haiku call.
    if (anthropicKey) {
      const categories = await classifyCategories(rows, anthropicKey);
      categories.forEach((cat, i) => {
        rows[i].category = cat;
      });
    }

    // Upsert in batches of 50.
    // first_seen_at is NOT included in rows — the DB default (now()) sets it on
    // INSERT, and it's omitted from the conflict update list automatically
    // because it's not in the row object.
    // Conflict key matches the schema's unique(source_url, search_query).
    const BATCH = 50;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await db
        .from("viral_feed_items")
        .upsert(batch, { onConflict: "source_url,search_query", ignoreDuplicates: false });
      if (error) {
        console.error(`Upsert error (batch ${i}):`, error.message);
      } else {
        upserted += batch.length;
      }
    }

    console.log(`Upserted ${upserted}/${rows.length} items for platform=${platform}`);
    return json({ ok: true, upserted });
  } catch (err) {
    console.error("vault-viral-webhook error:", err);
    return json({ error: String(err) }, 500);
  }
});
