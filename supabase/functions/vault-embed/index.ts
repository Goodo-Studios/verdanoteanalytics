// vault-embed — port from Creative Vault (US-003).
// Differences from source:
//   • No workspace_id references — items are scoped by user_id directly.
//   • Called internally with service-role bearer (e.g. from a DB trigger or
//     another function) — does not verify a user JWT.
//
// Pipeline role: builds a search-friendly text blob from
// (title + creator + platform + hook formula + value structure + cleaned
// transcript), embeds it with OpenAI text-embedding-3-small (512 dims), and
// upserts the vector into item_embeddings for semantic search via vault-search.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Verdanote",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
      dimensions: 512,
    }),
  });
  if (!res.ok) throw new Error(`Embedding API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding as number[];
}

Deno.serve(async (req) => {
  const { item_id } = await req.json() as { item_id: string };
  if (!item_id) return json({ error: "item_id required" }, 400);

  // Collect text to embed: transcript + hook formula + creator + platform
  const { data: item } = await db
    .from("inspiration_items")
    .select(`
      platform, creator_handle, title,
      inspiration_transcripts(cleaned_script),
      inspiration_frameworks(hook_formula, value_structure, cta_formula)
    `)
    .eq("id", item_id)
    .single();

  if (!item) return json({ error: "Item not found" }, 404);

  const transcript = (item.inspiration_transcripts as Array<{ cleaned_script: string | null }>)?.[0]
    ?.cleaned_script ?? "";
  const framework = (item.inspiration_frameworks as Array<{
    hook_formula: string | null;
    value_structure: string | null;
    cta_formula: string | null;
  }>)?.[0];

  const parts = [
    item.title ?? "",
    item.creator_handle ? `Creator: @${item.creator_handle}` : "",
    item.platform ? `Platform: ${item.platform}` : "",
    framework?.hook_formula ?? "",
    framework?.value_structure ?? "",
    transcript,
  ].filter(Boolean);

  if (parts.length === 0) return json({ error: "No content to embed" }, 422);

  const text = parts.join("\n\n").slice(0, 8000); // token budget guard
  const embedding = await embed(text);

  await db.from("item_embeddings").upsert(
    { item_id, embedding, model: "openai/text-embedding-3-small" },
    { onConflict: "item_id" },
  );

  return json({ ok: true, item_id });
});
