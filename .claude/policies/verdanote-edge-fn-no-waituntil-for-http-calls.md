---
id: verdanote-edge-fn-no-waituntil-for-http-calls
title: Never rely on EdgeRuntime.waitUntil for function-to-function HTTP calls in Supabase edge functions
scope: repo
trigger: making function-to-function HTTP calls inside a Supabase edge function
enforcement: soft
public: false
version: 1
created: 2026-06-05
updated: 2026-06-05
source: session-learning
applies_to: [supabase]
---

## Rule

NEVER: Rely on `EdgeRuntime.waitUntil` for function-to-function HTTP calls in Supabase edge functions — it silently drops calls in some runtime conditions. Use synchronous `await` for calls that must complete before the response is sent.

## Rationale

`EdgeRuntime.waitUntil` is intended for fire-and-forget background work after the response is flushed. In some Supabase edge runtime conditions the deferred call is silently discarded without error. For any HTTP call whose completion is required (e.g. triggering a downstream pipeline), use `await` before sending the response.
