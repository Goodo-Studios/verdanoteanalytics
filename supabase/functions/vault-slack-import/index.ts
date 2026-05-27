// vault-slack-import — port from Creative Vault (US-011).
// Differences from source:
//   • workspace_id stripped — looks up slack_connections by (user_id, team_id?) and
//     inserts inspiration_items keyed on user_id only.
//   • Channel ID required in the request body — no per-workspace default.
//
// Backfills a Slack channel's history into the vault for the authenticated user.
// Walks conversations.history + conversations.replies, dedupes against
// inspiration_items, and routes URLs / files through the same handlers as
// vault-slack-events.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { detectPlatform, isVideoUrl, VIDEO_URL_PATTERN } from "../_shared/platform.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type SlackFile = {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private_download?: string;
  url_private?: string;
};

type SlackMessage = {
  text?: string;
  subtype?: string;
  ts?: string;
  reply_count?: number;
  attachments?: Array<{ original_url?: string }>;
  files?: SlackFile[];
};

type Db = ReturnType<typeof createClient>;

async function fetchChannelHistory(
  botToken: string,
  channelId: string,
  cursor?: string,
  oldest?: number,
): Promise<{ messages: SlackMessage[]; next_cursor?: string }> {
  const params = new URLSearchParams({
    channel: channelId,
    limit: "200",
    ...(cursor ? { cursor } : {}),
    ...(oldest ? { oldest: String(oldest) } : {}),
  });

  const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
    headers: { Authorization: `Bearer ${botToken}` },
  });

  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);

  return {
    messages: data.messages ?? [],
    next_cursor: data.response_metadata?.next_cursor || undefined,
  };
}

