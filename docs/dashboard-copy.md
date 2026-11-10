# Old dashboard data in Verdanote staging

Step 5a of the consolidation plan. The old Goodo Studios dashboard (Supabase project `qlvdvpchriyrsjtewwxx`, 35 tables) moves into Verdanote. This page covers the database side: what the migrations add, how staff roles map, and how to run the one-time data copy into staging.

Staging only. Verdanote production (`gwyxaqoaldnaavkjqquv`) is not touched by anything here.

## What the migrations add

Six migrations dated 20261101000001 to 20261101000006.

| Migration | What it does |
|---|---|
| 1 tables | The 32 staff tables, with the columns, constraints and indexes the dashboard ended up with after its 77 migrations |
| 2 staff functions | The functions that bypass row rules (approve and reject applications, approval board and vote changes, clients, shoots, locations, props, shipments, crew, call sheets), now checking the Verdanote staff role. Plus the triggers |
| 3 row rules | Row rules on for every table, no grants for anon, staff only policies, no client access |
| 4 storage buckets | The 12 private media buckets with staff only policies |
| 5 ad code counter | `ad_name_counter`, `peek_ad_code()` and `claim_ad_code()`, staff only |
| 6 role mapping | `dashboard_role_to_verdanote_role()`, `app_user_role_mapping()` and `apply_app_user_role_mapping()` |

### Tables left behind

`public_error_reports`, `upload_url_rate_limits` and `actor_upload_url_rate_limits` stay with the old dashboard. They only support the public forms, which stay at the old address. So do the functions the public links call (`submit_*_application`, `create_*_upload_url`, `get_*board*`, `get_call_sheet`, `cast_*_vote`, `record_public_error`).

### One name changed

Verdanote already has a `creators` table (ad creators). The dashboard's `creators` table is added as `dashboard_creators`. The copy script maps the name. Pages that move later must use the new name.

### Who can do what

| Check | Before (dashboard) | Now (Verdanote) |
|---|---|---|
| Read staff tables | `is_active_user()`, which also let a login with no `app_users` row in | builder or employee |
| Write, run staff functions | `is_active_non_viewer()` | builder or employee |
| Team and client admin | `is_active_admin()` | builder |
| Read `clients`, `deliverables`, `app_users` | any signed-in user | builder or employee |
| Anon | the public form functions only | nothing |
| Client role | not applicable | nothing |

Approving or rejecting an application finds the reviewer's `app_users` row by email (Verdanote logins are a separate pool from the dashboard's). If there is no matching row, `reviewed_by` stays empty and the approval still goes through.

### Role mapping

| Dashboard role | Verdanote role |
|---|---|
| admin | builder |
| producer | employee |
| viewer | none |

Verdanote has no read only staff role, so viewers get no Verdanote role. The plan recommends giving them what they need another way, unless there turn out to be many of them.

`app_user_role_mapping()` shows staff what the mapping would do for each copied person. `apply_app_user_role_mapping()` adds the roles for active people who already have a Verdanote login (matched by email). Only the service role can call it. It never removes a role and never creates a login. It is not run by the copy script.

### Things to set up in staging by hand

`approve_application` and `approve_actor_application` move files between buckets through the Storage API. They need:

1. The `http` extension (the migration creates it).
2. Two vault secrets in the staging project: `storage_signing_project_url` (the staging project URL) and `storage_signing_service_role_key` (the staging service role key). Set them from the vault, never paste them into chat or a file.

### Open point for release

The public application forms and board links stay on the old dashboard, so they keep writing to the old database. New applications and board votes will not show up in Verdanote until those public pages point at it. Decide this before release; a fresh copy of the data at release does not fix it on its own.

The ad name generator calls `peek_ad_code` and `claim_ad_code` without signing in today. After the move it has to sign in as Verdanote staff.

## Made-up test clients (default)

Decision 10 in the consolidation plan: staging gets made-up test clients, not real client data, unless Matthew decides otherwise. `scripts/seed-staging-dashboard.mjs` writes them (four `demo-` clients, deliverables, engagements, eight made-up creators with `@example.test` addresses, creator assignments with overdue, due and later follow-ups, `app_users` rows for the two staging staff logins, and Content Pipeline cards for `demo-glowdrip`). Every row has a fixed id, so a re-run updates the same rows. It refuses any project but `verdanote-staging`.

```bash
hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_SERVICE_ROLE_KEY -- node scripts/seed-staging-dashboard.mjs
```

