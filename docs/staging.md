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
- **Outside accounts are not connected.** The staging project has no Meta, Slack, Resend (email), Apify, Deepgram, Anthropic or OpenRouter secrets. Server functions that need them fail or skip. Verdanote has no Coda code any more (Coda was retired on 2026-10-09; `coda_tasks` and the Coda functions were removed by migration 20261110000001). Attio has no Verdanote server function today. Fireflies has one, `fireflies-transcript` (staff, read-only); staging has no `FIREFLIES_API_KEY`, so it answers 503 there and makes no request. If a later change adds a key to staging, use a test workspace only, never a real one. ClickUp has two. `sync-clickup-tasks` only reads (GET). `push-brief-to-clickup` (staff) writes a brief into an empty asset task or a new one, from the "Push to ClickUp" and "Create brief in ClickUp" buttons. Staging has no `CLICKUP_API_TOKEN`, so `sync-clickup-tasks` answers 503 with the state `clickup.no_token` there (logged under that name, nothing read or written, the same name integration-health shows for the connector) and the `/pipeline` board stays empty unless rows are seeded by hand, and `push-brief-to-clickup` answers 503 and makes no request. Giving staging a real ClickUp token would copy real client task names into staging; that is a decision for Matthew.
- **The site is behind a password.** `middleware.ts` asks for a shared password when the Vercel project has `STAGING_SITE=1`. If the password variable is missing it answers 503 instead of opening up. On production the file does nothing.
- **Test logins only.** The four logins below are made up and exist only in staging. The demo ad account `act_demo_glowdrip` comes from `scripts/seed-demo-account.mjs`, and the `demo-` clients from `scripts/seed-staging-dashboard.mjs`.
- **Staging holds real old-dashboard rows.** Before step 5a, rows were loaded from the old dashboard into staging, with no recorded run: 27 clients (the `demo-` ones included), 816 creators (796 email addresses), 253 creator assignments, 30 approval boards (their tokens still open live boards on the old dashboard), 80 applications, 20 shoots and 4 staff `app_users` rows, plus actor and applicant rows with emails, phone numbers and shipping addresses. They are staff only: client logins read none of them (pgTAP and both wall scripts check it). No Verdanote production data is copied into staging. Whether to keep these rows or remove them and keep only the `demo-` clients is open decision 10 in the plan; nothing has removed them.

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

`deploy-staging` reads only `STAGING_*` secrets. Before it does anything it stops if any of them is empty, if the project id equals the production id, or if the URL does not match the project id. Pushes to `main` still run `deploy-functions` against production exactly as before (server functions only, no migrations). The production E2E job does not run for `staging` pushes or for pull requests into `staging`. A separate job, `e2e-staging`, runs browser tests against the deployed staging site after `deploy-staging` (see "Browser tests on staging").

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

## Browser tests on staging

`e2e-staging/` holds Playwright tests that run against the deployed staging site (`https://staging.verdanote.com`), not a local copy. They run after the staging deploy, never before it, in the CI job `e2e-staging` (`needs: [deploy-staging]`, staging pushes only), and by hand with `npm run test:e2e:staging`. They are separate from `e2e/`, which the production E2E job runs against a local build.

| Spec | What it checks |
|---|---|
| `staff-menu.spec.ts` | As the builder: the seven menu items are there; every section opens, lists all its tabs; every tab (read from `src/lib/sections.ts`, so a new tab is covered without an edit) shows a page heading and logs no console error |
| `staff-tools.spec.ts` | The client switcher changes the client and keeps it on the next page; Ctrl+K opens the search, finds a page and opens it; Escape closes it |
| `client-view.spec.ts` | As client A: exactly the five client items, no switcher or search; every staff route (the clients list, a client hub, Work, the first tab of each section, Admin pages) lands on the client home; the pipeline page shows a cycle group (with "N of M delivered") or the empty state |

