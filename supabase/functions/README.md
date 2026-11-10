# Supabase Edge Functions

All functions run on Deno. Shared utilities live in `_shared/`.

## Deploying

```bash
# Deploy a single function
supabase functions deploy <function-name>

# Deploy all functions
supabase functions deploy
```

## Required Secrets

Set these before deploying:

```bash
supabase secrets set ANTHROPIC_API_KEY=<key>      # client-insights, reports
supabase secrets set OPENROUTER_API_KEY=<key>     # ai-chat
supabase secrets set APP_URL=https://<your-domain>
supabase secrets set RESEND_API_KEY=<key>         # for digest emails
supabase secrets set META_ACCESS_TOKEN=<token>    # for Meta/Facebook sync
```

### Security-critical secrets (fail closed)

These gate authentication for functions that are `verify_jwt = false`. The
functions **reject all requests when the secret is unset**, so they must be
configured in every deployed environment or the corresponding feature stops
working:

```bash
# Signs/verifies the Apify callback URL for vault-extract → vault-extract-webhook.
# Generate once: openssl rand -hex 32
supabase secrets set VAULT_WEBHOOK_SECRET=<random-32-byte-hex>

# Shared secret required by the review-ingest and brief-write persisters.
supabase secrets set INGEST_SECRET=<random-secret>       # ingest-reviews
supabase secrets set WRITE_BRIEF_SECRET=<random-secret>  # write-brief
```

---

## Function Reference

### Data Sync

| Function | Trigger | Purpose |
|---|---|---|
| `sync` | Manual / scheduled | Pulls creative performance data from Meta Marketing API and upserts into `creatives` and `creative_daily_metrics`. Uses a rolling incremental window (`max(28d, days-since-last-sync + attribution buffer)`) once an account is backfilled instead of re-pulling the full window, rolls up the per-ad snapshot locally (`rollup_creatives_from_daily`), and enqueues media caching into `media_cache_queue` for newly-inserted ads only. |
| `scheduled-sync` | Cron | Wrapper around `sync` that runs automatically on configured intervals |
| `backfill-daily-history` | One-time / Cron drain | Chunked, rate-limit-aware backward walk that fills `creative_daily_metrics` back to `RETENTION_DAYS` (365) so an account reaches a full year of daily-grain history. Idempotent/resumable via `ad_accounts.daily_backfilled_since`; self-limits to a few accounts per run and reuses the `sync` Meta rate-limit pause/resume contract. Drained by a pg_cron job. |
| `enrich-thumbnails` | Post-sync | Downloads thumbnail images from Meta CDN and uploads them to Supabase Storage. Media caching is now event-driven via `media_cache_queue` (see `drain-media-queue`) — blind whole-account fanout has been retired. |
| `drain-media-queue` | Cron (every 2 min) / self-chaining | Sole media-caching worker. Claims `media_cache_queue` rows (`FOR UPDATE SKIP LOCKED` via `claim_media_cache_queue`), streams the thumbnail/video into Supabase Storage (200MB cap; oversized → keep CDN URL), dedupes per account against `media_assets` (SHA-256 content key), short-circuits already-cached storage URLs, and self-chains until the queue is drained. Replaces the old OOM/stuck media churn. |
| `refresh-thumbnails` | Manual | Re-fetches thumbnails for creatives that have stale or missing media |
| `fetch-thumbnail` | On-demand | Fetches a single creative's thumbnail by ad ID |
| `cache-creative-image` | On-demand (modal open) | Downloads a single creative's thumbnail/video from Meta and caches it in Supabase Storage. Invoked by the `CreativeDetailModal` when a creative has a `null` thumbnail, so the next view shows it without re-hitting Meta. Uses `_shared/media-discovery.ts` for URL resolution. |
| `backfill-post-urls` | One-time | Backfills `ad_post_url` for existing creatives that were synced before the field was added |

### Creatives API

| Function | Method | Purpose |
|---|---|---|
| `creatives` | GET / PUT | Main creatives endpoint. GET supports filtering, pagination, and date-range aggregation. PUT updates tags/notes on a single creative. |
| `accounts` | GET / POST / PUT / DELETE | CRUD for `ad_accounts`. Also handles name-mapping uploads. |
| `api` | GET | General-purpose data query endpoint. Authenticates with provisioned API keys (`api_keys` table), NOT user session JWTs — for external/programmatic callers only. |
| `leaderboard` | GET | Session-authed sibling of `api` /library. Powers the Analytics → Leaderboard tab. `verify_jwt=false`; manually verifies the session JWT via `supabase.auth.getUser`, enforces `verifyAccountOwnership`, then calls the SECURITY DEFINER hook/angle RPCs (`rpc_hook_angle_leaderboard` / `rpc_hook_angle_coverage`) with the service-role client. In-app UI must use this, never `api`. |

