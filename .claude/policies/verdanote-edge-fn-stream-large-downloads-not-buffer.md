---
id: verdanote-edge-fn-stream-large-downloads-not-buffer
title: Stream large file downloads into storage — never buffer into a byte array/Blob first in a Supabase edge function
scope: repo
trigger: A verdanoteanalytics edge function downloads a file (video, large media asset) from an external URL and re-uploads it to storage
when: edge && (download || upload || fetch) && (video || file || storage)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-08-03
updated: 2026-08-03
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS stream large file downloads directly into storage — pipe the fetch response body as the upload request body with `duplex: 'half'` — rather than buffering the whole file into a byte array/Blob first in a Supabase edge function. Buffering even ~30MB of video data was enough to trigger `WORKER_RESOURCE_LIMIT` and crash the isolate, well under any reasonable size cap. A size cap alone does not fix this — the buffering pattern itself is the problem, so shrinking the cap only delays the crash to a slightly smaller file.

```ts
const upstream = await fetch(sourceUrl);
const uploadResp = await fetch(uploadUrl, {
  method: "PUT",
  body: upstream.body,   // stream straight through, no buffering
  duplex: "half",
  headers: { /* ... */ },
});
```

## Rationale

Captured during a Verdanote Creative Vault session. An edge function downloaded a file and re-uploaded it to storage by first reading the whole response into memory (byte array / Blob) before issuing the upload. Buffering roughly 30MB of video data was enough to exceed the Supabase edge isolate's memory ceiling and trigger `WORKER_RESOURCE_LIMIT`, crashing the whole isolate — well under any size cap that looked "safe" on paper. Piping the fetch response body directly as the upload request body (with `duplex: 'half'` for Node/undici-based fetch implementations that require it for streaming request bodies) avoids ever materializing the full file in memory. Related but distinct from `verdanote-base64-images-sequential-not-promise-all-edge-oom` (which is about many small buffers fanned out concurrently via `Promise.all`) — this is about a single large buffer materialized synchronously for one download/upload.
