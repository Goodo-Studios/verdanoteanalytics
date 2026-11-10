# Staging

Staging is a full second copy of Verdanote with its own database, its own logins and its own site. Work is built and checked there first. Production only changes when `staging` is released to `main`.

| | Production | Staging |
|---|---|---|
| Site | www.verdanote.com | staging.verdanote.com (password protected) |
| Supabase project | `gwyxaqoaldnaavkjqquv` | `mnvcksbhbvypuiwozvct` (`verdanote-staging`) |
| Vercel project | `verdanoteanalytics` | `verdanote-staging` (team goodo-studios) |
| Git branch | `main` | `staging` (long-lived) |
| CI job on push | `deploy-functions` | `deploy-staging` |
| GitHub secrets | `SUPABASE_*`, `VITE_*`, `PLAYWRIGHT_*` | `STAGING_*` only |

## What staging is protected from

Staging logins live in a separate Supabase project, so a staging account can never sign in to production and a client can never reach staging by mistake.

Nothing in staging reaches real people or real outside accounts:

- **Scheduled jobs are off.** Migrations create pg_cron jobs. After every staging push, `scripts/staging-lockdown.sql` removes all of them and fails the run if any remain.
- **Production URLs are rewritten.** Some migrations hard-code the production function URL inside database functions. The same script rewrites them to the staging project and fails the run if any reference to production is left.
- **Outside accounts are not connected.** The staging project has no Meta, Slack, Resend (email), Coda, Apify, Deepgram, Anthropic or OpenRouter secrets. Server functions that need them fail or skip. Attio and Fireflies have no Verdanote server functions today. If a later change adds one, add its key only to a test workspace, never a real one. ClickUp has one, `sync-clickup-tasks`, which only reads (GET). Staging has no `CLICKUP_API_TOKEN`, so the function answers 500 there and the `/pipeline` board stays empty unless rows are seeded by hand. Giving staging a real ClickUp token would copy real client task names into staging; that is a decision for Matthew.
- **The site is behind a password.** `middleware.ts` asks for a shared password when the Vercel project has `STAGING_SITE=1`. If the password variable is missing it answers 503 instead of opening up. On production the file does nothing.
- **Test accounts only.** Data is made up. The demo ad account `act_demo_glowdrip` comes from `scripts/seed-demo-account.mjs`. No production data is copied.

## Test logins

All use the shared test password stored in the goodo-studios vault as `STAGING_TEST_PASSWORD`.

| Email | Role | Sees |
|---|---|---|
| builder@staging.verdanote.test | builder (staff) | everything |
| employee@staging.verdanote.test | employee (staff) | staff pages, not admin |
| client-a@staging.verdanote.test | client | only the demo ad account |
| client-b@staging.verdanote.test | client | nothing (no accounts linked) |

Recreate or reset them with `scripts/seed-staging-users.mjs`. It refuses to run against production.

The site password is `STAGING_GATE_PASSWORD` in the vault (user name `staging`).

## How work flows

1. Build each piece on its own branch and open a pull request into `staging`.
2. Merging into `staging` runs CI. The `deploy-staging` job applies database changes (staging only; production migrations stay manual), runs the lockdown script, ships all server functions and smoke tests them, all against the staging project only.
3. Ship the staging pages by hand, the same way production pages are shipped. From a clean checkout of the `staging` branch linked to the `verdanote-staging` Vercel project: `vercel deploy --prod`. The Vercel GitHub app is not installed for this repo, so there is no automatic page deploy.
4. Check the piece on staging. Run the client wall check (below).
5. Normal fixes keep going to `main`. Merge `main` into `staging` weekly so the two do not drift.

`deploy-staging` reads only `STAGING_*` secrets. Before it does anything it stops if any of them is empty, if the project id equals the production id, or if the URL does not match the project id. Pushes to `main` still run `deploy-functions` against production exactly as before (server functions only, no migrations). The production E2E job does not run for `staging` pushes or for pull requests into `staging`.

## Client wall check

Run after every change that touches staff pages, tables or server functions:

```bash
hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_ANON_KEY,STAGING_TEST_PASSWORD -- node scripts/staging-client-wall-check.mjs
```

It signs in as the test staff user and both test clients and confirms that clients only read their own rows and linked accounts, and that a client token is refused by a staff-only server function. Every new staff table needs its own client-blocking rule and a line in this script.

### The full client wall

The wall has six parts. Parts 1, 2 and 6 run on every change in CI (`supabase test db`). Parts 3 to 5 run against staging, and so does the HTTP check for part 6 (`scripts/staging-function-grants-check.mjs`).

