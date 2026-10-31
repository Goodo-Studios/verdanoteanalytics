---
id: verdanote-media-coverage-read-via-rpc-not-curated-api
title: Read Verdanote media-coverage / failure-reason data via the get_media_coverage RPC, not the curated /api edge fn
scope: repo
trigger: reading Verdanote media-coverage, video_url, or media failure-reason data
when: verdanote && (media || coverage || video || rpc || postgrest || failure)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-16
updated: 2026-07-16
source: session-learning
applies_to: [supabase, meta]
---

## Rule

ALWAYS: to read Verdanote media-coverage / failure-reason data, call the get_media_coverage(p_account_id) Postgres RPC via PostgREST (/rest/v1/rpc/get_media_coverage) with the service-role key. The curated read /api edge function (hooks/angles/creatives) does NOT expose video_url or media failure reasons.

## Rationale

Captured so future sessions target the correct read path for media-coverage and failure-reason data instead of assuming the curated /api edge function surfaces it.
