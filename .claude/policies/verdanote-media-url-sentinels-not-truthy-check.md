---
id: verdanote-media-url-sentinels-not-truthy-check
title: Never treat creatives.video_url / thumbnail_url truthiness as "has media" — they use sentinels
scope: repo
trigger: Checking whether a creative has media, or routing a creative into a video-transcription vs image branch
when: video_url || thumbnail_url || media-discovery
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-18
updated: 2026-07-18
source: session-learning
applies_to: [supabase]
---

## Rule

NEVER trust `creatives.video_url` / `thumbnail_url` truthiness as "has media" — they use sentinels: `video_url='no-video'` (`NO_VIDEO_SENTINEL` in `_shared/media-discovery.ts`) and `thumbnail_url='no-thumbnail'` mean NOT present. Always exclude the sentinels when checking media presence.

## Rationale

`!!video_url` treated the `'no-video'` sentinel as a real video and routed image ads through the video-transcription branch with an empty script. The columns are never truly empty for a discovered-but-absent asset — they hold the sentinel string — so a plain truthiness check is always wrong for media presence. Check `video_url && video_url !== 'no-video'` (and the equivalent for `thumbnail_url !== 'no-thumbnail'`) instead.
