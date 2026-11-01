---
id: verdanote-verify-frontend-fix-by-grepping-lazy-route-chunk
title: Verify a Vercel frontend fix is live by grepping the lazy route chunk, not the index shell bundle
scope: repo
trigger: confirming a verdanoteanalytics frontend fix is live after a Vercel deploy, especially when the app code-splits routes
enforcement: soft
public: false
version: 1
created: 2026-06-03
updated: 2026-06-03
source: session-learning
applies_to: [vercel]
---

## Rule

ALWAYS: To verify a Vercel frontend fix is live when the app code-splits routes, grep the route's lazy chunk (e.g. assets/ItemDetailPage-<hash>.js found via the chunk refs inside index-<hash>.js), NOT the index shell bundle — feature code is not in index. Chunk names are content-hashed, so a 'still broken after deploy' report from an already-open tab is almost always a stale pre-deploy bundle; confirm the fix string is in the served chunk, then have the user hard-refresh.

## Rationale

Captured as a session learning during a Verdanote frontend ship. The verdanoteanalytics app code-splits routes, so a route's feature code lives in its own lazy-loaded chunk (e.g. `assets/ItemDetailPage-<hash>.js`), not in the `index-<hash>.js` shell. Grepping the index shell for a fix marker therefore gives a false negative even when the fix shipped. Resolve the route's chunk via the chunk references inside `index-<hash>.js`, then grep that served chunk for the change marker. Because chunk names are content-hashed, a user reporting "still broken after deploy" from an already-open tab is almost always running a stale pre-deploy bundle — once the fix string is confirmed in the served chunk, have them hard-refresh.