### AI Features

| Function | Trigger | Purpose |
|---|---|---|
| `ai-chat` | User action | Conversational AI chat about creative performance. Accepts messages array + account context; returns streaming or batch Claude response. |
| `client-insights` | User action | Generates 3 plain-English performance insights for a client dashboard using Claude. |
| `reports` | User action | Builds a full performance report for an account. Calls Claude for AI-generated insights and highlights, formats data, and returns HTML/JSON. |

**AI providers (mixed):**

| Function | Provider | Default model | Required secret | Override env |
|---|---|---|---|---|
| `ai-chat` | OpenRouter (`https://openrouter.ai/api/v1/chat/completions`) | `anthropic/claude-3.5-sonnet` | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` |
| `client-insights` | Anthropic Messages API (`https://api.anthropic.com/v1/messages`) | `claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` |
| `reports` | Anthropic Messages API (`https://api.anthropic.com/v1/messages`) | `claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` |
| `vault-analyze` | Anthropic Messages API | Haiku for 4 of 5 calls (transcript clean, brand metadata, script analysis, visual analysis); `claude-sonnet-4-6` for framework extraction (vision + complex JSON schema) | `ANTHROPIC_API_KEY` | — |

### Reports & Digests

| Function | Trigger | Purpose |
|---|---|---|
| `scheduled-reports` | Cron | Sends weekly performance reports to accounts with `report_schedule` set. Calls `reports` internally. |
| `send-digest` | User action / Cron | Sends a weekly performance summary email via Resend to users with digest enabled. |
| `portfolio` | Public GET | Returns public-facing portfolio data for an account's `portfolio_slug`. No auth required. |

### Content pipeline

| Function | Trigger | Purpose |
|---|---|---|
| `sync-clickup-tasks` | Cron (every 4h) | Reads asset tasks from every client folder in ClickUp (GET only) into the `pipeline_tasks` table, mapping each ClickUp status to one of five client-facing columns (Preparing Content / Production / Editing / Client Review / Ready to Launch) and storing client-safe fields only. Each folder resolves to a client (`source_mappings` folder row first, then name rules against clients and their ad accounts); rows carry `client_slug`, and `account_id` when the client has exactly one ad account. Powers the `/pipeline` board for staff and clients. Rules live in `_shared/clickup-pipeline.ts`. Needs the `CLICKUP_API_TOKEN` secret. |
| `push-brief-to-clickup` | Staff ("Push to ClickUp" in the brief editor, "Create brief in ClickUp" in the creative detail modal) | Builder or employee login only. `list` returns the client's empty asset tasks in `assigned` or `brief creation`; `push` writes the brief (plain markdown, no HTML tags) into a picked empty asset task, or creates `{Month} Asset {next N} - {title}`, and sets status `brief creation`. Refuses a task that has a description, is in another list or is not an asset task. Writes nothing else. Folder resolved like `sync-clickup-tasks`. Rules in `_shared/clickup-brief.ts`. Answers 503 without `CLICKUP_API_TOKEN`. |
| `clickup-folders` | Staff (client hub Setup tab, "Find folders in ClickUp") | Builder login only. Read-only: one GET for the client space, returns folder and list ids and names. Answers 503 without `CLICKUP_API_TOKEN` and the Setup tab then asks for a pasted folder link or id. |
| `invite-user` | Staff (Team and settings, "Invite by email") | Builder login only. `invite` creates a login with Supabase Auth's own invite (no typed password, the standard invite email; no secret of ours), gives it its role and, for a client login, its client, and logs who invited whom in `user_invites`. `resend` waits a minute between sends; `revoke` removes a login that never accepted. Plain answers for an email that already has a login or is already invited. The create-with-password path stays in `user-management`. |

### Creative Vault

The Vault is a creative-inspiration library: paste a TikTok, Instagram, YouTube, or Facebook Ad Library URL and the pipeline downloads the video, transcribes it, runs framework analysis (hook, copy, visuals), and surfaces it in the Library UI. Functions chain together via webhook callbacks — see `_shared/actor-configs.ts` for the platform-specific Apify wiring.

