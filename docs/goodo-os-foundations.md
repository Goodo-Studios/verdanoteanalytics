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

The ClickUp folder of a client is a `source_mappings` row (`provider = 'clickup'`, `kind = 'folder'`, `external_id` = folder id). See "ClickUp (PR 5)" under Connectors for how the sync uses it.

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

## Connectors

### Fireflies (PR 3)

`fireflies-transcript` (staff). POST `{ transcript_id, include_excerpts? }` returns one transcript's metadata (start time, organiser, participants, a content-hash `source_version`) and, when asked, its excerpts: consecutive sentences of one speaker, at most 2,000 characters. Each excerpt is classed clean, personnel, legal or financial by the same word rules Goodo OS uses; only clean excerpts carry text. Shared code in `_shared/fireflies.ts`, a port of Goodo OS `connectors/fireflies`.

Read-only: the only request is the single-transcript GraphQL `query` for the id given. The account's transcript list is never browsed, no mutation is sent, and nothing is stored. Goodo OS's transcript authorization records and meeting recaps are not part of this step; they come with the meeting recap page (wave 4a), which will store what it needs. Without `FIREFLIES_API_KEY` the function answers 503 and makes no request. Staging has no key.

### Slack (PR 4)

`run-slack-jobs` (service role, called by pg_cron every 5 minutes, migration `20261109000006_slack_sends.sql`) turns due reminders into jobs and sends `slack.reminder` and `slack.owner_alert` jobs with `chat.postMessage`. Shared client in `_shared/slack-web-api.ts`, a port of Goodo OS `connectors/slack/webApi.ts`. `enqueue_owner_alert(key, text)` (service role) queues one owner alert for the builder-confirmed `owner_alerts` destination, once per key; integration health (wave 4a) will call it.

It sends only when all three locks hold:

1. The function runs in the production project. Checked in the function code against `SUPABASE_URL`, not in the database, because `scripts/staging-lockdown.sql` rewrites the production ref inside database functions. Anywhere else it answers 409 before touching the database.
2. `outbound_switches` has a row `slack_sends` with `enabled = true`. No row is inserted, so it is off. Only a builder can add or change a switch.
3. `SLACK_BOT_TOKEN` is set. Without it the function answers 503 and sends nothing.

Each send is marked first (`mark_job_sending`). A rejection (bad channel, missing scope) or an unclear answer (timeout, 5xx) puts the job in recovery for staff, so a message is never posted twice automatically; a rate limit retries after Retry-After. The destination is checked again just before sending. Goodo OS's reminder proof by reading channel history is not ported (it needs channel read scopes).

To turn it on in production after the release: a builder adds the Slack channel in `slack_destinations` and confirms it, the bot token is set as `SLACK_BOT_TOKEN`, and a builder inserts `outbound_switches ('slack_sends', true)`. Staging never sends: the cron entry is removed after each push and the function refuses outside production.

### ClickUp (PR 5)

Migration `20261109000007_clickup_client_model.sql`. `sync-clickup-tasks` (service role, GET only against ClickUp) now resolves each ClickUp client folder to a client, not an ad account:

1. An active `source_mappings` row (`provider = 'clickup'`, `kind = 'folder'`), set by staff. A mapping to a missing or inactive client is not followed and not replaced by a name guess.
2. Otherwise the name rules from before (exact, alias, then a 4+ character name contained in the folder name), matched against the names of active clients and of their linked active ad accounts. A folder resolves only when every matching name belongs to one client.

A folder that does not resolve, resolves to two clients, or has a stale mapping is skipped, never read, and listed in the result (`unmatchedFolders`, with `ambiguousFolders` and `staleMappingFolders` saying why). Other result fields: `matchedByMapping`, `matchedByName`, and `clientsWithoutBoardAccount`.

`pipeline_tasks.client_slug` is required. `account_id` is optional and written only when the client has exactly one linked ad account. Rows of a client with no ad account, or with two or more, carry only `client_slug`; `clientsWithoutBoardAccount` lists those clients. The `/pipeline` page (`src/pages/ContentPipelinePage.tsx`, `src/hooks/usePipelineTasks.ts`) loads a client login's board with no account filter, so the client read rule below returns its rows by either key. A login linked to more than one client sees the cards of all of them on one board. Staff keep filtering by the selected ad account (staff have no row limit), including a builder previewing as a client.

