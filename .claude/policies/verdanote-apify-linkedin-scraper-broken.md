---
id: verdanote-apify-linkedin-scraper-broken
title: Broken LinkedIn Apify actor — electrifying_haircut~linkedin-post-scraper
scope: repo
trigger: when selecting an Apify actor for LinkedIn post scraping in the Verdanote vault pipeline
enforcement: hard
public: false
version: 1
created: 2026-06-08
updated: 2026-06-08
source: session-learning
applies_to: [apify]
---

## Rule

NEVER use the `electrifying_haircut~linkedin-post-scraper` Apify actor for LinkedIn scraping. It always returns `success:false` for all tested URL formats (both `ugcPost-` and `activity-` prefixes). The actor has zero reviews and 2 monthly users — it is fundamentally broken.

## Rationale

Tested during the LinkedIn vault ingest work. The actor runs without error but the response body always contains `success:false` regardless of URL format. Wasted investigation time tracking down what appeared to be an auth or URL issue but was the actor itself.