Run `scripts/seed-demo-account.mjs` and `scripts/seed-staging-users.mjs` first. `demo-glowdrip` is linked to the demo ad account in `client_ad_accounts`, so test client A reads its engagements and its Content Pipeline cards, and nothing from the staff tables.

Status 2026-11-10: staging already holds rows from the real dashboard (23 clients, 816 creators, 253 creator assignments and more, no deliverables). They were loaded before this note was written and no build log entry records the run. Whether they stay or are removed is Matthew's call (decision 10); nothing here removes them.

## Running the data copy

The script `scripts/dashboard-copy.mjs` reads the old dashboard and writes into staging. It is a dry run unless told otherwise.

| Command | What it does |
|---|---|
| `node scripts/dashboard-copy.mjs` | prints the plan. No network, no credentials |
| `... --confirm-source qlvdvpchriyrsjtewwxx` | reads row counts and checksums from both sides and writes the report. Writes nothing to either project |
| `... --confirm-source qlvdvpchriyrsjtewwxx --write --real-client-data-approved` | copies. Only after Matthew decides to put real client data in staging |

Safety rules built in and covered by `scripts/dashboard-copy-lib.test.mjs` and `scripts/dashboard-copy-dryrun.test.mjs` (run with `npm run test:scripts`):

- Dry run by default. `--write` is refused without `--confirm-source` and `--real-client-data-approved`, before any network call. Unknown options are refused.
- The old dashboard is only read, through the Supabase read only query endpoint, which the database runs as `supabase_read_only_user`. The script also refuses anything that is not a select. It uses `SUPABASE_ACCESS_TOKEN` for that endpoint; no dashboard service role key is used.
- The write target is hard wired to the `verdanote-staging` project (`mnvcksbhbvypuiwozvct`). Production and the old dashboard are refused as targets.
- It will not read the old dashboard without `--confirm-source qlvdvpchriyrsjtewwxx`, which is passed only after Matthew confirms the read.
- Credentials come from the vault through `hq secrets exec`. They are never printed or written.
- Triggers are switched off during the load, so values such as `stage_changed_at` are copied, not recomputed.
- Loading is safe to repeat (`on conflict do nothing`). `--replace` (with `--write`) empties the copied staging tables first, except `clients`, which other tables now point at (engagements, client ad accounts, Content Pipeline cards, knowledge, meeting recaps).
- The staging side of each checksum leaves out the made-up seed rows (`SEED_MARKERS` in `scripts/seed-staging-dashboard-lib.mjs`), so a seeded staging can still match the source.

Order of work:

1. Merge the migration PR into `staging` and wait for the `deploy-staging` job to apply it.
2. Set the two vault secrets above in the staging project.
3. Matthew decides decision 10 (real client data in staging or not) and confirms the read of the production dashboard database (project `qlvdvpchriyrsjtewwxx`, read only, through the vault).
4. Run the dry run first, then the copy:

```bash
hq secrets exec --company goodo-studios --only SUPABASE_ACCESS_TOKEN,VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN -- node scripts/dashboard-copy.mjs --confirm-source qlvdvpchriyrsjtewwxx --report dashboard-copy-dry-run.md
hq secrets exec --company goodo-studios --only SUPABASE_ACCESS_TOKEN,VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN -- node scripts/dashboard-copy.mjs --confirm-source qlvdvpchriyrsjtewwxx --write --real-client-data-approved --report dashboard-copy-report.md
```

5. Read the report. Every table must show the same row count and a matching checksum of its rows. The script exits with an error if any table differs.
6. Copy the storage files (see `docs/dashboard-storage-copy-plan.md`).
7. Run the client wall check (`docs/staging.md`) and add the new tables to it.

The report also lists, as counts only, how many people hold each dashboard role and how many already have a staging login, plus a per bucket file and size inventory for the storage copy.

## Tests

- `supabase/tests/dashboard_data_foundation_test.sql` (pgTAP, runs in CI): row rules, no anon or client access, client refused by the staff functions, ad counter, role mapping.
- `scripts/dashboard-copy-lib.test.mjs`: table list and load order agree with the migration, target and source guards, read only enforcement, SQL building.
- `scripts/dashboard-copy-dryrun.test.mjs`: dry run by default, the owner approval gate, refused options, seed rows left out of checksums, `clients` kept by `--replace`.
- `scripts/seed-staging-dashboard.test.mjs`: the seed is made up, refuses non-staging projects, respects the dashboard constraints and carries its seed markers.
- `supabase/tests/dashboard_batch1_test.sql` (pgTAP): the batch 1 tables are staff only, even for a client login linked to the client; the stage follow-up rule; the reworded refusals.
