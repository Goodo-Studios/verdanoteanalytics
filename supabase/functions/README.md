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
supabase secrets set ANTHROPIC_API_KEY=<key>
supabase secrets set APP_URL=https://<your-domain>
supabase secrets set RESEND_API_KEY=<key>         # for digest emails
supabase secrets set META_ACCESS_TOKEN=<token>    # for Meta/Facebook sync
```

---

## Function Reference

### Data Sync

| Function | Trigger | Purpose |
|---|---|---|
| `sync` | Manual / scheduled | Pulls creative performance data from Meta Marketing API and upserts into `creatives` and `creative_daily_metrics` |
| `scheduled-sync` | Cron | Wrapper around `sync` that runs automatically on configured intervals |
| `enrich-thumbnails` | Post-sync | Downloads thumbnail images from Meta CDN and uploads them to Supabase Storage |
| `refresh-thumbnails` | Manual | Re-fetches thumbnails for creatives that have stale or missing media |
| `fetch-thumbnail` | On-demand | Fetches a single creative's thumbnail by ad ID |
| `backfill-post-urls` | One-time | Backfills `ad_post_url` for existing creatives that were synced before the field was added |

### Creatives API

| Function | Method | Purpose |
|---|---|---|
| `creatives` | GET / PUT | Main creatives endpoint. GET supports filtering, pagination, and date-range aggregation. PUT updates tags/notes on a single creative. |
| `accounts` | GET / POST / PUT / DELETE | CRUD for `ad_accounts`. Also handles name-mapping uploads. |
| `api` | GET | General-purpose data query endpoint used by the frontend for various reads. |
| `api-auth` | GET | Auth-aware API proxy that validates the calling user's session and role before forwarding to `api`. |

### AI Features

| Function | Trigger | Purpose |
|---|---|---|
| `ai-chat` | User action | Conversational AI chat about creative performance. Accepts messages array + account context; returns streaming or batch Claude response. |
| `client-insights` | User action | Generates 3 plain-English performance insights for a client dashboard using Claude. |
| `reports` | User action | Builds a full performance report for an account. Calls Claude for AI-generated insights and highlights, formats data, and returns HTML/JSON. |
| `analyze-creative` | User action | Uses Claude to analyze a single creative's ad copy, visual structure, and performance signal. |

**AI model:** All AI calls use `claude-sonnet-4-6` via the Anthropic Messages API (`https://api.anthropic.com/v1/messages`). Requires `ANTHROPIC_API_KEY` secret.

### Reports & Digests

| Function | Trigger | Purpose |
|---|---|---|
| `scheduled-reports` | Cron | Sends weekly performance reports to accounts with `report_schedule` set. Calls `reports` internally. |
| `send-digest` | User action / Cron | Sends a weekly performance summary email via Resend to users with digest enabled. |
| `portfolio` | Public GET | Returns public-facing portfolio data for an account's `portfolio_slug`. No auth required. |

### Briefs & Coda

| Function | Trigger | Purpose |
|---|---|---|
| `create-coda-brief` | User action | Creates a creative brief row in a Coda doc via the Coda API. |
| `sync-coda-tasks` | User action | Syncs brief tasks from Coda back into Verdanote's `briefs` table. |

### Ad Library & Research

| Function | Trigger | Purpose |
|---|---|---|
| `competitor-ads` | User action | Fetches competitor ads from the Meta Ad Library for a given search query. |
| `scrape-ad` | User action | Scrapes ad landing page metadata (title, description, OG image) for a given URL. |
| `quick-save` | User action | Saves an ad from the Ad Library bookmarklet to the user's saved ads. |
| `transcribe-ad` | User action | Transcribes audio/video from an ad using a speech-to-text model. |

### User & Account Management

| Function | Trigger | Purpose |
|---|---|---|
| `user-management` | Admin action | Creates/updates user accounts, assigns roles (`builder`, `employee`, `client`), and links users to accounts. |
| `settings` | User action | Reads and writes user preferences (digest settings, notification config). |
| `webhooks-dispatch` | Webhook | Receives inbound webhooks (e.g. Meta, Coda) and routes them to the appropriate handler. |

### Maintenance & Health

| Function | Trigger | Purpose |
|---|---|---|
| `system-health-check` | Cron / Manual | Runs sanity checks on data freshness, sync status, and edge function reachability. Returns a JSON health report. |
| `spend-diagnostic` | Manual | Diagnoses discrepancies between Meta-reported spend and spend stored in `creative_daily_metrics`. |
| `cleanup-stuck-syncs` | Cron | Clears sync locks that have been held for over 30 minutes (stuck syncs). |
| `cleanup-stuck-media` | Cron | Removes orphaned media upload jobs that never completed. |
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

---

## Local Development

```bash
# Serve all functions locally (requires supabase CLI)
supabase functions serve

# Serve a single function with env vars
supabase functions serve ai-chat --env-file .env.local
```

Functions access `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` automatically when served via the CLI. Other secrets (Anthropic, Resend, Meta) must be in `.env.local`.
