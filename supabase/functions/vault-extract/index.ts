// vault-extract — port from Creative Vault (US-002). User-scoped only; no workspace concept.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ACTOR_CONFIGS } from "../_shared/actor-configs.ts";
import { detectPlatform } from "../_shared/platform.ts";

const APIFY_BASE = "https://api.apify.com/v2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apifyToken = Deno.env.get("APIFY_TOKEN");
  const db = createClient(supabaseUrl, serviceRoleKey);

  let itemId = "";
  try {
    const body = await req.json();
    itemId = body.item_id;
    if (!itemId) return json({ error: "item_id required" }, 400);

    const { data: item, error: fetchError } = await db
      .from("inspiration_items")
      .select("id, source_url, platform")
      .eq("id", itemId)
      .single();

    if (fetchError || !item) return json({ error: "Item not found" }, 404);
    if (!item.source_url) return json({ error: "No source_url on item" }, 400);

    if (!apifyToken) {
      throw new Error(
        "APIFY_TOKEN secret is not set. Sign up at apify.com, copy your API token from " +
        "Settings → Integrations, and add it as a Supabase secret named APIFY_TOKEN. " +
        "As a workaround, download the video and use the Upload tab instead."
      );
    }

    const platform = item.platform ?? detectPlatform(item.source_url);
    const config = ACTOR_CONFIGS[platform];
    if (!config) {
      throw new Error(
        `Unsupported platform "${platform}". Download the video and use the Upload tab instead.`
      );
    }

    await db.from("inspiration_items").update({ status: "extracting" }).eq("id", itemId);

    // Webhook URL — Apify POSTs here when the run succeeds or fails.
    // itemId is passed as a query param so we don't need Apify's template engine at all.
    // vault-extract-webhook reads eventType and runId from Apify's default payload body.
    const webhookUrl = `${supabaseUrl}/functions/v1/vault-extract-webhook?item_id=${itemId}`;
    const webhooks = [
      {
        eventTypes: [
          "ACTOR.RUN.SUCCEEDED",
          "ACTOR.RUN.FAILED",
          "ACTOR.RUN.ABORTED",
          "ACTOR.RUN.TIMED_OUT",
        ],
        requestUrl: webhookUrl,
        // No payloadTemplate — use Apify's default payload which reliably includes
        // eventType and resource.id without requiring template variable resolution.
      },
    ];
    // Apify expects a base64-encoded JSON array. Must be URL-encoded so +/= in the
    // base64 output don't get misinterpreted as query-string metacharacters.
    const webhooksParam = encodeURIComponent(btoa(JSON.stringify(webhooks)));

    // Start the run asynchronously — returns in milliseconds with a runId.
    // The actor does its work in the background; the webhook fires when it finishes.
    // apiRunOptions lets per-platform configs override Apify run-level params
    // (e.g. YouTube sets timeout=300 to avoid CONFIG_TIMEOUT_TOO_LOW on 1080p).
    const extraParams = config.apiRunOptions
      ? "&" + Object.entries(config.apiRunOptions).map(([k, v]) => `${k}=${v}`).join("&")
      : "";
    const runRes = await fetch(
      `${APIFY_BASE}/acts/${config.actorId}/runs?token=${apifyToken}&webhooks=${webhooksParam}${extraParams}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          config.buildInputWithEnv
            ? config.buildInputWithEnv(item.source_url, Deno.env.toObject())
            : config.buildInput(item.source_url)
        ),
      }
    );

    if (!runRes.ok) {
      const text = await runRes.text();
      if (runRes.status === 401 || runRes.status === 403) {
        throw new Error(
          "Invalid or unauthorized APIFY_TOKEN. Check your token at console.apify.com and update the Supabase secret."
        );
      }
      if (runRes.status === 402) {
        // Apify concurrent-run memory limit hit — this is transient, not a permanent failure.
        // Mark as pending so the next import run will re-trigger extraction automatically.
        await db.from("inspiration_items").update({
          status: "pending",
          error_message: null,
        }).eq("id", itemId);
        return json({ ok: false, retry: true, item_id: itemId, reason: "memory-limit" });
      }
      throw new Error(`Apify start-run error ${runRes.status}: ${text.slice(0, 300)}`);
    }

    const runData = await runRes.json();
    const runId: string = runData?.data?.id ?? "(unknown)";
    console.log(`Started Apify run ${runId} for item ${itemId} (platform: ${platform})`);

    return json({ ok: true, item_id: itemId, run_id: runId });
  } catch (err) {
    console.error("vault-extract error:", err);
    if (itemId) {
      await db
        .from("inspiration_items")
        .update({ status: "error", error_message: String(err) })
        .eq("id", itemId);
    }
    return json({ error: String(err) }, 500);
  }
});
