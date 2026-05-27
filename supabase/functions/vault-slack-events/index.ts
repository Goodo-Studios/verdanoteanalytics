// vault-slack-events — port from Creative Vault (US-011).
// Differences from source:
//   • workspace_id stripped — inspiration_items inserted with user_id only.
//   • slack_connections lookup returns user_id (no workspace owner indirection).
//
// Slack Events API endpoint. Handles url_verification challenges and
// message events in connected channels. Verifies the X-Slack-Signature HMAC
// against the per-connection signing_secret before acting on the payload.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectPlatform, VIDEO_URL_PATTERN } from "../_shared/platform.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string,
): Promise<boolean> {
  // Replay attack guard: reject requests older than 5 minutes.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const encoder = new TextEncoder();
  const sigBase = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(sigBase));
  const hex = "v0=" + Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === signature;
}

// Downloads a file from Slack (requires bot token) and uploads it to Supabase Storage.
// Returns the storage path on success, null on any failure.
async function importSlackFile(
  file: Record<string, unknown>,
  botToken: string,
  userId: string,
): Promise<string | null> {
  const downloadUrl = (file.url_private_download ?? file.url_private) as string | undefined;
  if (!downloadUrl) return null;

  const fileId = file.id as string;
  const name = (file.name as string | undefined) ?? "file";
  const mimetype = (file.mimetype as string | undefined) ?? "application/octet-stream";
  const ext = name.includes(".") ? name.split(".").pop() : "bin";

  const dlRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!dlRes.ok) {
    console.error(`Slack file download failed for ${fileId}: ${dlRes.status}`);
    return null;
  }

  const blob = await dlRes.blob();
  const storagePath = `slack/${userId}/${fileId}.${ext}`;

  const { error } = await db.storage
    .from("inspiration-media")
    .upload(storagePath, blob, { contentType: mimetype, upsert: true });

  if (error) {
    console.error(`Storage upload failed for Slack file ${fileId}:`, error);
    return null;
  }

  return storagePath;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const body = await req.text();
  const timestamp = req.headers.get("X-Slack-Request-Timestamp") ?? "";
  const slackSig = req.headers.get("X-Slack-Signature") ?? "";

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const teamId = payload.team_id as string | undefined;
  if (!teamId) {
    // url_verification challenge may arrive without team_id on initial setup —
    // accept the challenge so the app can be configured before any connection exists.
    if (payload.type === "url_verification") {
      return Response.json({ challenge: payload.challenge });
    }
    return new Response("Bad Request", { status: 400 });
  }

  // Look up the connection. With user-scoped slack_connections we may have
  // multiple users connected to the same Slack workspace; handle every match.
  const { data: conns } = await db
    .from("slack_connections")
    .select("id, user_id, signing_secret, bot_token")
    .eq("team_id", teamId);

  if (!conns || conns.length === 0) {
    return new Response("Unknown team", { status: 401 });
  }

  // Validate the signature against the first connection's signing_secret —
  // all rows for the same team_id share the same Slack app credentials, so
  // any one row's signing_secret verifies the payload.
  const primary = conns[0];
  const valid = await verifySlackSignature(primary.signing_secret, timestamp, body, slackSig);
  if (!valid) return new Response("Unauthorized", { status: 401 });

  // URL verification challenge.
  if (payload.type === "url_verification") {
    return Response.json({ challenge: payload.challenge });
  }

  // Event callback.
  if (payload.type === "event_callback") {
    const event = payload.event as Record<string, unknown>;
    const eventType = event?.type as string;

    if (eventType === "message") {
      // Fan out to every connected user in this workspace — each gets their own copy.
      for (const conn of conns) {
        await handleMessageEvent(event, conn.user_id, conn.bot_token);
      }
    }
  }

  return new Response("OK", { status: 200 });
});

async function handleMessageEvent(
  event: Record<string, unknown>,
  userId: string,
  botToken: string,
) {
  const files = event.files as Array<Record<string, unknown>> | undefined;
  const text = event.text as string | undefined;

  // Case 1: File(s) shared directly in Slack — download and store in Supabase Storage.
  if (files?.length) {
    for (const file of files) {
      const mimetype = (file.mimetype as string | undefined) ?? "";
      if (!mimetype.startsWith("video/") && !mimetype.startsWith("image/")) continue;

      const fileId = file.id as string;
      if (!fileId) continue;

      // Deduplicate per-user by Slack file ID stored in source_url.
      const slackFileRef = `slack:file:${fileId}`;
      const { data: existing } = await db
        .from("inspiration_items")
        .select("id")
        .eq("user_id", userId)
        .eq("source_url", slackFileRef)
        .maybeSingle();
      if (existing) continue;

      const storagePath = await importSlackFile(file, botToken, userId);
      if (!storagePath) continue;

      const isVideo = mimetype.startsWith("video/");
      const name = (file.name as string | undefined) ?? "Slack upload";

      const { data: item, error } = await db
        .from("inspiration_items")
        .insert({
          user_id: userId,
          saved_by: userId,
          source_url: slackFileRef,
          file_path: storagePath,
          platform: "upload",
          title: name,
          status: isVideo ? "transcribing" : "ready",
        })
        .select("id")
        .single();

      if (error || !item) continue;

      if (isVideo) {
        EdgeRuntime.waitUntil(
          fetch(`${SUPABASE_URL}/functions/v1/vault-transcribe`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ item_id: item.id }),
          }).catch(console.error),
        );
      }
    }
    return;
  }

  // Case 2: Social video URLs — kick off the Apify extraction pipeline.
  if (text) {
    const socialUrls = new Set([...text.matchAll(VIDEO_URL_PATTERN)].map((m) => m[0]));

    for (const url of socialUrls) {
      const { data: existing } = await db
        .from("inspiration_items")
        .select("id")
        .eq("user_id", userId)
        .eq("source_url", url)
        .maybeSingle();
      if (existing) continue;

      const { data: item, error } = await db
        .from("inspiration_items")
        .insert({
          user_id: userId,
          saved_by: userId,
          source_url: url,
          platform: detectPlatform(url),
          status: "extracting",
        })
        .select("id")
        .single();

      if (error || !item) continue;

      EdgeRuntime.waitUntil(
        fetch(`${SUPABASE_URL}/functions/v1/vault-extract`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ item_id: item.id }),
        }).catch(console.error),
      );
    }

    // Case 3: General hyperlinks — Figma, articles, product pages, etc. saved as reference links.
    const generalUrls = [...text.matchAll(/https?:\/\/[^\s><"'|]+/g)]
      .map((m) => m[0])
      .filter((u) => !socialUrls.has(u) && !u.includes("slack.com"));

    for (const url of generalUrls) {
      const { data: existing } = await db
        .from("inspiration_items")
        .select("id")
        .eq("user_id", userId)
        .eq("source_url", url)
        .maybeSingle();
      if (existing) continue;

      const platform = detectPlatform(url);
      await db.from("inspiration_items").insert({
        user_id: userId,
        saved_by: userId,
        source_url: url,
        platform: platform !== "unknown" ? platform : "link",
        status: "ready",
      });
    }
  }
}
