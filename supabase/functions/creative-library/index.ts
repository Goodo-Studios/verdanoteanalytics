import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

// Session-authed first-party path for the Creative Library (Feature 4 + F3).
//
// get_creative_library / get_creative_classification are SECURITY DEFINER and
// TRUST their p_account_id, so authenticated EXECUTE is revoked (migration
// 20260716000002). This function is the ONLY sanctioned caller: it verifies the
// caller's session JWT, enforces verifyAccountOwnership(), then invokes the RPCs
// with the service-role client — mirroring supabase/functions/leaderboard.
//
// Routes (all require a valid session JWT + account ownership):
//   GET  ?account_id=&from=&to=            -> library rows (playable cards + perf)
//   POST { action:"archive", account_id, ad_ids? }  -> durably archive creatives
//                                                        into media_archive (F3)
//
// Bulk-zip export is handled by the sibling creative-media-archive function so
// this function stays a thin read/classify + archive path.

// Builders and employees have global access; clients must have a user_accounts row.
async function verifyAccountOwnership(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  accountId: string,
): Promise<boolean> {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (role === "builder" || role === "employee") return true;

  const { data, error } = await supabase
    .from("user_accounts")
    .select("account_id")
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .maybeSingle();

  return !error && data !== null;
}

/** ISO yyyy-mm-dd for a Date. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Resolve + validate the [from,to] window (default: trailing 30 days, cap 365). */
function resolveWindow(fromRaw: string | null, toRaw: string | null): { from: string; to: string } {
  const today = new Date();
  const to = toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : isoDate(today);
  let from: string;
  if (fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
    from = fromRaw;
  } else {
    const d = new Date(to);
    d.setDate(d.getDate() - 29);
    from = isoDate(d);
  }
  // Guard: cap at 365 days so the RPC's window guard is never tripped as a 500.
  const spanDays = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  if (spanDays > 365) {
    const d = new Date(to);
    d.setDate(d.getDate() - 365);
    from = isoDate(d);
  }
  return { from, to };
}

// deno-lint-ignore no-explicit-any
async function authedContext(req: Request): Promise<{ supabase: any; userId: string } | Response> {
  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return json({ error: "Unauthorized", detail: error?.message }, 401);
  return { supabase, userId: user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ctx = await authedContext(req);
  if (ctx instanceof Response) return ctx;
  const { supabase, userId } = ctx;

  try {
    // ── GET: library rows ────────────────────────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const accountId = url.searchParams.get("account_id");
      if (!accountId) return json({ error: "account_id is required" }, 400);
      if (!(await verifyAccountOwnership(supabase, userId, accountId))) {
        return json({ error: "Access denied" }, 403);
      }
      const { from, to } = resolveWindow(
        url.searchParams.get("from"),
        url.searchParams.get("to"),
      );
      const { data, error } = await supabase.rpc("get_creative_library", {
        p_account_id: accountId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return json({ account_id: accountId, from, to, rows: data ?? [] });
    }

    // ── POST: archive selected (or all live) creatives durably ────────────────
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = body?.action ?? "archive";
      const accountId = body?.account_id;
      if (!accountId) return json({ error: "account_id is required" }, 400);
      if (!(await verifyAccountOwnership(supabase, userId, accountId))) {
        return json({ error: "Access denied" }, 403);
      }

      if (action !== "archive") {
        return json({ error: `Unknown action '${action}'` }, 400);
      }

      // Which creatives to archive: explicit ad_ids, or all live creatives.
      let adIds: string[] = Array.isArray(body?.ad_ids) ? body.ad_ids : [];
      if (adIds.length === 0) {
        const { data: live, error: liveErr } = await supabase
          .from("creatives")
          .select("ad_id")
          .eq("account_id", accountId)
          .eq("ad_status", "ACTIVE");
        if (liveErr) throw liveErr;
        adIds = (live ?? []).map((r: { ad_id: string }) => r.ad_id);
      }
      if (adIds.length === 0) return json({ ok: true, archived: 0, rows: [] });

      // Pull the source creatives (media refs + AI analysis captured at archive
      // time so Save-to-Vault reuses the payload rather than re-scraping).
      const { data: creatives, error: cErr } = await supabase
        .from("creatives")
        .select(
          "ad_id, account_id, thumb_asset_id, video_asset_id, ai_analysis, ai_hook_analysis, ai_visual_notes, ai_cta_notes",
        )
        .eq("account_id", accountId)
        .in("ad_id", adIds);
      if (cErr) throw cErr;

      // Resolve media_assets storage locations for the referenced assets.
      const assetIds = [
        ...new Set(
          (creatives ?? [])
            .flatMap((c: Record<string, unknown>) => [c.thumb_asset_id, c.video_asset_id])
            .filter((x: unknown): x is string => typeof x === "string"),
        ),
      ];
      const assetById = new Map<string, { bucket: string; storage_path: string; byte_size: number | null; media_type: string }>();
      if (assetIds.length > 0) {
        const { data: assets } = await supabase
          .from("media_assets")
          .select("id, bucket, storage_path, byte_size, media_type")
          .in("id", assetIds);
        for (const a of assets ?? []) assetById.set(a.id, a);
      }

      const nowIso = new Date().toISOString();
      const rows = (creatives ?? []).map((c: Record<string, unknown>) => {
        const thumb = c.thumb_asset_id ? assetById.get(c.thumb_asset_id as string) : undefined;
        const video = c.video_asset_id ? assetById.get(c.video_asset_id as string) : undefined;
        const framework = {
          ai_analysis: c.ai_analysis ?? null,
          ai_hook_analysis: c.ai_hook_analysis ?? null,
          ai_visual_notes: c.ai_visual_notes ?? null,
          ai_cta_notes: c.ai_cta_notes ?? null,
        };
        return {
          account_id: accountId,
          ad_id: c.ad_id,
          thumb_asset_id: c.thumb_asset_id ?? null,
          video_asset_id: c.video_asset_id ?? null,
          retention: "keep",
          framework,
          thumb_storage_path: thumb?.storage_path ?? null,
          video_storage_path: video?.storage_path ?? null,
          thumb_bucket: thumb?.bucket ?? null,
          video_bucket: video?.bucket ?? null,
          byte_size: (thumb?.byte_size ?? 0) + (video?.byte_size ?? 0) || null,
          updated_at: nowIso,
        };
      });

      // Upsert on (account_id, ad_id) so re-archiving refreshes rather than dupes.
      const { data: upserted, error: upErr } = await supabase
        .from("media_archive")
        .upsert(rows, { onConflict: "account_id,ad_id" })
        .select("id, ad_id");
      if (upErr) throw upErr;

      return json({ ok: true, archived: upserted?.length ?? 0, rows: upserted ?? [] });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
