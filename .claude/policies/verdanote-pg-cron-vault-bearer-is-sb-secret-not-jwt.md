---
id: verdanote-pg-cron-vault-bearer-is-sb-secret-not-jwt
title: pg_cron vault bearer is an sb_secret_ key, not a JWT — never gate cron-invoked edge fns on JWT role claims
scope: repo
trigger: authoring or reviewing auth gates on verdanoteanalytics edge functions invoked by pg_cron
when: pg_cron || service_role || verify_jwt || edge
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: hard
public: false
version: 1
created: 2026-07-22
updated: 2026-07-22
source: task-completion
---

## Rule

Edge functions invoked by pg_cron via the vault `service_role_key` secret must NOT
gate on decoding the bearer as a JWT (e.g. requiring a `role: service_role` claim).
The project has migrated to the new Supabase API-key system: the vault secret is an
`sb_secret_…` value, which is not a decodable JWT — a JWT-role gate 403s every cron
poke while looking correct in review. For internal cron-drain workers, use
`verify_jwt = false` with NO self-auth (the drain-media-queue pattern). Reserve
JWT-role-claim gates for functions invoked with legacy service-role JWTs, and prove
the gate with a real cron-idiom invocation before relying on it.

## Rationale

US-001B's resolve-ad-archive-ids shipped with a jwtRole === 'service_role' gate
(copied from apify-spike) and silently 403'd its own 30-minute cron from the first
fire — the cron "ran" but never did work. Discovered during US-003 when the same
gate 403'd apify-capture-drain's cron poke in prod testing (2026-07-22). The
failure mode is invisible without reading edge-function logs: cron history shows
succeeded runs while the function rejects every request.