| Function | Trigger | Purpose |
|---|---|---|
| `vault-save` | User action | Entry point. Detects platform from the URL, kicks off `vault-extract`, and inserts an `inspiration_items` row with status `extracting`. For `facebook_ad` URLs, also extracts `ad_archive_id` from `?id=` query param. |
| `vault-extract` | Internal | Submits the URL to the configured Apify actor for the detected platform and returns the run ID. |
| `vault-extract-webhook` | Apify webhook | Receives Apify run completion, downloads the video to the `inspiration-media` storage bucket, and advances the item to `transcribing`. Detects actor-level error responses (not just HTTP-level failures). |
| `vault-transcribe` | Internal | Calls a speech-to-text model on the downloaded video and writes the cleaned transcript. Short-circuits to `analyzing` for image-only ads. |
| `vault-analyze` | Internal | Five-call Anthropic pipeline that produces transcript cleanup, brand metadata, framework extraction (PAS / AIDA / etc.), script analysis, and visual analysis. Uses Haiku for 4 of 5 calls; Sonnet only for framework extraction. |
| `vault-frame-analyze` | Internal | Per-frame visual analysis pass using vision-capable Claude on extracted video frames. |
| `vault-embed` | Internal | Generates vector embeddings for the cleaned transcript so items are searchable via `vault-search`. |
| `vault-search` | User action | Semantic search across the user's saved inspiration items. |
| `vault-status` | Polling | Returns the current pipeline status for a single item (`extracting`, `transcribing`, `analyzing`, `ready`, `error`). |
| `vault-ads` | User action | Fetches saved/inspiration ads for the Library UI with filtering and pagination. |
| `vault-slack-connect` | OAuth | Connects a Slack workspace so shared ad links are auto-imported into the user's vault. |
| `vault-slack-events` | Slack events | Inbound webhook receiver for Slack `message` events containing ad URLs. |
| `vault-slack-import` | Internal | Worker that processes Slack-shared URLs through the standard `vault-save` pipeline. |
| `vault-share-item` | User action / Public | Public, revocable share links for a single vault item. `verify_jwt=false`; auth enforced per-action: `mint`/`revoke` (any authenticated user — the library is global) manage the item's `share_token`; `resolve` (anonymous, no login) maps a token to a public column allowlist (omits `user_id`, `saved_by`, `performance_snapshot`, and other internal fields) and service-role-signs the private `inspiration-media` URL. Powers the `/vault/share/:token` page. |

### Ad Library & Research

| Function | Trigger | Purpose |
|---|---|---|
| `competitor-ads` | User action | Fetches competitor ads from the Meta Ad Library for a given search query. |
| `scrape-ad` | User action | Scrapes ad landing page metadata (title, description, OG image) for a given URL. |
| `quick-save` | User action | Saves an ad from the Ad Library bookmarklet to the user's saved ads. |
| `transcribe-ad` | User action | Transcribes audio/video from an ad using a speech-to-text model. |
| `resolve-destinations` | Internal / service role | Classifies unique landing destinations and optionally refines product names from bounded page-title fetches. External URLs and every redirect are checked with `_shared/public-url.ts` to reject private, loopback, link-local, and other non-public network targets. |

### User & Account Management

| Function | Trigger | Purpose |
|---|---|---|
| `user-management` | Admin action | Creates/updates user accounts, assigns roles (`builder`, `employee`, `client`), and links users to accounts. |
| `settings` | User action | Reads and writes user preferences (digest settings, notification config). |
| `webhooks-dispatch` | Webhook | Receives inbound webhooks (e.g. Meta) and routes them to the appropriate handler. |

### Maintenance & Health

