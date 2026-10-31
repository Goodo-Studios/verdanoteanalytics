---
id: verdanote-ad-id-is-not-ad-archive-id
title: creatives.ad_id (Ads-Manager id) is NOT the Ad Library ad_archive_id — no direct conversion exists
scope: repo
trigger: building Ads Library URLs from stored creatives, planning Apify capture, or any per-ad Ad Library lookup
when: ad_archive_id || (ads && library) || apify
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: hard
public: false
version: 1
created: 2026-07-22
updated: 2026-07-22
source: task-completion
applies_to: [supabase]
---

## Rule

NEVER build an Ads Library per-ad URL (`?id=...`) from `creatives.ad_id` — that column
holds the Ads-Manager ad id, not the Ad Library `ad_archive_id`, and the lookup
deterministically returns no items (100% failure across accounts; each empty paid
lookup still bills). No documented direct conversion exists. To obtain
`ad_archive_id` per creative, sweep the free Meta Ad Library API by `page_id` and
match results back on `effective_object_story_id` / `meta_video_ids`, then store the
resolved id on the creative before any per-ad library lookups.

## Rationale

US-000 spike (2026-07-22): this identifier mismatch was the sole blocker to the Apify
capture plan — media quality and downloadability were excellent once a valid archive
id was used. Resolution-and-store is the prerequisite gating US-001/US-002/US-004 of
apify-creative-capture.
