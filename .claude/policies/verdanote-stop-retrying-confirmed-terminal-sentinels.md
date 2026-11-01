---
id: verdanote-stop-retrying-confirmed-terminal-sentinels
title: Stop retrying sentinel rows once the sentinel class is confirmed terminal
scope: repo
trigger: reviewing or extending retry behavior in sync/enrich workers — especially anywhere a sentinel value ("no data found") is being treated as "try again later"
enforcement: soft
public: false
version: 1
created: 2026-05-27
updated: 2026-05-27
source: session-learning
---

## Rule

ALWAYS: Sentinels exist on a transient → terminal spectrum, and the retry policy must match. When a sentinel class has been observed to be terminal at population scale (the row has no real data, has never had real data, and there is no upstream change that would produce data), the retry path must remove that class entirely — not just deprioritize it.

Concretely in `enrich-thumbnails`:

- **Image-only Meta ads have no video URL, ever.** The `runVideoDiscoveryFull` sentinel marks those rows. Retrying them at 200/sync against the Graph API was guaranteed to come back with the same sentinel value forever — pure quota waste against an app-wide [[verdanote-meta-rate-limit-is-app-wide-not-per-user|Meta rate limit]].
- **The fix is structural, not heuristic.** Don't lower the retry frequency, don't add an exponential backoff, don't add "try only on Sundays" — remove `scope=all` from the path that retries those sentinels. The sentinel itself is the terminal signal.
- **Transient sentinels are different.** A row with `video_url = NULL` because we haven't asked Meta yet is transient — it should be in the retry queue. The distinguishing question is "could a future call produce a different answer?" If no, it is terminal.

## Rationale

Verdanote's 2026-05-27 review found `scope=all` in `enrich-thumbnails` was retrying 6,326 sentinel-marked rows at 200/sync — every sync, forever, against rows that had been confirmed image-only ads in earlier passes. The Graph API was returning the same sentinel answer every time. Net effect: ~200 Graph calls per sync produced zero new data and ate into the same app-wide quota that occasionally returned [[verdanote-meta-rate-limit-is-app-wide-not-per-user|error #4]] under load. Removing the retry didn't lose anything — the rows already had the correct final state.

Architectural implications:

- **Default-retry is a code smell at scale.** "Just retry it; what's the harm?" is fine at low volumes; at 6,326 rows × N syncs × shared quota, it costs the whole system. Every retry path must be able to answer "why is this row in this queue right now?" If the answer is "in case it changes," the row needs a clearer terminal predicate.
- **Sentinels need lifecycle, not just identity.** It is not enough that a column says `"<sentinel>"` — the worker needs to know whether that sentinel is the system's first guess (retry) or its final answer (skip). Encode that in the query or in a separate `discovery_state` column rather than treating all sentinels equivalently.
- **Quota is the canary.** When a worker is shelved by rate limits but the user-facing data didn't change, the question to ask is "what work am I doing that does not produce new state?" — that's usually a sentinel retry or a missing skip-gate ([[verdanote-progressive-cache-skip-gate-in-query]]).

Companion policy: [[verdanote-progressive-cache-skip-gate-in-query]] — same anti-pattern applied to the "already done" case rather than the "permanently won't happen" case.