| Function | Trigger | Purpose |
|---|---|---|
| `system-health-check` | Cron / Manual | Runs sanity checks on data freshness, sync status, and edge function reachability. Returns a JSON health report. |
| `meeting-recaps` | Staff (Meeting recaps page, `/meeting-recaps`) | Builder or employee login only. Reads one named Fireflies transcript, sends only clean excerpts to the model (`ANTHROPIC_RECAP_MODEL`, default `claude-sonnet-5-5`), keeps items whose citations are exact quotes and records the outcome through `record_meeting_recap`. Writes nothing outside Verdanote. Answers 503 without `FIREFLIES_API_KEY` or `ANTHROPIC_API_KEY`. Rules in `_shared/meeting-recaps.ts`. |
| `agent-evaluations` | Staff (Agent evaluations page, `/agent-evaluations`) | Builder or employee login only. Sends each staff-written sample of a registered agent (today `meeting-recaps`) to the model with that agent's instructions (`ANTHROPIC_EVAL_MODEL`, default `claude-sonnet-5-5`), one call per sample, and records the run through `record_agent_evaluation_run`, which keeps a decision only when its quote is an exact part of the sample and computes the status. A provider failure part way records a failed run with no results. Writes nothing outside Verdanote. Answers 503 without `ANTHROPIC_API_KEY`. Rules in `_shared/agent-evaluations.ts`. |
| `integration-health` | Staff (Integration health page, `/integration-health`) | Builder or employee login only. Read-only status of the ClickUp, Fireflies, Slack and Verdanote data connectors, the `durable_jobs` queue and the latest owner alert jobs (port of the Goodo OS Integration health page). Says whether each secret is set, never its value. Calls no outside service. Rules in `_shared/integration-health.ts`. |
| `spend-diagnostic` | Manual | Diagnoses discrepancies between Meta-reported spend and spend stored in `creative_daily_metrics`. |
| `cleanup-stuck-syncs` | Cron | Clears sync locks that have been held for over 30 minutes (stuck syncs). |
| `cleanup-stuck-media` | Manual (repair only) | Clears orphaned/stuck media jobs. No longer on a cron — the `drain-media-queue` worker owns the media pipeline; this is kept for manual repair/force use only. |
| `clear-media-cache` | Manual | Clears the media URL cache for an account, forcing re-fetch on next load. |

### Internal / Misc

| Function | Purpose |
|---|---|
| `sadie-read` | Internal reader function used by the newsletter pipeline to pull creative data for content generation. |

---

## Shared Utilities (`_shared/`)

| File | Purpose |
|---|---|
| `cors.ts` | Standard CORS headers returned by all functions |
| `api-auth.ts` | Shared auth helpers — validates the calling user's session/role and exposes a `hashKey` SHA-256 utility used by API-style endpoints |
| `media-discovery.ts` | Meta Graph API v22.0 media URL resolver. Provides `discoverImageUrl` / `discoverVideoUrl` / `fetchWithTimeout` and the `NO_THUMB_SENTINEL` / `NO_VIDEO_SENTINEL` markers used to short-circuit known-empty creatives. Also owns `assetStoragePath` (account-scoped, hash-keyed storage path for `media_assets` dedupe) and `isStorageUrl` (canonical guard that short-circuits re-discovery/re-download of already-cached media). Consumed by `refresh-thumbnails`, `enrich-thumbnails`, `fetch-thumbnail`, `cache-creative-image`, and `drain-media-queue`. |
| `public-url.ts` | SSRF guard for outbound HTTP fetches. Rejects unsafe URL shapes and non-public IPv4/IPv6 targets after DNS resolution; callers must validate the initial destination and each redirect. |
| `retention-config.ts` | Single source of truth for long-horizon retention windows: `RETENTION_DAYS` (365 — daily-history target), `RECENT_WINDOW_DAYS` (28 — incremental re-pull window), `TRIM_BUFFER_DAYS` (400 — nightly-trim floor, never deletes within the 365d window). Consumed by `sync`, `backfill-daily-history`, and the retention-trim cron. |
| `platform.ts` | URL → platform detection for the Vault. Owns `PLATFORM_MAP`, `VIDEO_PLATFORMS`, `VIDEO_URL_PATTERN`, and `detectPlatform(url)`. Add a new platform here first before wiring it elsewhere. |
| `actor-configs.ts` | Apify actor registry for the Vault. `ACTOR_CONFIGS[platform]` returns `{ actorId, buildInput, extractVideoUrl, extractThumbnailUrl, extractCreatorHandle, extractTitle, apiRunOptions }`. New ingestion platforms drop in here without touching `vault-extract` / `vault-extract-webhook`. |

---

## Local Development

```bash
# Serve all functions locally (requires supabase CLI)
supabase functions serve

# Serve a single function with env vars
supabase functions serve ai-chat --env-file .env.local
```

Functions access `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` automatically when served via the CLI. Other secrets (Anthropic, Resend, Meta) must be in `.env.local`.
