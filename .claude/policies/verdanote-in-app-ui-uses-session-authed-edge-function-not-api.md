---
id: verdanote-in-app-ui-uses-session-authed-edge-function-not-api
title: In-app UI must use a first-party session-authed edge function, never the API-key-gated `api` function
scope: repo
trigger: Building or wiring an in-app UI feature that needs server-side Verdanote data, when tempted to call the external `api` edge function with the user's session.
enforcement: soft
public: false
version: 2
created: 2026-05-30
updated: 2026-06-02
source: session-learning
---

## Rule

In Verdanote, the external `api` edge function is gated by provisioned API keys (`api_keys` table) and rejects user session JWTs with `Invalid API key`. In-app UI must call a first-party session-authed edge function (`verify_jwt=false` + manual `supabase.auth.getUser` + `verifyAccountOwnership` + service-role RPC), never the `api` function.

Corollary for the creatives surface: the frontend fetches creatives through the first-party **`creatives`** edge function via `apiFetch("creatives", …)` → `/functions/v1/creatives` (both `useCreatives` and `useAllCreatives`), which builds every row select from the **`CREATIVE_COLS`** constant in `supabase/functions/creatives/index.ts`. The `api` function's `/creatives` route is a SEPARATE external/read-MCP surface. So when a creative field renders empty/undefined in the UI (e.g. `play_curve` / `retention_p*` missing despite being populated in the DB), fix the projection in **`CREATIVE_COLS`** (and redeploy `creatives`) — patching the `api` function does nothing for the UI. Always verify a data fix through the actual consumer path (`apiFetch` → `creatives`), not the `api` endpoint that the app never calls.

## Rationale

The `api` edge function authenticates by API key against the `api_keys` table, so a logged-in user's session JWT fails with `Invalid API key`. It exists for external/programmatic callers, not the app's own UI. In-app surfaces must instead hit a first-party edge function configured with `verify_jwt=false`, which manually resolves the user via `supabase.auth.getUser`, enforces tenancy with `verifyAccountOwnership`, and then reads via a service-role RPC. Pointing the UI at the `api` function produces hard-to-diagnose 401/`Invalid API key` failures that look like an auth bug rather than a wrong-endpoint choice.

The same `api`-vs-first-party confusion also surfaces as a *missing-data* bug, not just an auth failure: in a real incident the retention curve rendered an empty state because the api `/creatives` projection lacked `play_curve`/`retention_p*`. Patching `api/index.ts` looked correct and even verified live against the `api` endpoint — but the UI never calls `api`; it calls the `creatives` function, whose `CREATIVE_COLS` still omitted the columns. Two debug rounds were lost fixing the wrong function. Trace the consumer (`apiFetch(functionName)` → `/functions/v1/{functionName}`) before editing any edge-function select, and verify the fix through that same path.
