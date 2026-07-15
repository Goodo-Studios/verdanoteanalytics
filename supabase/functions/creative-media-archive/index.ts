import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { zip } from "https://esm.sh/fflate@0.8.2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { buildExportManifest, safeZipEntryName } from "../_shared/media-archive-export.ts";

// F3 — one-click BULK ZIP export of selected creatives' durably-archived media.
//
// Session-authed (mirrors leaderboard / creative-library): verify the caller's
// JWT + account ownership, then do all storage work with the service-role client.
//
// Reuses the DURABLE copies already in storage (media_archive storage paths) —
// it never re-scrapes Meta. Selected creatives that are not yet archived are
// archived on the fly (retention=keep) via the same storage refs before zipping,
// so the export is always self-consistent with the durability promise.
//
// Routes:
//   POST { action:"export", account_id, ad_ids }  -> build a zip, upload to the
//         private creative-archive bucket, record a media_archive_export_jobs
//         row, return { job_id, download_url } (short-lived signed URL).
//   GET  ?job_id=  -> poll a job; returns status + a fresh signed download_url
//         when ready.

const ZIP_BUCKET = "creative-archive";
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2GB — matches the bucket cap.
const SIGNED_URL_TTL = 60 * 60; // 1 hour

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

/** Promisified fflate zip of an in-memory file map. */
function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ctx = await authedContext(req);
  if (ctx instanceof Response) return ctx;
  const { supabase, userId } = ctx;

  try {
    // ── GET: poll a job ──────────────────────────────────────────────────────
    if (req.method === "GET") {
      const jobId = new URL(req.url).searchParams.get("job_id");
      if (!jobId) return json({ error: "job_id is required" }, 400);
      const { data: jobRow, error } = await supabase
        .from("media_archive_export_jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle();
      if (error) throw error;
      if (!jobRow) return json({ error: "Job not found" }, 404);
      if (!(await verifyAccountOwnership(supabase, userId, jobRow.account_id))) {
        return json({ error: "Access denied" }, 403);
      }
      let downloadUrl: string | null = null;
      if (jobRow.status === "ready" && jobRow.zip_path) {
        const { data: signed } = await supabase.storage
          .from(jobRow.zip_bucket ?? ZIP_BUCKET)
          .createSignedUrl(jobRow.zip_path, SIGNED_URL_TTL);
        downloadUrl = signed?.signedUrl ?? null;
      }
      return json({ job: jobRow, download_url: downloadUrl });
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    if ((body?.action ?? "export") !== "export") {
      return json({ error: `Unknown action '${body?.action}'` }, 400);
    }
    const accountId = body?.account_id;
    const adIds: string[] = Array.isArray(body?.ad_ids) ? body.ad_ids : [];
    if (!accountId) return json({ error: "account_id is required" }, 400);
    if (adIds.length === 0) return json({ error: "ad_ids is required (non-empty)" }, 400);
    if (!(await verifyAccountOwnership(supabase, userId, accountId))) {
      return json({ error: "Access denied" }, 403);
    }

    // Create the job row up front so the UI can poll immediately.
    const { data: job, error: jobErr } = await supabase
      .from("media_archive_export_jobs")
      .insert({ account_id: accountId, requested_by: userId, ad_ids: adIds, status: "building" })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(jobErr?.message || "Failed to create export job");

    try {
      // Fetch the durable archive rows for the selected creatives. Any missing
      // ones get archived on-the-fly by delegating to creative-library's archive
      // path (kept DRY — we call the RPC-backed archive by re-selecting after).
      let { data: archived } = await supabase
        .from("media_archive")
        .select("ad_id, thumb_storage_path, video_storage_path, thumb_bucket, video_bucket, byte_size")
        .eq("account_id", accountId)
        .in("ad_id", adIds);

      const haveArchived = new Set((archived ?? []).map((r: { ad_id: string }) => r.ad_id));
      const missing = adIds.filter((id) => !haveArchived.has(id));
      if (missing.length > 0) {
        // Archive the stragglers via the sibling function (reuses one code path).
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/creative-library`, {
          method: "POST",
          headers: {
            Authorization: req.headers.get("authorization")!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "archive", account_id: accountId, ad_ids: missing }),
        }).catch(() => {/* best-effort; export still proceeds with what's archived */});
        const reload = await supabase
          .from("media_archive")
          .select("ad_id, thumb_storage_path, video_storage_path, thumb_bucket, video_bucket, byte_size")
          .eq("account_id", accountId)
          .in("ad_id", adIds);
        archived = reload.data ?? archived;
      }

      const manifest = buildExportManifest(archived ?? []);
      if (manifest.entries.length === 0) {
        throw new Error("No archived media found for the selected creatives");
      }
      if (manifest.estimatedBytes > MAX_TOTAL_BYTES) {
        throw new Error(
          `Selection too large (${Math.round(manifest.estimatedBytes / 1e6)}MB) — exceeds ${MAX_TOTAL_BYTES / 1e9}GB export cap`,
        );
      }

      // Download each durable object and add it to the zip under a safe name.
      const files: Record<string, Uint8Array> = {};
      let fileCount = 0;
      const usedNames = new Set<string>();
      for (const e of manifest.entries) {
        const { data: blob, error: dlErr } = await supabase.storage.from(e.bucket).download(e.path);
        if (dlErr || !blob) continue; // skip a missing object rather than fail the whole zip
        const name = safeZipEntryName(e.adId, e.path, usedNames);
        files[name] = new Uint8Array(await blob.arrayBuffer());
        fileCount++;
      }
      if (fileCount === 0) throw new Error("None of the selected creatives had a downloadable media copy");

      const zipped = await zipAsync(files);
      const zipPath = `${accountId}/exports/${job.id}.zip`;
      const { error: upErr } = await supabase.storage
        .from(ZIP_BUCKET)
        .upload(zipPath, zipped, { contentType: "application/zip", upsert: true });
      if (upErr) throw new Error(`Failed to store zip: ${upErr.message}`);

      await supabase
        .from("media_archive_export_jobs")
        .update({
          status: "ready",
          zip_path: zipPath,
          zip_bucket: ZIP_BUCKET,
          file_count: fileCount,
          byte_size: zipped.byteLength,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      const { data: signed } = await supabase.storage
        .from(ZIP_BUCKET)
        .createSignedUrl(zipPath, SIGNED_URL_TTL);

      return json({
        ok: true,
        job_id: job.id,
        status: "ready",
        file_count: fileCount,
        byte_size: zipped.byteLength,
        download_url: signed?.signedUrl ?? null,
      });
    } catch (buildErr) {
      const msg = buildErr instanceof Error ? buildErr.message : "Export failed";
      await supabase
        .from("media_archive_export_jobs")
        .update({ status: "error", error_message: msg, completed_at: new Date().toISOString() })
        .eq("id", job.id);
      return json({ ok: false, job_id: job.id, error: msg }, 500);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
