---
id: verdanote-meta-ad-preview-media-filter-fbcdn-only
title: Filter Meta Ad Preview media srcs to *.fbcdn.net hosts only, never substring 'facebook'
scope: repo
trigger: extracting media (image/video) src URLs from Meta Ad Preview HTML in verdanoteanalytics
enforcement: soft
public: false
version: 1
created: 2026-05-31
updated: 2026-05-31
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS: when filtering Meta Ad Preview HTML for media src, restrict to `*.fbcdn.net` hosts only — never match on the substring `facebook`, which also catches `facebook.com` PAGE URLs (text/html) that get cached as `<adId>.jpg` garbage. Pair the upstream discovery filter (fbcdn host allowlist) with a downstream `isMediaContentType` content-type guard that rejects anything that is not actually an image/video before caching.

## Rationale

Meta Ad Preview HTML contains many `facebook.com` links (page URLs, profile links, CTA destinations) alongside the real creative assets, which are served from `*.fbcdn.net`. A naive substring match on `facebook` sweeps up those page URLs, and when the pipeline fetches and caches them under a media key like `<adId>.jpg`, it stores `text/html` HTML pages as if they were images — corrupt, unrenderable "media" garbage. Restricting the discovery filter to `*.fbcdn.net` hosts excludes page URLs at the source; the `isMediaContentType` content-type guard on the fetched response is the defense-in-depth backstop that prevents any non-media payload from being cached even if discovery lets something through.