The client read rule is `has_role(auth.uid(), 'client') AND (account_id IN (SELECT get_user_account_ids(auth.uid())) OR client_slug IN (SELECT get_user_client_slugs()))`. The staff rule is unchanged. Tests: `supabase/tests/clickup_client_model_test.sql` (client A through both rules, client B none, a `client_members`-only client its own client's rows only, employee and builder all).

`clickup_client_folders` is dropped. The migration first copies its rows into `source_mappings` through `client_ad_accounts`, and stops with an error instead of dropping when a row's ad account belongs to no client, when a row disagrees with an existing folder mapping, or when anything else in the database still references the table. Existing `pipeline_tasks` rows take the client of their ad account; rows whose ad account belongs to no client are removed (the next sync rewrites the table). Before the release, every ad account whose board is in use needs a `client_ad_accounts` row, or a `source_mappings` folder row has to point at its client, otherwise its folder is listed as unmatched.

### Push to ClickUp

`push-brief-to-clickup` (staff: a builder or employee login; clients and the service role get 403) replaces the removed "Push to Coda" and "Create brief in Coda" buttons. The brief editor shows "Push to ClickUp" and the creative detail modal shows "Create brief in ClickUp", for staff only and not while a builder previews the client view. Both open one dialog (`src/components/clickup/PushToClickUpDialog.tsx`) with a picker: an empty asset task, or "New asset task".

- `list`: the client's asset tasks with an empty description in status `assigned` or `brief creation`. Read-only.
- `push` to a task id: the task must be in the client's Project View list, have an asset name and an empty description (description, text content and markdown description all empty). A task that already has a description is refused and nothing is changed, so a strategist's work is never overwritten. Otherwise the brief goes into the description and the status becomes `brief creation`.
- `push` to `new`: creates `{Current month} Asset {next N} - {title}` in the list, with the brief as description and status `brief creation`. N is the highest asset number in the list plus one, across months (lists number assets on from one month to the next). The month is the current month in Los Angeles time.

Only the description and status are written (and the name of a new task); assignees and other fields are left alone. The description is plain markdown: HTML tags are removed and a sub-tag note becomes an italic line, because ClickUp shows tags in a markdown description as raw text. The creative modal adds the creative's name and Meta Ad Library link, as the Coda version did. The client is given as `client_slug` or as an ad account (`account_id`, resolved through `client_ad_accounts`), and its folder is resolved like the sync: a `source_mappings` row first, then the name rules; no folder or two folders is refused. Without `CLICKUP_API_TOKEN` it answers 503 before any database read or ClickUp call. Staging has no token. Rules in `_shared/clickup-brief.ts`; tests in `supabase/functions/push-brief-to-clickup/index.test.ts` and `src/test/pushToClickUp.test.tsx`.

### Verdanote data

Goodo OS reads ad performance from Verdanote over HTTP (`connectors/verdanote/performance.ts`: spend, impressions, clicks and conversions for one ad account, ad and date window). Inside Verdanote that is the same database, so it collapses to direct queries on `creatives` and `creative_daily_metrics`, or the existing `get_period_metrics` and `get_daily_trends` functions, which already check staff role or account membership. No connector function is added.

## Wave A pages (step 4a)

### Integration health

Page `/integration-health` (builder and employee) and staff function `integration-health`. Port of the Goodo OS Integration health page (`src/pages/staff/IntegrationHealth.tsx`) and its overview route (`backend/monitoring/overview.ts`).

Goodo OS stored health observations, incidents and baseline exceptions, written by an owner "evaluate" command run against configured engagement scopes. In Verdanote the connectors write to the same database the page reads, so the check runs on read instead and no table is added. The function reads, with the service role after the staff check: when `pipeline_tasks` was last synced and how many rows it holds, the `slack_sends` switch and confirmed owner alert destinations, the Meta ad sync log (`sync_logs`: runs still going after 30 minutes, failures in the last 24 hours, last completed run), active ad accounts not synced in 48 hours, the `durable_jobs` queue (queued jobs 15 minutes overdue, expired leases, jobs in recovery) and the last 10 owner alert jobs. For each connector secret (`CLICKUP_API_TOKEN`, `FIREFLIES_API_KEY`, `SLACK_BOT_TOKEN`) it reports only whether it is set. It calls no outside service and writes nothing.

ClickUp counts as stale 8 hours after its last sync (the sync runs every 4 hours) and as unconfirmed when it has a token but no synced row. Slack sends being off, or the project not being production, are shown as notes, not problems, because both are expected in staging. Pattern codes keep the Goodo OS names where one exists (`connector.stale`, `connector.unconfirmed`, `queue.recovery`).

Not ported: baseline exceptions (owner-set suppressions with an expiry) and the owner "evaluate" and "acknowledge" commands, because nothing is stored to suppress or acknowledge. Rules in `_shared/integration-health.ts`; tests in `supabase/functions/integration-health/index.test.ts` and `src/test/integrationHealth.test.tsx`.

## Alternatives rejected

**A new `os_clients` table with a uuid id, and the dashboard `clients` folded into it.** Gives a cleaner id, but the eight dashboard tables and the dashboard staff functions (`create_client`, `set_client_*`, `create_shoot` and others) already key on `clients.slug`, so it means either two client ids side by side or rewriting all of them. Not the smallest change.

**Use `ad_accounts` as the client list, and create placeholder ad accounts for clients without one.** Keeps every rule on `get_user_account_ids` unchanged, but puts fake rows into the table that every ad sync, report and the agency dashboard reads, and still leaves the dashboard `clients` list as a second list.

**Store client slugs in `user_accounts.account_id`.** The column has no foreign key, so it would work for `get_user_account_ids` without a new table, but one column would then hold two kinds of id, and every existing client rule compares it with ad account ids. A mistake there leaks across clients.

**Port Goodo OS's identity model as is** (`companies`, `workspace_users`, `client_memberships`, `staff_capability_grants`, `runtime_identities`, command receipts). Built for a separate multi-company server with its own login pool. Verdanote already has one company, one login pool and roles in `user_roles`; carrying the second model would mean two permission systems on the same rows.

**Only derive client access from ad accounts** (no `client_members`). Smallest, but a client with no ad account could never see anything, which is the gap this step is meant to close.
