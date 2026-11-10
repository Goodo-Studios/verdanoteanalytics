# Goodo OS foundations in Verdanote (consolidation step 3)

Step 3 of the consolidation plan moves the base that Goodo OS's pages stand on into Verdanote: one client model, engagements, source mappings, Goodo OS users mapped onto Verdanote roles, a job queue with reminders, and the outside connectors (ClickUp, Fireflies, Slack) as Verdanote server functions. The Goodo OS waves (4a to 4d) build on it. Staging only.

This note records the client model and why, then the job queue. The later sections are filled in as each pull request lands.

## The problem: three client lists

| List | Where it came from | Key | What it holds |
|---|---|---|---|
| `clients` | the old dashboard, copied by migration 20261101000001 | `slug` (text) | name, status, strategist, contract dates, scope, notes, one optional `verdanote_account_id`. Eight dashboard tables point at it by `client_slug` (shoots, deliverables, approval boards, assignments and so on) |
| Goodo OS `clients` and `engagements` | Goodo OS's own database (not copied) | text id, scoped by company | client id and active flag; engagements are 45-day cycles with a kickoff date and day 30 and day 45 dates |
| `ad_accounts` and `user_accounts` | Verdanote | ad account id (`act_...`) | the ad account, and which client logins may see it. Every client row rule goes through `get_user_account_ids(auth.uid())` |

A Verdanote "account" is an ad account, not a client. A client with no ad account (work that is not ad performance) has nowhere to hang, so it cannot have a login that sees anything, including the ClickUp-fed Content Pipeline board.

## The design

The dashboard's `clients` table becomes the one client list, and its `slug` is the one client id. New tables reference `clients(slug)` as `client_slug`, the same column name the eight dashboard tables already use.

| Table | Purpose | Who reads | Who writes |
|---|---|---|---|
| `clients` (existing) | one row per client. `slug` is the id | staff | staff (unchanged) |
| `client_ad_accounts` (new) | links a client to zero or more ad accounts. `account_id` is the primary key, so an ad account belongs to at most one client | staff | staff |
| `client_members` (new) | links a client login to a client directly, for clients with no ad account | staff, and a user reads their own rows | staff |
| `engagements` (new) | one row per 45-day cycle. Each is a separate purchase: `cycle_number`, type, status, `start_date`, and `day30_date` and `day45_date` worked out from the start date for a standard sprint | staff, and a client reads the rows of its own client | staff |
| `engagement_notes` (new) | the internal side of an engagement: purchase reference and notes | staff only | staff |
| `source_mappings` (new) | links a client (and optionally one engagement) to an id in an outside system: a ClickUp folder or list, a Slack channel, a Goodo OS client id | staff only | staff |
| `goodo_os_workspace_users` (new) | a copy of Goodo OS's `workspace_users` for the one-time role mapping | builder only | builder, copy script |

### Client access

Client access still starts from `get_user_account_ids`. A new helper, `get_user_client_slugs()`, returns the clients the signed-in user belongs to:

1. clients that own an ad account the user is linked to in `user_accounts` (through `get_user_account_ids(auth.uid())`), so every existing client login sees its client with no new rows, and
2. clients the user is linked to in `client_members`, for clients without an ad account.

It takes no argument and only ever answers for `auth.uid()`, so unlike `get_user_account_ids` it cannot be asked about another user. A client row rule on a client-keyed table reads `has_role(auth.uid(), 'client') AND client_slug IN (SELECT get_user_client_slugs())`. No existing policy or helper changes. Existing account-keyed tables keep their current rules, and the generic wall tests (`rls_enabled_on_all_tables_test.sql`, `no_open_policies_test.sql`, `client_reads_only_own_rows_test.sql`) cover the new tables with no edit. `goodo_os_foundations_test.sql` tests each new table as client A (linked through an ad account), client B (linked only through `client_members`, no ad account), an employee and a builder.

Linking an ad account to a client in `client_ad_accounts` therefore lets every login of that ad account read that client's engagement dates. Only staff can write the link.

### ClickUp folder

The ClickUp folder of a client is a `source_mappings` row (`provider = 'clickup'`, `kind = 'folder'`, `external_id` = folder id). `clickup_client_folders` (folder to ad account, staff-set override) stays as it is until the ClickUp connector pull request, which:

- switches `sync-clickup-tasks` to resolve a folder to a client through `source_mappings`, then to the client's ad account,
- adds `client_slug` to `pipeline_tasks` with a client rule `account_id IN (SELECT get_user_account_ids(auth.uid())) OR client_slug IN (SELECT get_user_client_slugs())`, and makes `account_id` optional, so the board works for a client with no ad account,
- converts any `clickup_client_folders` rows to `source_mappings` rows and drops the table. Staging has none (no ClickUp token).

### Engagements