Rules the tests follow: no fixed waits (they wait for a heading, a URL or a control), one worker, one retry in CI. Console errors count unless they are on the short allow-list at the top of `e2e-staging/support.ts` or `KNOWN_ON_TAB` in `staff-menu.spec.ts`, each with its reason. Two are listed today, both found by these tests: the CSP in `vercel.json` blocks the Google Fonts stylesheet that `index.html` loads (every page), and blocks a `data:` image fetch on Creative > Creatives. The browser's own "Failed to load resource ... 4xx/5xx" lines are ignored, because staging has no ClickUp, Slack, Fireflies or Resend keys on purpose and a few functions answer 503 there.

The tests refuse to run against production (`playwright.staging.config.ts` throws if the address is `verdanote.com`, `www.verdanote.com` or a `verdanoteanalytics` host).

Sign-in uses the fixed staging logins in the table above and one shared password. To run by hand: `hq secrets exec --company goodo-studios --only STAGING_TEST_PASSWORD,STAGING_GATE_PASSWORD -- npm run test:e2e:staging`. Without `STAGING_TEST_PASSWORD` every test skips with a message that names it.

In CI the job reads two repository secrets that someone with access to the repository settings has to add: `STAGING_TEST_PASSWORD` and `STAGING_GATE_PASSWORD` (same values as the vault secrets of the same names). Until both exist the job passes with a warning, "Staging browser tests skipped", that names what is missing, and runs nothing. The staging pages are shipped by hand, so the job tests whatever pages are live when it runs; ship the pages first when the branch has page changes.

### Growth Dashboard numbers (builder only)

The Growth Dashboard page (`/builder/growth-dashboard`) stores its numbers in `growth_dashboard_data`: the row `state` holds what the old app kept in the browser's localStorage under the key `goodo3m_v1`, the row `plan` holds the plan figures that the old app had written into its code. Only builders can read or write the table (`supabase/tests/growth_dashboard_wall_test.sql`). Nothing real is seeded. To move the numbers once, open goodo-growth-dashboard.vercel.app in the browser that holds them, open the developer console and run `copy(localStorage.getItem('goodo3m_v1'))`, then paste the result on the page's Import tab. Enter the plan figures on the Plan tab.

### Ad Name Generator (builder and employee)

The Ad Name Generator page (`/ad-name-generator`) is the old generator's screen with the same name format. Its codes come from `peek_ad_code` (shows the next code, spends nothing) and `claim_ad_code` (spends one, only when the name is copied) over `ad_name_counter`. Both refuse anyone who is not builder or employee, inside the function body; `scripts/staging-client-wall-functions.mjs` checks that clients are refused and staff can peek. Client and Theme / Persona lists come from `ad_accounts` and `angle_clusters` with the staff session. The old generator and the Goodo OS naming page keep running until the release (step 6 below).

### Goodo OS client model (step 3)

