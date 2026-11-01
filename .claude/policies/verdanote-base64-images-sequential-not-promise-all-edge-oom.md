---
id: verdanote-base64-images-sequential-not-promise-all-edge-oom
title: Never base64-encode many images via Promise.all in a Supabase edge function — it OOMs the isolate
scope: repo
trigger: A verdanoteanalytics edge function base64-encodes multiple images (thumbnail + frames) per invocation, especially under high concurrency (drain/analyze pipelines)
when: edge && (image || base64 || frame)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-23
updated: 2026-07-23
source: session-learning
applies_to: [supabase]
---

## Rule

NEVER base64-encode many images (thumbnail + up to 8 frames) via Promise.all across high edge-function concurrency — it OOMs the Supabase edge isolate (HTTP 546 WORKER_RESOURCE_LIMIT), killing invocations mid-batch and orphaning claimed 'analyzing' rows into an endless reclaim loop (0 throughput, failures flat). Encode frames sequentially/chunked and bound concurrency to the isolate memory ceiling.

## Rationale

Captured during a verdanote creative-capture session. Fanning image base64 encoding out with `Promise.all` holds every decoded buffer in memory at once; multiplied across concurrent edge invocations it exceeds the Supabase edge isolate memory ceiling and the worker is killed with HTTP 546 `WORKER_RESOURCE_LIMIT`. The kill happens mid-batch, so rows already claimed as `analyzing` are never released — they fall into an endless reclaim loop, producing zero throughput while the failure count stays flat (masking the problem). Encoding frames sequentially or in bounded chunks keeps peak memory under the isolate limit.
