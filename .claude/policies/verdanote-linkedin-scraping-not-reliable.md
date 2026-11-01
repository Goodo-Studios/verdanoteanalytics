---
id: verdanote-linkedin-scraping-not-reliable
title: LinkedIn scraping via Apify free-tier is unreliable — use Upload tab
scope: repo
trigger: when implementing LinkedIn video ingest in the Verdanote vault pipeline
enforcement: hard
public: false
version: 1
created: 2026-06-08
updated: 2026-06-08
source: session-learning
applies_to: [apify]
---

## Rule

NEVER assume LinkedIn video scraping via Apify free-tier actors is reliable. Both `ugcPost-` and `activity-` URL formats fail on all tested free actors. The reliable and supported path for LinkedIn video ingest is manual download by the user followed by the Upload tab — not automated scraping.

## Rationale

Multiple free Apify actors were tested for LinkedIn post scraping during vault ingest development. All failed consistently regardless of URL format. LinkedIn's anti-scraping measures make free-tier actors unreliable. Rather than chasing actor alternatives, the stable solution is the Upload tab workflow where users download the video themselves and upload directly.