| # | What it checks | Where | How to run |
|---|---|---|---|
| 1 | Every table in `public` has row rules on. Fails and names the table if not. | `supabase/tests/rls_enabled_on_all_tables_test.sql` | `supabase test db` (CI) |
| 2 | No policy gives signed-in users open access (`using (true)`, `auth.uid() is not null`, `auth.role() = 'authenticated'`) outside an allow-list. Today the allow-list is `creative_type_menu` only. | `supabase/tests/no_open_policies_test.sql` | `supabase test db` (CI) |
| 2b | A test client reads every table and sees only rows of its own account or user. Writes a filler row for another account in each table first, so an open table shows up as a leak. | `supabase/tests/client_reads_only_own_rows_test.sql` | `supabase test db` (CI) |
| 3 | A test client token is refused by every server function that handles staff data, every internal function and every secret-gated function. Also checks that client B cannot read the demo account, and that builder and employee are accepted where they should be. | `scripts/staging-client-wall-functions.mjs` | the command below |
| 4 | Every function directory is classified in `supabase/function-access.json`, and each class has the gate its name says. A new function fails CI until it is classified. | `src/test/functionAccessManifest.test.ts` | `npm test` (CI) |
| 5 | A client cannot load any staff page, and the employee login reaches them. Unit level (route table) and in a real browser. | `src/test/StaffArea.test.tsx`, `src/test/StaffMenu.test.tsx`, `e2e/staff-area.spec.ts` | `npm test`, and the Playwright command below |
| 6 | No `SECURITY DEFINER` function in `public` is executable by `anon` or `authenticated` unless it is on the allow-list in the test (browser calls, row-rule helpers, staff area functions that check `has_role(auth.uid(), ...)` in their body). Includes a self-test. The staging script calls every function the REST API exposes as `anon` and as client B (no linked accounts) with inert arguments and requires permission denied from each, plus positive controls (service role, builder, client A on its own account). | `supabase/tests/security_definer_grants_test.sql`, `scripts/staging-function-grants-check.mjs` | `supabase test db` (CI), and the second command below |

```bash
hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_ANON_KEY,STAGING_TEST_PASSWORD -- node scripts/staging-client-wall-functions.mjs
```

```bash
hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_ANON_KEY,STAGING_SUPABASE_SERVICE_ROLE_KEY,STAGING_TEST_PASSWORD -- node scripts/staging-function-grants-check.mjs
```

A new database function that the browser must call needs `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO authenticated, service_role` and an entry in the allow-list of `security_definer_grants_test.sql`, plus a check on who is asking inside the function. A function that only edge functions or cron call needs the revoke and `GRANT EXECUTE ... TO service_role`.

The browser check starts a local copy of the pages that talks to the staging project. Set these before `npx playwright test e2e/staff-area.spec.ts`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the staging project, `PLAYWRIGHT_CLIENT_EMAIL`/`_PASSWORD` for `client-a@staging.verdanote.test`, and `PLAYWRIGHT_EMPLOYEE_EMAIL`/`_PASSWORD` for `employee@staging.verdanote.test` (plus the existing `PLAYWRIGHT_TEST_*` for the builder). Take the values from the vault. Never type them into a file.

Adding a function: add it to `supabase/function-access.json` with its class. Adding a staff page: add its path to `STAFF_PAGES` in `src/test/StaffArea.test.tsx` and to `STAFF_PATHS` in `e2e/staff-area.spec.ts`. Adding a staff table: enable row rules and write a policy that names `builder` or `employee` in the same migration. The three database tests then cover it with no edit.

### Growth Dashboard numbers (builder only)

The Growth Dashboard page (`/builder/growth-dashboard`) stores its numbers in `growth_dashboard_data`: the row `state` holds what the old app kept in the browser's localStorage under the key `goodo3m_v1`, the row `plan` holds the plan figures that the old app had written into its code. Only builders can read or write the table (`supabase/tests/growth_dashboard_wall_test.sql`). Nothing real is seeded. To move the numbers once, open goodo-growth-dashboard.vercel.app in the browser that holds them, open the developer console and run `copy(localStorage.getItem('goodo3m_v1'))`, then paste the result on the page's Import tab. Enter the plan figures on the Plan tab.

### Roles from the old dashboard

The dashboard role `admin` becomes `builder` and `producer` becomes `employee`. `user-management` accepts `dashboard_role` in place of `role` when creating or updating a user, using `supabase/functions/_shared/dashboard-role-map.ts`. A dashboard `viewer` is refused: Verdanote has no read-only staff role, and adding one is Matthew's decision (see the role mapping research note in the consolidation project).

## Releasing staging to production

This step is one-way for the database. Get Matthew's sign-off first.

1. Take a fresh backup of the production database.
2. Rehearse: copy production into a scratch project, apply every staging migration to it, confirm nothing fails.
3. Merge `staging` into `main`. CI ships the server functions to production. CI does not apply database changes to production (the `ciWorkflow` test enforces this until the production migration history is reconciled), so apply them by hand with `supabase db push` against `gwyxaqoaldnaavkjqquv` once the rehearsal passed. The staging lockdown script never runs against production.
4. Ship the pages by hand: `vercel --prod` from `repos/private/verdanoteanalytics`, then confirm the live bundle changed.
5. Run the client wall check and the main page checks against production.

If the pages break, roll back in Vercel within minutes. Database changes do not roll back cleanly, which is why steps 1 and 2 exist.

## One-time setup (already done)

- Supabase project `verdanote-staging` in the Goodo Studios org, us-east-2.
- GitHub repo secrets: `STAGING_SUPABASE_PROJECT_ID`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ACCESS_TOKEN`, `STAGING_SUPABASE_DB_PASSWORD`.
- Vercel project `verdanote-staging` (pages shipped with `vercel deploy --prod`) with env vars `STAGING_SITE`, `STAGING_GATE_USER`, `STAGING_GATE_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Domain `staging.verdanote.com` added to the Vercel project. DNS for verdanote.com is at GoDaddy; it needs an `A` record for `staging` pointing at Vercel (value shown in the Vercel project's Domains page).
- Vault secrets (goodo-studios): `STAGING_SUPABASE_*`, `VERDANOTE_STAGING_DB_PASSWORD`, `STAGING_TEST_PASSWORD`, `STAGING_GATE_PASSWORD`.
