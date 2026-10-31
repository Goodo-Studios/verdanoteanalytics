---
id: verdanote-apify-fb-carousel-video-in-cards
title: Apify facebook-ads-scraper carousel video URLs are in snapshot.cards[N].videoHdUrl
scope: repo
trigger: extracting video URLs from Apify facebook-ads-scraper results
enforcement: soft
public: false
version: 1
created: 2026-06-05
updated: 2026-06-05
source: session-learning
applies_to: [apify]
---

## Rule

ALWAYS: For Apify facebook-ads-scraper, Facebook carousel/DCO ads store video URLs under `snapshot.cards[N].videoHdUrl` — NOT `snapshot.videos[]`. `snapshot.videos` is always empty for carousel format. Check `cards[]` after `videos[]` in `extractVideoUrl`.

## Rationale

Carousel and DCO ad formats in the Apify facebook-ads-scraper response do not populate `snapshot.videos`. The video URLs for each card live at `snapshot.cards[N].videoHdUrl`. Checking only `snapshot.videos` results in silently missing all carousel video assets.
