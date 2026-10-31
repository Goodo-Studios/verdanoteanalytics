---
id: verdanote-edge-fn-auth-accept-sb-secret-key
title: Verdanote edge-function custom auth must accept the new sb_secret_* key format, not just JWTs
scope: repo
trigger: writing or debugging custom auth in a Verdanote Supabase edge function (e.g. sync, scheduled-sync), or a service-role/cron call to an edge function returns 401 Unauthorized
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-06-02
source: session-learning
applies_to: [supabase]
---

## Rule

Verdanote's prod service-role key is the **new secret API key format `sb_secret_*`**, NOT a legacy JWT. Any edge-function custom auth gate that recognises automated callers by decoding a JWT role claim — e.g. `JSON.parse(atob(token.split(".")[1])).role === "service_role"` — will THROW on an `sb_secret_*` token (it has no `.` segments / no role claim), get swallowed by the surrounding try/catch, and fall through to `supabase.auth.getUser(token)` which returns no user → **401**.

ALWAYS trust `sb_secret_*` explicitly via prefix check, alongside the other accepted forms:

```ts
const isAnonKey       = /* JWT role === "anon" || "service_role" */;
const isPublishableKey = authToken.startsWith("sb_publishable_");
const isSecretKey      = authToken.startsWith("sb_secret_");   // service-role-equivalent
if (!isAnonKey && !isPublishableKey && !isSecretKey) { /* fall back to getUser() */ }
```

This matters because `scheduled-sync` (and the pg_cron job that drives it) forward exactly this `sb_secret_*` key to `POST /sync`. Without the `sb_secret_*` branch the entire automated sync path 401s even though the cron fires correctly. A JWT-role-only check is necessary but not sufficient.

## Rationale

During the 2026-06-02 sync-restore, `POST /sync` with the prod service-role key returned 401 even after a first fix that added `payload.role === "service_role"` to the JWT decode. Root cause: the key is `sb_secret_*` (41 chars, non-JWT), so `atob(token.split(".")[1])` threw and the call fell through to `getUser()` → 401. Adding an explicit `sb_secret_*` prefix branch (PR #26) fixed it and the automated chain came back (scheduled-sync → 200, real syncs ran). The 401 body was the app's `{"error":"Unauthorized"}`, not the gateway's — confirming it was the in-function check, not `verify_jwt`.
