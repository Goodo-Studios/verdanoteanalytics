---
id: verdanote-get-media-coverage-counts-only-eligible-ads
title: Verdanote get_media_coverage counts only ELIGIBLE ads — measure backlog recovery against eligible ads and video_ok, not raw queue drain
scope: repo
trigger: measuring Verdanote media backlog recovery, interpreting coverage_pct movement, or resolving media for ineligible/stale-staged queue rows
when: verdanote && (media || coverage || get_media_coverage || eligible || backlog || video_ok || queue || impressions)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 1
created: 2026-07-17
updated: 2026-07-17
source: session-learning
applies_to: [supabase, meta]
---

## Rule

ALWAYS: Verdanote get_media_coverage counts only ELIGIBLE ads (non-archived AND impressions>0). Resolving media for ineligible ads (ad_status UNKNOWN / 0 impressions — e.g. leftover stale-staged media_cache_queue rows) creates media_assets + storage objects but does NOT move coverage_pct. Measure backlog recovery against eligible ads and video_ok, not raw queue drain.

## Rationale

Captured from a Verdanote media-pull session. Because get_media_coverage's denominator is only eligible ads (non-archived, impressions>0), draining the queue for ineligible ads produces assets and storage objects with zero effect on coverage_pct. Measuring progress by raw queue drain therefore overstates recovery; the honest signal is movement in eligible-ad coverage and video_ok.
