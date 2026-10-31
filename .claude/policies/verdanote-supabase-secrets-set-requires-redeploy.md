---
id: verdanote-supabase-secrets-set-requires-redeploy
title: supabase secrets set requires function redeploy to take effect
scope: repo
trigger: whenever running `supabase secrets set` for a Verdanote edge function
enforcement: hard
public: false
version: 1
created: 2026-06-08
updated: 2026-06-08
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS run `supabase functions deploy {fn}` immediately after `supabase secrets set`. Secrets are NOT automatically picked up by warm/running containers — a redeploy is required to flush the container cache and inject the updated secret values.

## Rationale

Supabase edge functions run in warm containers that cache their environment at startup. Setting a secret via `supabase secrets set` updates the stored value but does not restart running containers. Without a forced redeploy, the function continues reading the stale (or absent) secret value, producing silent auth failures or "undefined" token errors that look like misconfiguration.
