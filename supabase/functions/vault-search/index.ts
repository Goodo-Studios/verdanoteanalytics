// vault-search — port from Creative Vault (US-002).
// Differences from source:
//   • RLS gate is vault_visible_item_ids (Verdanote-prefixed); function name unchanged.
//   • User-scoped only; no workspace concept.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Verdanote Vault",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 4000),
      dimensions: 512,
    }),
  });
  if (!res.ok) throw new Error(`Embedding error ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding as number[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  // Use the caller's session to enforce RLS on match_items (vault_visible_item_ids check).
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { query, threshold = 0.4, limit = 20 } = await req.json() as {
    query: string;
    threshold?: number;
    limit?: number;
  };

  if (!query?.trim()) return json({ error: "query required" }, 400);

  const embedding = await embed(query);

  // match_items runs as the calling user, respecting vault_visible_item_ids() RLS
  const { data: matches, error } = await userClient.rpc("match_items", {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit,
  });

  if (error) return json({ error: error.message }, 500);

  const itemIds = (matches ?? []).map((m: { item_id: string }) => m.item_id);

  if (itemIds.length === 0) return json({ items: [], similarities: {} });

  const { data: items, error: itemsErr } = await userClient
    .from("inspiration_items")
    .select(`
      *,
      inspiration_transcripts(cleaned_script),
      inspiration_frameworks(hook_formula)
    `)
    .in("id", itemIds);

  if (itemsErr) return json({ error: itemsErr.message }, 500);

  // Build similarity map for optional display
  const similarities: Record<string, number> = {};
  for (const m of matches ?? []) {
    similarities[m.item_id] = m.similarity;
  }

  // Return items in similarity order
  const ordered = [...(items ?? [])].sort(
    (a, b) => (similarities[b.id] ?? 0) - (similarities[a.id] ?? 0),
  );

  return json({ items: ordered, similarities });
});