An engagement belongs to one client. `cycle_number` is unique per client. A standard sprint gets `day30_date = start_date + 29` and `day45_date = start_date + 44`, the same arithmetic Goodo OS uses. `start_date` may be empty while an engagement is planned, and must be set once it is active or closed. A client has at most one active standard sprint. The purchase reference and notes live in `engagement_notes`, which clients never read, because row rules cannot hide single columns from one role while showing them to another.

### Goodo OS users and roles

| Goodo OS role | Verdanote role |
|---|---|
| owner | builder |
| staff | employee |
| client | client, plus `client_members` rows for its Goodo OS client memberships |
| agent | none. Jobs and agents run as the service role |

There is no read-only staff role and none is added (that is Matthew's open decision). Goodo OS users sign in through the old dashboard's login pool, so a person is matched to a Verdanote login by email: the row's own `email`, or the email of the dashboard `app_users` row whose `auth_user_id` equals the Goodo OS `auth_subject`. `goodo_os_user_role_mapping()` (builder only) shows what would happen for each person. `apply_goodo_os_user_role_mapping()` (service role only) adds a role only to a login that has no role yet, and never removes or changes one. A login that already holds a role in the other group (a staff role for a Goodo OS client, or the client role for Goodo OS staff) is reported as a conflict and left alone, so the mapping can never turn a client login into staff. A Goodo OS client membership is resolved to a Verdanote client through a `source_mappings` row (`provider = 'goodo_os'`, `kind = 'client'`). Goodo OS has no client users today, so in practice only staff rows map.

The legacy `clients.verdanote_account_id` column is copied once into `client_ad_accounts` (where the ad account exists) and is not read by anything new. It goes when the dashboard client pages are ported.

## Job queue and reminders (PR 2)

Migration `20261109000005_durable_jobs_and_reminders.sql`. Goodo OS's queue is kept in shape (lease, fence, attempts, recovery, append-only audit, manual resolution) and its multi-company authority layer (runtime identities, capability grants, command receipts) is dropped: in Verdanote only the service role runs jobs.

| Table | Purpose | Who reads | Who writes |
|---|---|---|---|
| `durable_jobs` | one row per unit of outside work. `dedupe_key` makes enqueueing idempotent | staff | queue functions only (service role) |
| `job_audit` | append-only history of every transition | staff | queue functions only |
| `slack_destinations` | Slack channels reminders and owner alerts may go to, with quiet hours | staff | builder (adding or confirming a channel is the owner's call) |
| `reminders` | a message due at a time for one destination; its state follows its job | staff | staff |

Service-role functions: `enqueue_job`, `claim_jobs` (skip locked, lease and fence), `mark_job_sending`, `finish_job`, `fail_job` (retry, or recovery when permanent or out of attempts), `cancel_job`, `enqueue_due_reminders`. Staff functions, each checking `has_role(auth.uid(), ...)`: `replay_job` (recovery back to queued) and `resolve_job_manually` (closes a job after a manual check, never as delivered).

At most once: a worker calls `mark_job_sending` right before it posts to an outside service. If its lease then runs out without a finish or fail, the next claim moves the job to recovery instead of running it again, because the message may already be out. Goodo OS instead reads the Slack channel history to prove absence; that needs channel read scopes and is not ported.

`enqueue_due_reminders` queues only reminders whose destination is active, confirmed by a builder and outside quiet hours (an unknown time zone counts as quiet). It writes to the database only. Nothing in this PR is scheduled: the worker that sends, and the pg_cron entries that call it and `enqueue_due_reminders`, come with the Slack connector behind an off-by-default switch. `scripts/staging-lockdown.sql` removes every cron job after each staging push whatever its name, so later schedules are covered.

## Alternatives rejected

**A new `os_clients` table with a uuid id, and the dashboard `clients` folded into it.** Gives a cleaner id, but the eight dashboard tables and the dashboard staff functions (`create_client`, `set_client_*`, `create_shoot` and others) already key on `clients.slug`, so it means either two client ids side by side or rewriting all of them. Not the smallest change.

**Use `ad_accounts` as the client list, and create placeholder ad accounts for clients without one.** Keeps every rule on `get_user_account_ids` unchanged, but puts fake rows into the table that every ad sync, report and the agency dashboard reads, and still leaves the dashboard `clients` list as a second list.

**Store client slugs in `user_accounts.account_id`.** The column has no foreign key, so it would work for `get_user_account_ids` without a new table, but one column would then hold two kinds of id, and every existing client rule compares it with ad account ids. A mistake there leaks across clients.

**Port Goodo OS's identity model as is** (`companies`, `workspace_users`, `client_memberships`, `staff_capability_grants`, `runtime_identities`, command receipts). Built for a separate multi-company server with its own login pool. Verdanote already has one company, one login pool and roles in `user_roles`; carrying the second model would mean two permission systems on the same rows.

**Only derive client access from ad accounts** (no `client_members`). Smallest, but a client with no ad account could never see anything, which is the gap this step is meant to close.
