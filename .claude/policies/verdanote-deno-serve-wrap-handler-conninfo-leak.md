---
id: verdanote-deno-serve-wrap-handler-conninfo-leak
title: Verdanote — wrap Deno.serve handlers that have an injectable second param to avoid connInfo leaking in
scope: repo
trigger: binding a Deno edge-function handler to Deno.serve when the handler signature has an optional second parameter (e.g. an injectable Supabase client for tests)
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-06-02
source: session-learning
applies_to: [supabase]
---

## Rule

NEVER: bind a Deno edge function with `Deno.serve(handler)` when the handler has an optional second parameter (e.g. an injectable client for tests). Deno invokes the handler as handler(req, connInfo), so the ServeHandlerInfo object leaks in as that param and is used as the real arg — surfacing at runtime as 'supabase.from is not a function'. Wrap it: `Deno.serve((req) => handler(req))`, and shape-guard the injected arg (e.g. `typeof injectedClient.from === 'function'`).

## Rationale

Captured during a Verdanote edge-function session. A handler authored as `handler(req, injectedClient?)` for testability was registered directly with `Deno.serve(handler)`. At runtime Deno calls the handler with `(req, connInfo)`, so `connInfo` (a `ServeHandlerInfo`) was bound to `injectedClient` and the code then called `injectedClient.from(...)`, throwing 'supabase.from is not a function'. Wrapping the registration so only `req` is forwarded, plus shape-guarding the injected arg, makes the test seam safe without exposing it to Deno's runtime call convention.
