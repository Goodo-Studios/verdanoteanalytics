---
id: goodo-verdanote-video-metrics-coverage-vs-fill-rate
title: Verdanote data-health — `video_coverage` vs `video_fill_rate` are different metrics
scope: repo
trigger: Querying, dashboarding, alerting on, or writing copy about Verdanote video data-health metrics. Especially when evaluating whether the refresh-thumbnails job is working.
enforcement: soft
public: false
version: 1
created: 2026-05-20
updated: 2026-05-20
source: session-learning
---

## Rule

ALWAYS distinguish the two Verdanote video metrics by their denominators, and use the right one for the question being asked:

- **`video_coverage`** = (ads with a video URL) / (all spend-active ads). Broad UX-health signal — "what fraction of currently-running ads can a user actually preview a video for?" Drops when many active ads are non-video (image, carousel, static) and is therefore expected to be < 100%.
- **`video_fill_rate`** = (video-format ads with a video URL) / (all video-format ads). Pipeline-health signal — "of the ads that *should* have a video URL, how many actually have one stored?" This is the metric that tells you whether `refresh-thumbnails` is doing its job.

When asked "is refresh-thumbnails working?" → look at **`video_fill_rate`** only. When asked "how often can a user watch a creative in the dashboard?" → look at **`video_coverage`**.

## Rationale

The two metrics share a numerator pattern (ads with a video URL) but different denominators, so they answer different questions and can move in opposite directions:

- An ad-account that's mostly image ads will show low `video_coverage` (most active ads aren't videos) but high `video_fill_rate` (the few video ads all have URLs). That's healthy.
- A refresh-thumbnails outage will tank `video_fill_rate` (video ads missing URLs) while barely moving `video_coverage` (the broad denominator dilutes the signal).

Conflating them — e.g. paging on a `video_coverage` drop and assuming the pipeline broke — leads to false alarms whenever a brand shifts spend toward static creative, and it also masks real pipeline outages behind a healthy-looking broad metric. Surface both in dashboards but label them precisely and route alerts off `video_fill_rate`.

Caught during the Verdanote data-health metrics work — earlier instrumentation tracked only a single "video coverage" number and a refresh-thumbnails regression hid inside the noise of changing creative mix.
