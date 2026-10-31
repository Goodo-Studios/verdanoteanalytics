---
id: verdanote-vault-transcribe-use-deepgram-for-large-video
title: Verdanote vault-transcribe must use Deepgram-by-URL for large videos (Groq Whisper 25MB cap)
scope: repo
trigger: implementing or debugging Verdanote Creative Vault vault-transcribe transcription
enforcement: soft
public: false
version: 1
created: 2026-06-02
updated: 2026-06-02
source: session-learning
---

## Rule

ALWAYS: Verdanote Creative Vault transcription (vault-transcribe) uploads the WHOLE video file to Groq Whisper, which has a ~25MB sync upload cap. Videos over ~25MB (≈75-90s of 720p) 413 and were silently marked ready with no transcript, then 'Run analysis' threw 'No transcript found for item'. Use Deepgram /v1/listen by URL (DEEPGRAM_API_KEY) which extracts audio server-side with no size cap; Groq stays as small-file fallback.

## Rationale

Captured as a session learning during a Verdanote Creative Vault ship. Groq Whisper's synchronous upload endpoint rejects files over ~25MB with a 413, but the failure was swallowed — the item was marked ready with no transcript, so the downstream analysis step failed with 'No transcript found for item'. Deepgram's `/v1/listen` accepts a media URL and extracts audio server-side, so file size is not bounded by an upload cap. Route large videos to Deepgram (DEEPGRAM_API_KEY) and keep Groq as the small-file fallback.
