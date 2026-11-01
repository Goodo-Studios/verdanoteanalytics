---
id: verdanote-prod-deploys-are-manual-cli
title: Verdanote — CI auto-deploys edge functions on merge, but the FRONTEND (Vercel) + migrations are manual CLI
scope: repo
trigger: shipping a Verdanote change to prod after merging a PR to main — especially any frontend/UI (React) change, a migration, or expecting "CI green" to mean the user can see it
enforcement: hard
public: false
version: 7
created: 2026-05-30
updated: 2026-08-08
source: user-correction
applies_to: [vercel, supabase]
---

## Rule

ALWAYS verify claims about deploy automation (e.g. "this auto-deploys on merge") by reading the actual CI workflow YAML before writing it into a PR description or telling the user — a policy summary read earlier in a session can be stale or describe a different layer than the one in question. For verdanoteanalytics specifically: only Supabase edge functions auto-deploy on push to main (CI's `deploy-functions` job); the frontend has no Vercel git integration and needs a manual `vercel --prod --yes` run from a clean detached worktree of origin/main, and DB migrations need a manual `supabase db push --linked` from the main checkout.

Merging a Verdanote PR to main does NOT ship every layer. The three layers deploy differently — know which is automatic and which is manual:

1. **Edge functions — AUTOMATIC on push to main.** The GitHub Actions `deploy-functions` job runs `scripts/deploy-functions.sh` and redeploys ALL edge functions (not just changed ones) to prod on every merge. E2E is gated behind it (`ci.yml`: `needs: [check, deploy-functions]`). So "CI green after merge" DOES mean edge functions shipped. (Corollary: because it deploys ALL functions from origin/main, origin/main is the source of truth for prod edge functions — merging a branch that lacks an in-flight manual edge-fn fix will REVERT that fix in prod. Land such fixes before the next merge.)

2. **Frontend (Vercel project `verdanoteanalytics`) — MANUAL.** Vercel git auto-deploy is NOT active (no GitHub deployments recorded; every prod deploy is a manual `vercel --prod` by the user). CI only *builds* the app to run Playwright E2E — it never deploys it. Therefore "CI green after merge" does NOT mean a frontend/UI change is live. ALWAYS run `vercel --prod --yes` from `repos/private/verdanoteanalytics` for any React/UI change, and VERIFY it actually shipped by diffing the deployed asset hash or grepping the live JS chunk — never trust the merge alone.

   **Quick sanity check before the full verification — `vercel ls`.** Never assume a push-to-main merge triggered a redeploy just because the git integration exists. Run `vercel ls` (from `repos/private/verdanoteanalytics`) right after a merge and check the timestamp of the newest deployment against the merge time — if nothing new appears within the normal webhook window, the auto-deploy did not fire and a manual `vercel --prod` is required. This is a fast first check; still confirm with the chunk-hash grep below before declaring the change live.

   **Vercel is NOT connected to GitHub — check `vercel ls` for release drift and flag unreleased commits before deploying.** *(added 2026-08-08)* Verdanote (`repos/private/verdanoteanalytics`) is hosted on Vercel but Vercel is NOT connected to GitHub. Merging a PR deploys nothing — production releases are manual `vercel --prod` runs. Production was found running 4 days and 2 merged PRs behind main. Always check `vercel ls` for drift before assuming a merge shipped, and flag any unreleased commits to the user before deploying, since a deploy ships everything on main, not just your change.

   **Verify the deployed ORIGIN, not just CI — assert on headers and content-type, not only the bundle.** *(added 2026-08-08)* ALWAYS verify the deployed origin directly after a production deploy, not just that CI passed. Fetch the real URLs and assert on what came back (content-type, headers, presence of expected tags). Two deploys shipped an app-wide broken CSP with every CI check green, because nothing exercised the production headers.

   **Verification target — grep the route-split lazy chunk, NOT the entry `index-*.js`.** Page/feature components are code-split, so their strings never appear in the entry bundle. To confirm a specific page change is live: `curl https://www.verdanote.com` → read the entry `index-*.js`'s import map → find the page's lazy chunk (e.g. `ContentPipeline-*.js` / `ContentPipelinePage-*.js`) → grep THAT chunk for the changed markers. A fresh `index-*.js` hash also confirms a new deploy is serving, but only the lazy chunk proves the page change itself shipped.

3. **DB migrations — MANUAL.** CI does not apply them. Run `supabase db push --linked` from the linked MAIN checkout (`repos/private/verdanoteanalytics`, which carries `supabase/.temp`; worktrees are not linked). See `verdanote-ci-deploy-ships-functions-not-migrations`.

Full post-merge manual sequence from `repos/private/verdanoteanalytics` (source `.env` first): `vercel --prod --yes` (frontend) + `supabase db push --linked` (migrations). Edge functions need no manual step on merge — CI handles them — but for an out-of-band push use `bash scripts/deploy-functions.sh` with `SUPABASE_PROJECT_ID=gwyxaqoaldnaavkjqquv`.

**No confirmation ask required.** After any React/UI change, run `vercel --prod --yes` immediately — do NOT ask the user for permission or confirmation first. Then verify the live bundle (see verification target below). Deploy automatically; report afterward.

## Rationale

Corrected via user-correction on 2026-06-02. The prior v1 of this policy wrongly claimed edge functions were also manual and "superseded" `verdanote-ci-deploy-ships-functions-not-migrations`. This session's CI logs disproved that: the `deploy-functions` job ran and deployed edge functions automatically on the PR #13 and #14 merges. The accurate model is split — edge functions auto-deploy on merge; the frontend and migrations do not.

Concrete failure that prompted the correction: a kanban `/pipeline` React component was merged with green CI and reported to the user as "live," but www.verdanote.com kept serving the OLD flat-list bundle (deployed chunk hash unchanged, still importing the removed `circle-check`, no `bucketByColumn`/"Nothing here yet" markers) because no frontend deploy ran. Conflating "CI green" with "shipped" is the trap: CI green proves edge functions + tests, NOT the frontend. Running `vercel --prod` and re-grepping the live bundle confirmed the kanban only after the explicit deploy.
