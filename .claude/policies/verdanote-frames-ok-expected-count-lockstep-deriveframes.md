---
id: verdanote-frames-ok-expected-count-lockstep-deriveframes
title: Keep media_coverage expected_frame_count in lockstep with deriveFrames() and only enforce captured shapes
scope: repo
trigger: Tightening media_coverage frames_ok / expected_frame_count in verdanoteanalytics
when: verdanoteanalytics && (frames_ok || expected_frame_count || deriveFrames || media_coverage || frames_incomplete)
on: [PreToolUse, PostToolUse, UserPromptSubmit, AssistantIntent]
enforcement: soft
public: false
version: 2
created: 2026-07-16
updated: 2026-07-21
source: session-learning
applies_to: [supabase]
---

## Rule

ALWAYS: when tightening media_coverage frames_ok, keep expected_frame_count in exact lockstep with deriveFrames() (derive the count FROM the ledger length) so expected can never exceed capturable frames — this preserves the migration 20260714000027 'never guess -> no false frames_incomplete' invariant. Only enforce shapes that are actually captured (carousel cards, asset_feed_spec.videos); asset_feed_spec.images are NOT captured so must stay null.

ALWAYS make coverage metrics measure the ASSET, not the ledger row: `media_coverage.frames_ok` originally counted `creative_frames` rows (>= expected_frame_count) rather than whether each frame's image was cached (`asset_id` set), so 'Frame pending' carousels read as covered and were invisible to the self-heal feeder. Count asset presence, and add a per-ad `frames_retry_after` backoff before enqueuing `frames_incomplete` so unresolvable frames don't churn every feeder tick.

## Rationale

Captured as a verdanoteanalytics session learning. Deriving `expected_frame_count` directly from the `deriveFrames()` ledger length guarantees expected can never exceed the frames that are actually capturable, preserving the migration 20260714000027 "never guess -> no false frames_incomplete" invariant. Enforcing only captured shapes (carousel cards, `asset_feed_spec.videos`) and leaving uncaptured `asset_feed_spec.images` null avoids fabricating expected frames that would mark coverage falsely incomplete.

A coverage metric must measure the ASSET, not the ledger row. `media_coverage.frames_ok` originally counted `creative_frames` rows against `expected_frame_count`, so a carousel with rows present but images still uncached ('Frame pending') read as fully covered — which hid it from the self-heal feeder that keys off coverage gaps. Counting whether each frame's image is actually cached (`asset_id` set) makes the metric reflect real asset presence. Pairing that with a per-ad `frames_retry_after` backoff before enqueuing `frames_incomplete` stops frames that can never resolve from re-enqueuing on every feeder tick.
