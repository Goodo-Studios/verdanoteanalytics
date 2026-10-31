---
id: verdanote-meta-rate-limit-is-app-wide-not-per-user
title: Meta error #4 is app-wide rate-limit, not per-user — keep debug_token out of hot paths
scope: repo
trigger: designing Meta sync workers, planning API call volume, debugging "connection broken" UX, or adding new `/debug_token` and `/me/adaccounts` callsites
when: meta && (throttle || quota || rate || debug_token || x-app-usage)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 2
created: 2026-05-27
updated: 2026-07-21
source: session-learning
---

## Rule

ALWAYS: Treat Meta Graph API error `#4 (Application request limit reached)` as an **app-wide** quota — not a per-user one. When sync workers are pulling large datasets (5000+ creatives across 10+ accounts), they can exhaust the hourly application quota and block even trivial admin calls (`/debug_token`, `/me`) for every other user of the app. Two mitigations are mandatory before adding any new caller:

1. **Keep token-diagnostic calls (`/debug_token`, `/me`, `/me/adaccounts` health checks) out of hot paths** — never call them on every Add-account click, never call them on every page load. Only call from explicit user actions ("Test connection") or scheduled background jobs.
2. **Extend client-side cache TTL beyond 60 seconds** for diagnostic results. A 60s TTL means every fresh page load hits `/debug_token`; bump to 5–15 minutes for non-mutating diagnostics, and only bust the cache after an explicit user action (reconnect, save token, etc.).

ALWAYS treat a Meta Graph #4 (app-level rate limit) as needing BOTH fixes: reduce per-invocation call volume (cache expensive lookups like `/me/accounts` page-token maps and `/advideos` video maps across the self-chain via a short-TTL table) AND cap the rate (read the `x-app-usage` header and pause work above ~80% — a circuit breaker). A drain pause alone does NOT clear a deep overage quickly; `x-app-usage` 1000%+ needs ~1h rolling-window decay, and a flat-out drain re-saturates instantly without the rate cap.

## Rationale

Verdanote's 2026-05-26 incident: ad-account import was showing "connection broken" across multiple users simultaneously. Initial assumption was per-user token expiry, but `/debug_token` itself was returning `{ error: { code: 4, message: 'Application request limit reached' } }` — the sync workers had burned the app's hourly quota pulling creatives, leaving zero headroom for admin calls. The fix wasn't "refresh the user's token"; it was "stop calling `/debug_token` on every Add-account interaction and let the quota recover."

Architectural implications:
- The Graph API quota is one number per Meta app, not per user. Every callsite consumes from the same bucket. A sync worker that's well-behaved per-account can still starve the entire app if it fans out across many accounts in parallel.
- Symptoms look identical to per-user auth failure: 401-ish behavior, "broken" badges, retries that don't help. The differentiator is correlation across users — if multiple unrelated users break at the same minute, suspect app-wide quota first.
- Cache TTLs are part of the quota budget. Every "verify before showing" pattern in the UI is an unbudgeted call multiplied by user count. Default skeptically — show the cached state, refresh on user action, not on render.

Tightly coupled with [[verdanote-test-meta-check-all-graph-api-errors]]: the error #4 envelope must be surfaced from the test-meta handler, otherwise quota exhaustion will keep masquerading as "connected · 0 accounts" forever.
