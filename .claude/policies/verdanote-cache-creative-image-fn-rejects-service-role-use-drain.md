---
id: verdanote-cache-creative-image-fn-rejects-service-role-use-drain
title: Never call Verdanote cache-creative-image headlessly with the service-role key — it requires a user session; use drain-media-queue for headless per-ad media
scope: repo
trigger: resolving Verdanote per-ad media headlessly, choosing between cache-creative-image and drain-media-queue edge functions, or debugging an Unauthorized from a service-role bearer
when: verdanote && (cache-creative-image || drain || media || edge || service-role || jwt || unauthorized || headless)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-17
updated: 2026-07-17
source: session-learning
applies_to: [supabase]
---

## Rule

NEVER: invoke Verdanote's cache-creative-image edge function headlessly with the service-role key — it has verify_jwt=true and calls supabase.auth.getUser(token), so it requires a real user session and returns {error:Unauthorized} for a service-role bearer. For headless per-ad media resolution use drain-media-queue (verify_jwt=false), whose net.http_post cron pattern passes the vault service_role_key.

## Rationale

Captured from a Verdanote media-pull session. cache-creative-image is a session-authed function (verify_jwt=true + supabase.auth.getUser), so a service-role bearer is not a valid user and the call fails with Unauthorized. The correct headless path is drain-media-queue (verify_jwt=false), which the pg_cron net.http_post pattern invokes with the vault service_role_key. Documenting this prevents future sessions from wasting a cycle on the wrong function for headless media resolution.
