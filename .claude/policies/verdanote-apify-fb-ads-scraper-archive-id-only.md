---
id: verdanote-apify-fb-ads-scraper-archive-id-only
title: apify~facebook-ads-scraper — only Ads Library ?id=<ad_archive_id> targets one ad; post/page URLs are uncappable whole-page scrapes
scope: repo
trigger: building Apify inputs for facebook-ads-scraper, estimating Apify capture cost, or debugging why actor results cannot be matched to a creative
when: apify || facebook-ads-scraper || ad_archive_id
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

NEVER feed post URLs (`facebook.com/.../posts/...`) or page URLs (`view_all_page_id=...`)
to `apify~facebook-ads-scraper` expecting per-ad results. The actor treats both as
whole-page scrapes: the `count` input is ignored, every returned item is billed
($0.005/item, PAY_PER_EVENT), runs return hundreds of items (460–687 observed) until
the actor timeout, and returned items carry a null `adId` so they cannot be matched
back to a specific creative. The ONLY input that targets a single ad is the Ads
Library URL form `?id=<ad_archive_id>` — and an empty lookup is still billed one item.

## Rationale

US-000 spike (2026-07-22, apify-creative-capture): two concurrently launched
page-scale runs expanded silently and billed $5.75 against a $2 guardrail before the
breach was observable. Per-ad targeting requires the true `ad_archive_id`
(see companion policy: `creatives.ad_id` is NOT it).