// conversations.replies returns the parent as index 0 followed by all replies.
// We skip index 0 here since the parent is already processed as a top-level message.
async function fetchThreadReplies(
  botToken: string,
  channelId: string,
  threadTs: string,
): Promise<SlackMessage[]> {
  const replies: SlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      channel: channelId,
      ts: threadTs,
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });

    const res = await fetch(`https://slack.com/api/conversations.replies?${params}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });

    const data = await res.json();
    if (!data.ok) {
      console.error(`conversations.replies error for ts=${threadTs}: ${data.error}`);
      break;
    }

    const msgs: SlackMessage[] = data.messages ?? [];
    // First page: slice off index 0 (parent); subsequent pages are all replies.
    const batch = replies.length === 0 ? msgs.slice(1) : msgs;
    replies.push(...batch);
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return replies;
}

// Slack API returns message text with HTML entities encoded (& → &amp;, < → &lt;, etc.).
// Decode before extracting URLs so query-param separators like &is_from_webapp=1 stay intact.
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractVideoUrls(msg: SlackMessage): Set<string> {
  const urls = new Set<string>();

  if (msg.text) {
    const decoded = decodeHtmlEntities(msg.text);
    for (const match of decoded.matchAll(VIDEO_URL_PATTERN)) {
      urls.add(match[0]);
    }
  }

  for (const att of msg.attachments ?? []) {
    if (att.original_url && isVideoUrl(att.original_url)) {
      urls.add(att.original_url);
    }
  }

  return urls;
}

async function processMessage(
  msg: SlackMessage,
  db: Db,
  userId: string,
  botToken: string,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  // Skip bot/system messages.
  if (msg.subtype) return { imported, skipped };

  // --- Direct file attachments (photos, videos) ---
  for (const file of msg.files ?? []) {
    const mimetype = file.mimetype ?? "";
    if (!mimetype.startsWith("video/") && !mimetype.startsWith("image/")) continue;

    const fileId = file.id;
    if (!fileId) continue;

    const slackFileRef = `slack:file:${fileId}`;
    const { data: existing } = await db
      .from("inspiration_items")
      .select("id")
      .eq("user_id", userId)
      .eq("source_url", slackFileRef)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    const downloadUrl = file.url_private_download ?? file.url_private;
    if (!downloadUrl) continue;

    const name = file.name ?? "file";
    const ext = name.includes(".") ? name.split(".").pop() : "bin";

    const dlRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!dlRes.ok) {
      console.error(`Slack file download failed for ${fileId}: ${dlRes.status}`);
      continue;
    }

    const blob = await dlRes.blob();
    const storagePath = `slack/${userId}/${fileId}.${ext}`;

    const { error: storageErr } = await db.storage
      .from("inspiration-media")
      .upload(storagePath, blob, { contentType: mimetype, upsert: true });

    if (storageErr) {
      console.error(`Storage upload failed for ${fileId}:`, storageErr);
      continue;
    }

    const isVideo = mimetype.startsWith("video/");

    const { data: item, error: insertErr } = await db
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

    if (insertErr || !item) continue;

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

    imported++;
  }

  // --- Social video URLs ---
  const videoUrls = extractVideoUrls(msg);
  for (const url of videoUrls) {
    const { data: existing } = await db
      .from("inspiration_items")
      .select("id, status")
      .eq("user_id", userId)
      .eq("source_url", url)
      .maybeSingle();

    if (existing) {
      // Re-trigger extraction for items that previously failed or are stuck pending.
      // Lets a re-run of the import recover from transient Apify errors.
      if (existing.status === "error" || existing.status === "pending") {
        await fetch(`${SUPABASE_URL}/functions/v1/vault-extract`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ item_id: existing.id }),
        }).catch(console.error);
        imported++;
      } else {
        skipped++;
      }
      continue;
    }

    const { data: item, error: insertErr } = await db
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

    if (insertErr || !item) continue;

    // Await (not waitUntil) so extractions are serialized — prevents hitting
    // Apify's concurrent-run memory limit when importing a large channel.
    await fetch(`${SUPABASE_URL}/functions/v1/vault-extract`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ item_id: item.id }),
    }).catch(console.error);

    imported++;
  }

  // --- General hyperlinks (articles, Figma, product pages, etc.) ---
  const allTextUrls = [...decodeHtmlEntities(msg.text ?? "").matchAll(/https?:\/\/[^\s><"'|]+/g)]
    .map((m) => m[0]);

  for (const url of allTextUrls) {
    if (videoUrls.has(url)) continue;
    if (url.includes("slack.com")) continue;

    const { data: existing } = await db
      .from("inspiration_items")
      .select("id")
      .eq("user_id", userId)
      .eq("source_url", url)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    const platform = detectPlatform(url);
    const { error: insertErr } = await db
      .from("inspiration_items")
      .insert({
        user_id: userId,
        saved_by: userId,
        source_url: url,
        platform: platform !== "unknown" ? platform : "link",
        status: "ready",
      });

    if (!insertErr) imported++;
  }

  // --- Unfurled attachment links that aren't social videos ---
  for (const att of msg.attachments ?? []) {
    const url = att.original_url;
    if (!url || isVideoUrl(url)) continue;
    if (url.includes("slack.com")) continue;

    const { data: existing } = await db
      .from("inspiration_items")
      .select("id")
      .eq("user_id", userId)
      .eq("source_url", url)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    const platform = detectPlatform(url);
    const { error: insertErr } = await db
      .from("inspiration_items")
      .insert({
        user_id: userId,
        saved_by: userId,
        source_url: url,
        platform: platform !== "unknown" ? platform : "link",
        status: "ready",
      });

    if (!insertErr) imported++;
  }

  return { imported, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const body = await req.json() as { channel_id: string; oldest?: number };
  const { channel_id, oldest } = body;
  if (!channel_id) return json({ error: "channel_id required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Resolve the caller's most-recent Slack connection. Pick the newest row so
  // re-connecting refreshes the import target.
  const { data: conn } = await db
    .from("slack_connections")
    .select("bot_token")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conn) return json({ error: "No Slack connection found. Connect Slack first." }, 400);

  let imported = 0;
  let skipped = 0;
  let cursor: string | undefined;

  try {
    do {
      const { messages, next_cursor } = await fetchChannelHistory(conn.bot_token, channel_id, cursor, oldest);
      cursor = next_cursor;

      for (const msg of messages) {
        const counts = await processMessage(msg, db, user.id, conn.bot_token);
        imported += counts.imported;
        skipped += counts.skipped;

        // Fetch and process all replies in this thread.
        if (msg.reply_count && msg.reply_count > 0 && msg.ts) {
          const replies = await fetchThreadReplies(conn.bot_token, channel_id, msg.ts);
          for (const reply of replies) {
            const replyCounts = await processMessage(reply, db, user.id, conn.bot_token);
            imported += replyCounts.imported;
            skipped += replyCounts.skipped;
          }
        }
      }
    } while (cursor);
  } catch (err) {
    return json({ error: String(err), imported, skipped }, 500);
  }

  return json({ ok: true, imported, skipped });
});
