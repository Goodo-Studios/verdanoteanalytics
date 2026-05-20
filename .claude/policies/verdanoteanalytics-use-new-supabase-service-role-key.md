---
id: verdanoteanalytics-use-new-supabase-service-role-key
title: Use VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY for queue state REST checks
scope: repo
trigger: writing scripts or curl commands that hit the Verdanote Supabase REST API (PostgREST) to inspect queue/sync state
enforcement: hard
public: false
version: 1
created: 2026-05-19
updated: 2026-05-19
source: session-learning
applies_to: [supabase]
---

## Rule

When inspecting Verdanote queue state via the Supabase REST API, ALWAYS use the env var `VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY` as the `apikey` (and `Authorization: Bearer ...`) header.

Do NOT use `VERDANOTE_SUPABASE_SERVICE_ROLE_KEY` — that secret does not exist in the HQ secrets store and any reference to it will fail credential resolution silently or return 401 from PostgREST.

The new `sb_secret_`-prefixed key (Supabase's rotated service-role format) authenticates correctly against the PostgREST REST endpoint at `https://<project>.supabase.co/rest/v1/...`.

## Rationale

Supabase rotated Verdanote's service-role key to the new `sb_secret_` format, and the HQ secrets store was updated under the new env name `VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY`. The old name was retired and never re-aliased, so agents reaching for the "obvious" `VERDANOTE_SUPABASE_SERVICE_ROLE_KEY` name will silently get an empty value (no error from `hq run`) and then hit 401s with a useless message — costing investigation time. Locking the canonical name in this policy avoids re-learning it every session.

## Examples

**Correct:**

```bash
hq run --co goodo-studios -- bash -c '
  curl -sS \
    -H "apikey: $VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY" \
    "https://<project>.supabase.co/rest/v1/sync_queue?select=*&status=eq.running"
'
```

**Incorrect:**

```bash
# VERDANOTE_SUPABASE_SERVICE_ROLE_KEY does not exist — request will 401
curl -H "apikey: $VERDANOTE_SUPABASE_SERVICE_ROLE_KEY" ...
```
