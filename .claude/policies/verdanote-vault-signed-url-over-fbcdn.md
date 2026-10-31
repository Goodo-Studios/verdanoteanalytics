---
id: verdanote-vault-signed-url-over-fbcdn
title: Prefer Supabase Storage signed URL over Facebook CDN URL for vault video playback
scope: repo
trigger: resolving a video URL for Verdanote vault frontend playback
enforcement: soft
public: false
version: 1
created: 2026-06-05
updated: 2026-06-05
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS: For Verdanote vault frontend, prefer durable Supabase Storage signed URL over `video_url` CDN URL when both exist. Facebook `fbcdn.net` CDN URLs expire within hours. The signed URL query must be enabled for all non-image `file_path`s regardless of whether `video_url` is set.

## Rationale

Facebook CDN (`fbcdn.net`) video URLs are time-limited and typically expire within hours of scraping. Relying on `video_url` for playback in the vault results in broken video players for any asset that was ingested more than a few hours ago. Supabase Storage signed URLs are durable (configurable TTL) and are the correct source for playback. Always generate a signed URL for any vault item with a non-image `file_path`, even when `video_url` is also populated.
