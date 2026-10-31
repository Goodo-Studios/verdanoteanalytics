---
id: verdanote-public-vault-share-via-service-role-edge-fn
title: Public/anonymous views of Creative Vault items must go through a service-role edge function, not direct anon query
scope: repo
trigger: Building any public, no-login view of a Creative Vault inspiration_items row (share links, embeds, public galleries) in verdanoteanalytics — anything an unauthenticated visitor will load.
enforcement: soft
public: false
version: 1
created: 2026-06-03
updated: 2026-06-03
source: success-pattern
applies_to: [supabase]
---

## Rule

Serve public/anonymous views of a Creative Vault item through a service-role
edge function (e.g. `vault-share-item`, `verify_jwt=false` with per-action auth
inside), NOT the direct-anon-query + RLS pattern that ad-board sharing
(`/shared/ad-board/:shareToken`) and brief sharing (`/briefs/share/:token`)
use.

The edge function must:

1. Resolve the share token with the service role and return an explicit column
   allowlist — omit internal fields (`user_id`, `saved_by`, `performance_snapshot`,
   `source_ad_id`, `source_account_id`, `error_message`, `thumbnail_path`).
2. Sign any private-bucket media server-side: rows that carry a `file_path` (and
   no public `video_url`) need `createSignedUrl('inspiration-media', …)` minted
   with the service role and returned to the viewer.
3. Handle mint/revoke for ANY authenticated user (the library is global), since
   `inspiration_items` UPDATE RLS is owner-scoped — the service role sidesteps it.

Do NOT add a broad anon `SELECT` policy to `inspiration_items` to make a public
view work — that would expose the whole global library and its internal columns.

## Rationale

Uploaded vault creatives live in the PRIVATE `inspiration-media` storage bucket
and are served via signed URLs whose storage RLS is owner-scoped
(`(storage.foldername(name))[2] = auth.uid()`). An anonymous client therefore
cannot mint a signed URL, so the ad-board/brief direct-anon-query pattern (which
relies on public/CDN media) does not work for vault items. Routing reads through
a service-role edge function signs media, keeps the global library
authenticated-only, and lets the response omit internal/sensitive columns.

Shipped this way for the single-item share link (`/vault/share/:token`, PR #35,
2026-06-03): migration added `share_token`/`shared_at` with NO new RLS policy;
the `vault-share-item` function does mint/revoke (authed) + resolve (anon).
