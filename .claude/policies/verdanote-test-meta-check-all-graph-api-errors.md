---
id: verdanote-test-meta-check-all-graph-api-errors
title: In settings/test-meta, check accountsData.error and debugData.error — not just meData.error
scope: repo
trigger: writing or reviewing the settings/test-meta edge function, or any handler that chains multiple Meta Graph API calls (/me, /me/adaccounts, /debug_token, etc.)
enforcement: soft
public: false
version: 1
created: 2026-05-27
updated: 2026-05-27
source: session-learning
---

## Rule

ALWAYS: In the `settings/test-meta` edge function (and any handler that chains multiple Meta Graph API calls), check the `.error` field on EVERY response — `accountsData.error`, `debugData.error`, `meData.error` — not just the first one. If `/me/adaccounts` or `/debug_token` returns a rate-limit, auth, or scope error, the current pattern `accountsData.data || []` silently coerces a failed call into an empty array, and the function returns `{ connected: true, accounts: [] }`. Surface the error explicitly: return `{ connected: false, error: { code, message, source: 'adaccounts'|'debug_token'|'me' } }` so the UI can distinguish "no ad accounts on this user" from "Meta refused to tell us about ad accounts."

## Rationale

The bug pattern is structural, not a typo: `meData.error` short-circuits cleanly, but the subsequent `await fetch(...adaccounts)` and `await fetch(...debug_token)` results are consumed with `.data || []` and `.is_valid || false` — both fall through to a "connected, empty" success response when the response body is actually an `{ error: {...} }` envelope. From the user's perspective, the integration looks broken (no accounts) but the diagnostics page says "connected" — a classic silent-failure trap that costs hours of investigation in the wrong layer.

This bit Verdanote during the 2026-05-26 Meta rate-limit incident (see [[verdanote-meta-rate-limit-is-app-wide-not-per-user]]): error #4 was being returned by `/me/adaccounts` and `/debug_token` while `/me` still succeeded, so the UI rendered "connected · 0 accounts" instead of "rate-limited, retry later." Every Graph API response carries an `error` envelope; the function MUST inspect each one before falling back to defaults.

Related: HQ's `hq-never-swallow-errors` global policy already mandates this pattern at the language level. This policy makes the verdanote-specific shape concrete so it's actionable when editing `verdanoteanalytics/supabase/functions/api/settings.ts`.
