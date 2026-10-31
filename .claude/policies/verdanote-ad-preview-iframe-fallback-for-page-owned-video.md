---
id: verdanote-ad-preview-iframe-fallback-for-page-owned-video
title: Use the ad-preview edge function (Meta preview_iframe) as the viewer fallback for unrecoverable page-owned video
scope: repo
trigger: Rendering/viewing a Verdanote ad video that cannot be downloaded via the raw `source` field — permission-blocked or third-party page-owned boosted video
when: verdanote && (video || preview_iframe || ad-preview || fbcdn || page-owned || viewer || embed) && (permission || source || boost || fallback)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-21
updated: 2026-07-21
source: session-learning
applies_to: [meta]
---

## Rule

ALWAYS use the ad-preview edge function (Meta `preview_iframe`) as the viewer fallback for permission-blocked / page-owned video that cannot be downloaded via the raw `source` field — Meta hosts the ad so its preview iframe plays it in-app with a browser-safe preview-scoped token. Only ~3 Facebook Pages are assigned to the system user; third-party pages referenced by boosted ads are unreadable (#10) and their raw video is permanently unrecoverable, so the embed is the only way those play.

## Rationale

Captured from a Verdanote media-pull session. Page-owned boosted videos require the owning Page's token to read the raw `source`, and the system user can only mint that token for the ~3 Pages actually assigned to it (see [[verdanote-page-owned-video-needs-system-user-page-assignment]]). Third-party pages referenced by boosted ads return Meta error #10 and their raw video is permanently unrecoverable — no amount of retrying resolves a downloadable URL. Meta's ad preview iframe, however, renders the ad server-side with a preview-scoped token that is safe to embed in the browser, so the `preview_iframe` from the ad-preview edge function plays these videos in-app even when the underlying asset can never be cached. Reach for the embed as the display-layer fallback rather than marking such creatives unviewable.