One client list: the dashboard `clients` table, keyed by `slug`. `client_ad_accounts` links a client to zero or more ad accounts, `client_members` links a client login to a client that has no ad account, `engagements` holds one row per 45-day cycle (clients read their own client's rows through `get_user_client_slugs()`), and `engagement_notes`, `source_mappings` and `goodo_os_workspace_users` are staff only (the last builder only). Goodo OS roles map owner to builder, staff to employee, client to client; `apply_goodo_os_user_role_mapping()` (service role) adds a role only to a login with no role. Design and rejected alternatives: `docs/goodo-os-foundations.md`. Tests: `supabase/tests/goodo_os_foundations_test.sql`, plus lines in both staging wall scripts. Nothing real is seeded.

The Content Pipeline board (`pipeline_tasks`) is keyed by client: `client_slug` is required and `account_id` is written only when the client has exactly one linked ad account. `sync-clickup-tasks` resolves a ClickUp folder through a `source_mappings` row (`provider = 'clickup'`, `kind = 'folder'`) first, then by name against clients and their ad accounts. A client reads rows of its linked ad accounts or of its own clients. `clickup_client_folders` is gone (migration 20261109000007). Tests: `supabase/tests/clickup_client_model_test.sql` and lines in `scripts/staging-client-wall-check.mjs`. On `/pipeline` a client login sends no account filter and gets every row its rules allow, so a client with no ad account (`client_members` only) or with several ad accounts sees its board. Staff, and a builder previewing as a client, still pick an ad account. Test: `src/test/pipelineBoardByClient.test.tsx`.

### Client view by cycle (phase 5)

The client board groups work by cycle: the month named in the task ("November Asset 3"). `sync-clickup-tasks` stores it as `pipeline_tasks.cycle_month` (first day of the month, with the year taken from the task's due date, delivery day or creation date) and the delivery day as `delivered_at` (ClickUp closed date, else done date, else last update). A cycle header shows "N of M delivered", a progress bar and, only when exactly one engagement of the client started in that month, that engagement's dates (engagements are readable by the owning client). Delivered work newer than 30 days stays in `pipeline_tasks`; older delivered work, up to a year back, is kept in `pipeline_delivered` (migration 20261113000001: client-safe fields only, staff and the owning client read, nobody writes from the browser, written by the sync) so past cycles keep their finished tasks. It is a separate table because the staff Home page reads every `pipeline_tasks` row in one request and a year of finished work there would pass the 1000 row limit of that request. A client with no ad account but a `client_members` link lands on `/pipeline`. Tests: `supabase/tests/pipeline_delivered_test.sql`, `src/test/pipelineCycles.test.ts`, `src/test/pipelineCyclesView.test.tsx`, `src/test/waitingOnYouLine.test.tsx`, the Deno tests of the sync, and a "Client view by cycle" block in `scripts/staging-client-wall-check.mjs` (page queries as client A and B, own cycles only, field level, no writes). `node scripts/seed-staging-dashboard.mjs` seeds this month's board plus two earlier cycles for `demo-glowdrip` and delivered work for `demo-northwind` (which client A must not see).

### Job queue and reminders (step 3)

`durable_jobs`, `job_audit`, `slack_destinations` and `reminders` (migration 20261109000005) are staff only. Jobs are written only through the service-role queue functions; staff can replay or close a job in recovery. Only a builder can add or confirm a Slack destination. The worker that sends is `run-slack-jobs` (cron every 5 minutes, removed on staging by the lockdown). It refuses with 409 outside the production project, does nothing while the `outbound_switches` row `slack_sends` is missing or off (no row exists), and answers 503 without `SLACK_BOT_TOKEN`. Staging has neither a switch row nor a token. Tests: `supabase/functions/run-slack-jobs/index.test.ts`, `supabase/tests/slack_sends_test.sql`. Tests: `supabase/tests/durable_jobs_test.sql`, plus lines in both staging wall scripts.

### Roles from the old dashboard

The dashboard role `admin` becomes `builder` and `producer` becomes `employee`. `user-management` accepts `dashboard_role` in place of `role` when creating or updating a user; since step 5d it reads the mapping from `staff_role_mappings` (`mapDashboardRoleWith` in `supabase/functions/_shared/dashboard-role-map.ts`) and refuses a row that still waits on the owner. Staff are managed on the Team and settings page (`/team`); Settings > Admin keeps every login, including client logins and their accounts. A dashboard `viewer` is refused: Verdanote has no read-only staff role, and adding one is Matthew's decision (see the role mapping research note in the consolidation project).

### One staff list (step 5d)

The mapping is data since migration 20261111040001: `staff_role_mappings` holds admin -> builder, producer -> employee and viewer -> employee with `needs_owner_decision` set. A flagged row is shown and proposed but never applied (`dashboard_role_to_verdanote_role` returns null for it), so viewers still get no role until the owner decides and a builder clears the flag. `staff_reconciliation()` (builder only) lists every team list member (`app_users`) and every staff login, matched by exact email with case and spaces ignored, with the mismatches: `no_login`, `client_login`, `no_staff_role`, `role_differs`, `mapping_needs_owner`, `inactive_with_staff_role`, `not_on_team_list`, `possible_name_match`. Nobody is merged by name. Invites are prepared in `staff_invites` and never sent from Verdanote. Counts only, no personal data: `node scripts/staff-reconciliation-report.mjs` (same secrets as the wall check). Tests: `supabase/tests/staff_team_reconciliation_test.sql`, lines in both staging wall scripts.

## Releasing staging to production

This is one-way for the database. Get Matthew's sign-off first, and do not start while any decision in "Owner decisions still open" below blocks a step you are about to run. Production is project `gwyxaqoaldnaavkjqquv`, site www.verdanote.com. At the time of writing `staging` is 71 commits and 42 migrations ahead of `main`, and `main` is not ahead of `staging`.

Each step has a rollback note. A database change does not roll back cleanly, so the rollback for most database steps is "fix forward with a new migration, or restore the step 1 backup". The pages roll back in Vercel within minutes.

### Step 0. Release the client-data fix first, on its own (recommended)

Migration `20261111060001_ad_accounts_client_column_wall.sql` closes a client-data hole: a client login could run `select * from ad_accounts` with its own token and read every column of its linked accounts (AI prompts, kill and scale thresholds, attribution notes, targets and the TikTok access token). It does not depend on the rest of staging, so do not wait for the full release.

1. Put the fix on `main` by itself: cherry-pick the commit `f9e775c` (PR #192) onto a branch cut from `main` and open a PR into `main`. It carries the `accounts` function change (`_shared/client-account-fields.ts`, `accounts/index.ts`), `function-access.json`, the migration, its pgTAP test and the two wall script lines.
2. Merge it. CI ships the `accounts` function to production. Confirm the deploy run concluded `success` before step 3.
3. Only then apply the migration by hand: `supabase db push` against `gwyxaqoaldnaavkjqquv` with only this migration pending (or run the file). The order matters: the migration drops the client row rule, and the previous `accounts` function may read through the caller's own session, so a client could see an empty account list if the rule went first. The new function checks the `user_accounts` link and returns only the allow-listed columns.
4. Check on production: sign in as a client, open Overview and Creatives (accounts still list), and run the client wall check (step 12) with a production client test login.

Rollback: re-create the dropped policy `"Client can view linked accounts"` on `public.ad_accounts` (its definition is in the git history of the migration that created it), then redeploy the previous `accounts` function. Do this only if client pages break; the hole it re-opens is the reason for the fix.

If step 0 was done, skip `20261111060001` in step 4 below (it is already applied).

### Step 1. Backup

Take a fresh backup of the production database and note its time. Confirm a restore point exists in the Supabase dashboard.

Rollback: this is the rollback for every database step below.

### Step 2. Rehearse

Copy production into a scratch Supabase project, apply every staging migration to it in filename order, and confirm none fails. Run the pgTAP suite against it (`supabase test db`). Run the data copy (step 7) against the scratch project if the script has a scratch target.

Rollback: delete the scratch project. Nothing touches production.

### Step 3. Merge staging into main (functions ship)

Merge `staging` into `main`. CI runs `deploy-functions`, which ships every server function to production and smoke-tests them. CI does not apply database changes and does not delete functions. Confirm with `gh run view <id> --json conclusion` that the run on the merge commit is `success`.

Rollback: revert the merge on `main`; CI redeploys the previous versions of the functions that existed before. A function that is new in this release stays deployed after a revert: delete it by hand (`supabase functions delete <name> --project-ref gwyxaqoaldnaavkjqquv`).

### Step 4. Apply the migrations in order

Apply every migration newer than production's last, in filename order, with `supabase db push` against `gwyxaqoaldnaavkjqquv` after the rehearsal passed. Run `supabase migration list --linked` first: the production ledger has entries with no file, so read the pending list and stop on the first error instead of using flags that skip history. The `ciWorkflow` test keeps CI from pushing migrations to production until that ledger is reconciled.

Migrations that need a decision or a check on the way:

- `20261111060001_ad_accounts_client_column_wall.sql`: the client-data fix. Already applied if step 0 was done.
- `20261111040001_staff_team_reconciliation.sql`: the role mapping as data. `viewer` stays flagged and unapplied until the owner decides (decision 2).
- `20261112000003_scheduled_checks.sql`: creates the two production-only cron jobs (step 13).
- `20261113000001_pipeline_cycles.sql`: `pipeline_tasks.cycle_month` and `delivered_at`, and the `pipeline_delivered` table. Safe to apply before the ClickUp token is set; the board stays as it was until the sync runs.
- The migration that removes `coda_tasks` and the `sync-coda-names-daily` cron job (`20261110000001`): see step 14.

Rollback: no clean rollback. Fix forward with a new migration. If data was damaged, restore the step 1 backup (this also loses writes made since).

### Step 5. Confirm the functions

Compare `supabase functions list --project-ref gwyxaqoaldnaavkjqquv` with the folders in `supabase/functions`. Run `scripts/smoke-test.sh` against production (CI did this at step 3). Functions that need a secret answer 503 until step 6 sets it; that is expected.

Rollback: as step 3.

### Step 6. Set the secrets

Set each from the vault, never typed into a chat or a file. Names only here. After each `supabase secrets set`, force a redeploy of the functions that read it (`supabase functions deploy <name>`): running containers do not pick up a new secret on their own.

| Secret | Read by | What breaks quietly without it |
|---|---|---|
| `CLICKUP_API_TOKEN` | `sync-clickup-tasks`, `push-brief-to-clickup`, `clickup-folders` | The sync answers 503 `clickup.no_token` and Integration health shows it, but a client keeps the last good board with an "Updated ... ago" line, so a client sees a board that is going stale without being told. The ClickUp folder picker and the Push to ClickUp buttons fail (a pasted folder id still works). |
| `FIREFLIES_API_KEY` | `fireflies-transcript`, `meeting-recaps` | Meeting recaps cannot pull transcripts (503). No recap appears and nothing else says why. |
| `ANTHROPIC_API_KEY` | `client-insights`, `meeting-recaps`, `reports`, `vault-analyze`, `agent-evaluations` | `client-insights` answers an empty list with `reason: "ai_key_missing"`, so the client page shows no insights and no error. The other functions fail their AI step. |
| `SLACK_BOT_TOKEN` | `run-slack-jobs`, `integration-health` | `run-slack-jobs` answers 503 and the queue grows; no Slack message goes out. Sending also needs the `slack_sends` switch on and a confirmed channel. |
| Resend, for `send-digest`: `RESEND_API_KEY` | `send-digest` | The weekly digest is generated, returned as HTML, marked as sent, and never emailed. |
| Auth email setup (Supabase Auth, no new secret) | `invite-user` | Invites fail with "The invite email could not be sent" and leave no login. Also needed for password reset mail. Set the project's email sending (SMTP or the built-in provider) and send one test invite to yourself. |
| Storage signing, as database vault secrets `storage_signing_project_url` and `storage_signing_service_role_key` | `approve_application`, `approve_actor_application`, `delete location` photo removal | Approving an application that has files fails with the storage error and changes nothing; deleting a location leaves its photos in storage. |

Also read by some functions and worth checking at the same time: `SLACK_WEBHOOK_URL` (health check and report alerts: without it a failing health check posts nothing) and `META_ACCESS_TOKEN` (the ad sync).

Rollback: `supabase secrets unset <name>` and redeploy the functions that read it. The functions fall back to the missing-key behavior in the table.

### Step 7. Copy the old dashboard data

Run `node scripts/dashboard-copy.mjs` as a dry run first, then the copy, and compare row counts with the old app. Run it again as the final copy after the HQ writers are paused (step 10). Details: `docs/dashboard-copy.md`.

Known gap: the script's write target is hard wired to the staging project and refuses production, so it cannot do this step as it stands. A reviewed change that adds a production target (with its own confirmation flag, a dry run and a test that staging stays refused for production writes) has to land before the release. It also needs decision 10 and the read confirmation of the old dashboard database (`qlvdvpchriyrsjtewwxx`).

Rollback: the load is safe to repeat (`on conflict do nothing`). To undo, empty the copied tables (only those the script created; never `clients`, which other tables point at) or restore the step 1 backup.

### Step 8. Copy the storage files

Run `node scripts/dashboard-storage-copy.mjs` after the row copy, headshots and photos first, then videos, then the four application buckets. Check object counts and bytes per bucket and open 10 creators and 10 actors with media. Anything submitted through the public forms after the copy needs another run. Plan and credential choice (a read-only viewer login is recommended): `docs/dashboard-storage-copy-plan.md`. The two storage vault secrets from step 6 must be set first.

Known gap: like the row copy, the script targets staging only today, so it needs the same production-target change.

Rollback: delete the copied objects (the script report lists them). The old project is only read.

### Step 9. Ad code counter, in one step with no gap

Copy the old dashboard database's counter into production `ad_name_counter` at its latest value (raise only, never lower: `scripts/dashboard-copy.mjs` does this with `greatest`, see `docs/dashboard-copy.md`), and at the same moment switch off the old Ad Name Generator (goodo-ad-name-generator) and the Goodo OS ad naming page. If either keeps issuing codes after the copy, two ads can get the same code. Until the release, staging's counter is a test copy and the old screens stay on.

Rollback: switch the old generator back on only after setting its counter above Verdanote's current value; never let two generators issue codes at once.

### Step 10. Re-point the HQ processes that write client progress

Five HQ processes wrote client progress into the old dashboard database: `scripts/seed-clients.ts` (one shot), and the worker skills `head-of-strategy/run-cycle` (monthly), `editor/deliver` (per delivery), `creative-strategist/sync-performance` (weekly) and `goo-attio-logger/update-client-knowledge` (per check-in). They now all call one script, `companies/goodo-studios/scripts/sync/push-client-progress.py`, which posts to the `ingest-client-progress` function. The target is staging unless `VERDANOTE_INGEST_TARGET=production` is set; the token comes from the vault (`STAGING_VERDANOTE_INGEST_TOKEN` for staging, `VERDANOTE_INGEST_TOKEN` for production). The old dashboard write is off unless `DASHBOARD_LEGACY_WRITE=1`.

Checklist (do in order, with the HQ processes paused):

1. Production token. Sign in to production as a builder, open Integration health, "Client progress feed", create a token named for the job (for example `hq-processes`). Copy it from the one-time panel and store it straight away: `pbpaste | hq secrets set VERDANOTE_INGEST_TOKEN --company goodo-studios --from-stdin` (the token is still on the clipboard from the Copy button; never paste it into chat or a file). It cannot be shown again; if it is lost, revoke it and make another.
2. Final copy of the old dashboard data (step 7), so `clients` and `deliverables` hold the latest history before the feed starts.
3. Dry run against production: `hq secrets exec --company goodo-studios --only VERDANOTE_INGEST_TOKEN -- python3 companies/goodo-studios/scripts/sync/push-client-progress.py --target production --seed --dry-run` (prints counts only).
4. Backfill: the same command without `--dry-run`. It sends every active client in one batch (up to 100) and prints how many were applied and refused. A refused client is unknown to Verdanote or was made by hand; fix the roster, do not force it.
5. Switch the target: set `VERDANOTE_INGEST_TARGET=production` where the processes run (the shell environment of the HQ sessions and the crons), and make sure `DASHBOARD_LEGACY_WRITE` is not set.
6. Resume the processes. Confirm one write from each lands: Integration health, "Latest calls", shows the process name, and the client's "Last updated" line changes. Nothing should reach the old database.
7. Revoke any test token left on the page.

What Verdanote derives instead of ingesting: the delivery numbers (delivered N of M, last delivery day) come from the ClickUp tasks that `sync-clickup-tasks` stores, for any month that has tasks. HQ still sends `pct_complete`, status, contract dates, strategist and the `cycle_brief`, `report` and `performance` deliverables, and `delivery` for months with no ClickUp task.

A hand-made client (`origin = 'manual'`) is refused by the feed, as the old sync refused it. `clients.origin = 'coda'` is the legacy name for the clients these processes sync; those clients stay read only on the client page because of it.

Rollback: set `DASHBOARD_LEGACY_WRITE=1` and `VERDANOTE_INGEST_TARGET=staging` to point the processes back at the old database, and revoke the production token. Rows written to Verdanote in between are copied back by hand, so keep a note of when each process was switched.

### Step 11. Ship the pages

From `repos/private/verdanoteanalytics`: `vercel --prod --yes`. Then verify the live bundle changed (the served JS chunk or the asset hash differs from before). Do not report the pages live off the merge alone: CI ships functions, not pages.

Rollback: promote the previous deployment in Vercel (instant rollback).

### Step 12. Check production

Run the client wall check and the main page checks against production with a production client test login and a staff login. The browser tests in `e2e-staging/` refuse production by design; check the same list by hand (every menu item and tab, the switcher, Ctrl+K, a client login sees five items and is sent away from staff routes, the client pipeline page). Run `staff_reconciliation()` (step 15).

Rollback: if the wall check fails, roll the pages back first, then investigate. A wall failure is a stop.

### Step 13. Cron jobs (production only)

Two scheduled jobs exist only in production because they need `pg_cron`, `pg_net` and the vault service role key. Migration `20261112000003` creates them: `check-operating-budgets-daily` (13:15 UTC daily) and `check-integration-alerts-30m` (every 30 minutes). Confirm with `select jobname, schedule, active from cron.job order by jobname;` and that the first run shows in the "last run" line on Operating costs and Integration health (`check_runs`). `run-slack-jobs` (every 5 minutes) is also created by an earlier migration and does nothing until the `slack_sends` switch is on. The staging lockdown script never runs against production.

Rollback: `select cron.unschedule('<jobname>');`.

### Step 14. Delete the three Coda functions and the Coda secret

Verdanote has no Coda code any more. The plan's last record (build log for PR 152, 2026-11-09) says `sync-coda-tasks`, `sync-coda-names` and `create-coda-brief` are still deployed in production and staging, that CI does not delete functions, that migration `20261110000001` removes `coda_tasks` and unschedules `sync-coda-names-daily` on production when applied, and that removing `CODA_API_KEY` is Matthew's call. The plan does not record that any of this ran on production. Check the current state read only first (`supabase functions list`, `supabase secrets list`, `select jobname from cron.job where jobname ilike '%coda%'`), then delete the three functions with `supabase functions delete` and, with Matthew's word, unset the Coda secret. Do not write to Coda for any reason.

Rollback: a deleted function comes back by redeploying it from the git history before PR 150. The secret value comes back from the vault copy if one exists.

### Step 15. Staff list

Run `staff_reconciliation()` on production and settle every row with the owner. Prepared invites in `staff_invites` are a list, not sent mail: send them by hand only after the owner has decided the role mapping (decision 2) and the staff list (decision 3). Staff who are not on the dashboard team list see every owner's follow-ups until they are added on `/team`.

Rollback: invites can be revoked on `/team` (removes a login that never accepted).

### Step 16. Redirects from the old dashboard

Turn the redirects on only after step 12 passes. The old apps stay up, read-only, for a while in case anything was missed. Public links (approval boards, casting, location boards, call sheets, application forms) stay on the old address unless decision 4 moves them with permanent redirects; if they move, the old links must keep redirecting forever. The Goodo OS site redirects page by page once each page is checked; after the release its server on Railway and its database are retired.

Rollback: remove the redirect rule. The old pages are still there.

### Owner decisions still open

From the plan's "Decisions for you". Decision 1 (port everything) is decided. The rest are open as of the plan's last update:

- 2. Roles: producers and viewers become employee, or get new roles. A builder records it on `/team`.
- 3. Staff list: who gets builder or employee (15 people). Needed before invites go out.
- 4. Public links stay on the old address (recommended) or move with permanent redirects. Decides whether step 16 and the public forms need work.
- 5. Growth Dashboard audience (you, or leadership).
- 6, 7, 8. Creative Vault, Content Leaderboard and Keep-in-Touch CRM: fold in, link, or drop.
- 9. Retire old pages as each new page is checked, or leave both up for a set time.
- 10. Real client data in staging: keep the real rows already there, or remove them and keep only `demo-` clients. Blocks the production-target change for the copy scripts and the real BIDs.
- 11. One release (the stated direction) or batches. Step 0 is the first batch if you choose batches, and is recommended either way.
- Also open: whether `CODA_API_KEY` is removed (step 14), whether `.env` should leave git (it is tracked and uploaded with every `vercel deploy`), and the read confirmation of the old dashboard database.

## Photo and video upload (phase 6b)

Staff add and delete creator, actor and location media in Verdanote: the creator and actor pages (headshot, videos, photos, filming locations) and the location editor (photos, with "Set as main photo"). The browser asks storage for a signed upload link with the staff member's own login, sends the file straight to it with a progress bar, then adds the row. Nothing goes through the vault secrets, so uploads and deletes work on staging today.

- Layout: new files are `<owner id>/<headshot|video|photo|location>-<uuid>.<ext>` in the same buckets and tables as the copy from the old dashboard (`approve_application` uses `<id>/headshot-<name>` and `<id>/video-<name>`), so old and new files sit side by side.
- Limits: the buckets' own. Photos JPG, PNG or WebP up to 5 MB; videos MP4 or MOV, creator videos up to 100 MB, actor videos up to 250 MB. The database caps are 10 creator videos, 8 actor videos and 8 actor photos.
- Clients: refused by the staff write policy on each bucket and by the row rules on each table. `supabase/tests/dashboard_media_upload_test.sql` proves it, and the "Media upload and delete" block of `scripts/staging-client-wall-check.mjs` repeats it on staging with a throwaway creator, actor and location and one tiny file per bucket, all deleted at the end.
- Two actions still need the vault secrets `storage_signing_project_url` and `storage_signing_service_role_key`: approving an application that has files and deleting a location that has photos (they copy and remove files through `storage_admin_request`). Without them both stop, change nothing and say so in plain words. Integration health lists the two names as set, missing or "could not check" (`storage_signing_secrets_present()`, service role only; names and true or false, never a value).

## One-time setup (already done)

- Supabase project `verdanote-staging` in the Goodo Studios org, us-east-2.
- GitHub repo secrets: `STAGING_SUPABASE_PROJECT_ID`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ACCESS_TOKEN`, `STAGING_SUPABASE_DB_PASSWORD`.
- Vercel project `verdanote-staging` (pages shipped with `vercel deploy --prod`) with env vars `STAGING_SITE`, `STAGING_GATE_USER`, `STAGING_GATE_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Domain `staging.verdanote.com` added to the Vercel project. DNS for verdanote.com is at GoDaddy; it needs an `A` record for `staging` pointing at Vercel (value shown in the Vercel project's Domains page).
- Vault secrets (goodo-studios): `STAGING_SUPABASE_*`, `VERDANOTE_STAGING_DB_PASSWORD`, `STAGING_TEST_PASSWORD`, `STAGING_GATE_PASSWORD`.
