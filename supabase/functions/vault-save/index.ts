// vault-save — port from Creative Vault (US-002).
// Differences from source:
//   • workspace_id stripped (Verdanote scopes inspiration_items by user_id directly).
//   • brand_name retained because the inspiration_items schema (US-001) keeps it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { detectPlatform } from "../_shared/platform.ts";
import { errorMessage } from "../_shared/error-message.ts";

// Supabase Edge Runtime global (not in Deno's lib types).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// How long vault-save waits for the downstream pipeline function to
// acknowledge before handing the in-flight call to EdgeRuntime.waitUntil.
// Long enough for vault-extract's fast ack (it just starts an Apify run) and
// for any immediate failure (DNS, 4xx/5xx) to surface; short enough that the
// save response stays snappy for the polling UI.
const KICKOFF_ACK_TIMEOUT_MS = 10_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { url, file_path, platform: explicitPlatform, mime_type, brand_name, thumbnail_url } = body;

    if (!url && !file_path) return json({ error: "url or file_path is required" }, 400);

    const platform = explicitPlatform ?? (url ? detectPlatform(url) : "upload");
    const isVideo = !mime_type || mime_type.startsWith("video/");

    let adArchiveId: string | null = null;
    if (platform === "facebook_ad" && url) {
      try {
        adArchiveId = new URL(url).searchParams.get("id");
      } catch { /* ignore malformed URLs */ }
    }

    // Insert the item — user-scoped only, no workspace_id.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: item, error: insertError } = await adminClient
      .from("inspiration_items")
      .insert({
        user_id: user.id,
        source_url: url ?? null,
        platform,
        file_path: file_path ?? null,
        thumbnail_url: thumbnail_url ?? null,
        brand_name: brand_name ?? null,
        ad_archive_id: adArchiveId,
        status: url ? "extracting" : (isVideo ? "transcribing" : "analyzing"),
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Kick off the pipeline.
    // A non-video upload is a static image — route it straight to vault-analyze and
    // tell it the media kind so it runs the image-only branch (no transcript).
    //
    // Per policy (verdanote-edge-fn-no-waituntil-for-required-calls), this call
    // must not be fire-and-forget: EdgeRuntime.waitUntil can silently drop it,
    // leaving the item stuck in a non-terminal status forever. But the slow
    // downstream functions (vault-transcribe / vault-analyze) only respond
    // AFTER doing their full work (Groq/Anthropic calls, up to minutes), so a
    // full `await` would block the save response the polling UI needs item_id
    // from. Compromise consistent with how vault-status/useItemStatus surface
    // pipeline state: initiate the fetch eagerly and AWAIT it for a bounded
    // ack window — guaranteeing the request is actually dispatched while the
    // handler is live (closing the waitUntil silent-drop window) and catching
    // immediate failures. Any kick-off failure (rejection or non-2xx) marks
    // the item status='error' with an error_message, which useItemStatus polls
    // — so a dead pipeline is visible instead of stuck-looking-successful.
    // Only if the downstream is still working past the ack window does the
    // remainder ride on waitUntil; at that point the downstream has received
    // the request and its own error handling owns the item status.
    const nextFunction = url ? "vault-extract" : (isVideo ? "vault-transcribe" : "vault-analyze");

    const markKickoffFailed = async (reason: string) => {
      console.error(`vault-save: ${nextFunction} kick-off failed for item ${item.id}:`, reason);
      const { error: markError } = await adminClient
        .from("inspiration_items")
        .update({ status: "error", error_message: `Pipeline kick-off failed: ${reason}` })
        .eq("id", item.id);
      if (markError) console.error("vault-save: failed to mark item errored:", markError);
    };

    const kickoff = (async () => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/${nextFunction}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ item_id: item.id, media_kind: isVideo ? "video" : "image" }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          await markKickoffFailed(`${nextFunction} responded ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
        }
      } catch (e) {
        await markKickoffFailed(errorMessage(e));
      }
    })();

    const TIMED_OUT = Symbol("kickoff-ack-timeout");
    let ackTimer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      kickoff,
      new Promise((resolve) => {
        ackTimer = setTimeout(() => resolve(TIMED_OUT), KICKOFF_ACK_TIMEOUT_MS);
      }),
    ]);
    if (ackTimer !== undefined) clearTimeout(ackTimer);
    if (settled === TIMED_OUT) {
      // Downstream received the request and is still working — keep the
      // isolate alive for the in-flight call (and its error-marking handler).
      EdgeRuntime.waitUntil(kickoff);
    }

    return json({ item_id: item.id });
  } catch (err) {
    const msg = errorMessage(err);
    console.error("vault-save error:", msg);
    return json({ error: msg }, 500);
  }
});
