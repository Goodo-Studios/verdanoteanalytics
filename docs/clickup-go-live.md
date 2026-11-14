# ClickUp go-live on production

This is the ordered runbook for connecting production Verdanote (project ref `gwyxaqoaldnaavkjqquv`, www.verdanote.com) to ClickUp. It covers the read-only sync first, then the webhook, then the client Content Pipeline check, then write-back. It names secrets and never holds a value.

State of production when this was written (2026-11-14, read-only checks after the release):

- None of the ClickUp secrets are set: `CLICKUP_API_TOKEN`, `CLICKUP_WEBHOOK_SECRET`, `CLICKUP_WRITEBACK_ENABLED`, `CLICKUP_WRITEBACK_LIST_IDS`. The functions answer quietly: `sync-clickup-tasks` returns 503 `clickup.no_token` every 4 hours, `clickup-writeback` returns 200 with `enabled:false` every minute, `clickup-webhook` returns 401 to anything.
- The tables the sync writes to exist and are empty: `pipeline_tasks`, `pipeline_delivered`, `os_tasks`, `os_task_comments`, `os_clickup_outbox`, `os_sync_runs`. `os_task_statuses` has its 20 seeded rows.
- `clients` has 0 rows, `client_ad_accounts` has 0 rows and `source_mappings` has 0 rows. This matters: both sync functions decide which client a ClickUp folder belongs to from these tables. With no clients, every folder is "unmatched", the pipeline sync writes nothing and its safety check refuses to delete, and `clickup-os-sync` skips every task in the Client Operations space. **Do step 0 first.**

Companion reading: `docs/staging.md` sections "OS-007" and "OS-017", and its release steps 6, 7 and 13.

## What is safe to enable, in order

| Order | What | Sends anything outward? | Writes to ClickUp? |
| --- | --- | --- | --- |
| 1 | `CLICKUP_API_TOKEN`, then the two read-only syncs (steps 2 to 6) | No | No (GET only) |
| 2 | ClickUp webhook and `CLICKUP_WEBHOOK_SECRET` (step 7) | No | No (reads the task named by each event) |
| 3 | Check the client Content Pipeline page (step 8) | No | No |
| 4 | `ANTHROPIC_API_KEY` is already set; `FIREFLIES_API_KEY` for meeting recaps | No messages; recaps read Fireflies | No |
| 5 | Write-back for one test list (step 9) | No | Yes, only to the listed test list |
| 6 | Client invites: `CLIENT_INVITES_SEND_ENABLED`, `RESEND_API_KEY`, SMTP | Yes, email to clients | No |
| 7 | Slack: `SLACK_BOT_TOKEN`, `SLACK_WEBHOOK_URL`, the `slack_sends` switch | Yes, Slack messages | No |

Steps 1 to 4 can be done together and cannot change anything in ClickUp. Do 5, 6 and 7 one at a time, each after the owner says go.

Once `CLICKUP_API_TOKEN` is set, two existing cron jobs start doing real work on their own schedule: `sync-clickup-tasks-4h` (minute 0 of every 4th hour) and `clickup-os-sync-nightly` (07:30 UTC). Both only read ClickUp. `clickup-writeback-every-minute` keeps holding rows because write-back stays off.

## Where each value comes from

| Name | Where the value comes from | Where it goes |
| --- | --- | --- |
| `CLICKUP_API_TOKEN` | A personal API token from ClickUp: avatar menu, Settings, Apps, API Token, Generate. It must belong to a user who can see the three spaces below. Store it in the HQ vault under this name. | Supabase function secret on `gwyxaqoaldnaavkjqquv` |
| `CLICKUP_WEBHOOK_SECRET` | Returned by ClickUp when the webhook is created in step 7. `scripts/register-clickup-webhook.mjs` writes it to a file you name, never to the screen. | Supabase function secret, then the file is deleted |
| `CLICKUP_WRITEBACK_ENABLED` | The word `true`, set by the owner in step 9. | Supabase function secret |
| `CLICKUP_WRITEBACK_LIST_IDS` | The numeric ClickUp list id of one test list, from the list's URL or its "Copy link" menu. | Supabase function secret |
| `CLICKUP_WRITES` and `CLICKUP_WRITE_ALLOWED_LIST_IDS` | Optional second lock, see step 9. | Supabase function secret |

Workspace ids used by the code: team `90141422254`; spaces Client Operations `90146671303`, Production Team `90147169333`, Social Media Plan `90149054875`.

Set a secret without showing it. The value stays in the vault and the shell only passes it through:

```bash
hq secrets exec --company goodo-studios --only CLICKUP_API_TOKEN -- sh -c 'supabase secrets set "CLICKUP_API_TOKEN=$CLICKUP_API_TOKEN" --project-ref gwyxaqoaldnaavkjqquv'
```

Running containers do not read a new secret. After every `supabase secrets set` or `supabase secrets unset`, redeploy each function that reads it (step 2 lists them).

## Step 0. Clients must exist first

Both syncs match a ClickUp folder to a client in this order: a `source_mappings` row (provider `clickup`, kind `folder`, `external_id` = the ClickUp folder id), then the folder name against `clients.name` and the names of the client's linked ad accounts. A folder that matches no client, or more than one, is skipped and listed in the sync answer. A trailing " - Ending ..." part of the folder name is stripped before the name is compared, and a few folder names are mapped to ad account names by an alias table in `supabase/functions/_shared/clickup-pipeline.ts`.

Do one of these before the first sync:

1. Run the old dashboard data copy (`docs/staging.md` release step 7, `docs/dashboard-copy.md`). That step also needs its production-target change, which is listed there as a known gap, and open decision 10. This fills `clients`.
2. Or have a builder create the client rows in the app, then link each ad account to its client (this fills `client_ad_accounts`).

Then add a `source_mappings` row for any folder whose name does not match its client by name.

Check (read-only, run in the Supabase SQL editor or through the management API):

```sql
select (select count(*) from clients where active) as active_clients,
       (select count(*) from client_ad_accounts) as account_links,
       (select count(*) from ad_accounts where is_active) as active_ad_accounts,
       (select count(*) from source_mappings where provider = 'clickup' and kind = 'folder' and active) as folder_mappings;
```

Go on when `active_clients` is greater than 0. A client with no linked ad account still syncs, but its rows carry no `account_id` and the `/pipeline` page, which filters by ad account, will not show them (the sync answer lists these in `clientsWithoutBoardAccount`).

Also note the four ending clients (Cattasaurus, Marek, Miracle, Royo) are imported into `os_tasks` as read-only rows when they resolve to a client row; they need a `clients` row to be attached, otherwise their rows get no client.

## Step 1. Put the token in the vault and on production

1. Generate the personal token in ClickUp (see the table above) and store it in the HQ vault as `CLICKUP_API_TOKEN`. Do not paste it into chat, a file in the repo or a ticket.
2. Set it on production with the command above.

## Step 2. Redeploy the functions that read it

These six read `CLICKUP_API_TOKEN`: `sync-clickup-tasks`, `clickup-os-sync`, `clickup-webhook`, `clickup-writeback`, `push-brief-to-clickup`, `clickup-folders`. From the repo root:

```bash
SUPABASE_PROJECT_ID=gwyxaqoaldnaavkjqquv supabase functions deploy sync-clickup-tasks --project-ref gwyxaqoaldnaavkjqquv
```

Repeat for the other five names. Confirm they are `ACTIVE` with a new version:

```bash
supabase functions list --project-ref gwyxaqoaldnaavkjqquv
```

## Step 3. First pipeline sync (read-only)

`sync-clickup-tasks` reads the Client Operations space, keeps asset tasks from each client's "Project View" list, and fills `pipeline_tasks` (current board plus work delivered in the last 30 days) and `pipeline_delivered` (delivered up to a year back). Run it first because its answer names every folder that did not match a client.

Call it with the service role key, passed through the vault and never printed:

```bash
hq secrets exec --company goodo-studios --only VERDANOTE_NEW_SUPABASE_URL --only VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY -- sh -c 'curl -sS --max-time 300 -X POST "$VERDANOTE_NEW_SUPABASE_URL/functions/v1/sync-clickup-tasks" -H "Authorization: Bearer $VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{}"'
```

Read the answer:

- `success: true`, `matchedFolders` greater than 0 and `upserted` greater than 0 is a good run.
- `unmatchedFolders`, `ambiguousFolders`, `staleMappingFolders`: fix with `source_mappings` rows or by renaming a client, then run again. Ending clients and internal folders are expected to be unmatched.
- `deleteSkipped: true` is normal on the first run. The delete of old rows is skipped when more than half the folders are unmatched, when a folder failed to read, or when nothing was collected.
- `unknownStatuses` lists ClickUp statuses that have no client-facing column. Those tasks are left off the board until the status map in `supabase/functions/_shared/clickup-pipeline.ts` is extended (a code change through a PR).
- `503` with `state: "clickup.no_token"` means the secret is not set or the function was not redeployed (steps 1 and 2).

## Step 4. First full copy into os_tasks (read-only)

`clickup-os-sync` copies every task in the three spaces into `os_tasks`, adds unknown statuses with stage `Other`, reads comments, and records the run in `os_sync_runs`. It can run for several minutes. The nightly cron job allows 300 seconds.

```bash
hq secrets exec --company goodo-studios --only VERDANOTE_NEW_SUPABASE_URL --only VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY -- sh -c 'curl -sS --max-time 400 -X POST "$VERDANOTE_NEW_SUPABASE_URL/functions/v1/clickup-os-sync" -H "Authorization: Bearer $VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"mode\":\"full\"}"'
```

If the call times out on your side, do not start another one. Look at `os_sync_runs` (below) and wait for the row to finish.

## Step 5. Check that the tables filled

Read-only queries:

```sql
-- pipeline board and delivered history
select stage, count(*) from pipeline_tasks group by 1 order by 2 desc;
select client_slug, count(*) as board_rows, count(*) filter (where account_id is null) as no_board_account from pipeline_tasks group by 1 order by 2 desc;
select count(*) as delivered_rows from pipeline_delivered;

-- os_tasks: all spaces, clients attached, ending clients read-only
select count(*) as total,
       count(*) filter (where client_slug is not null) as with_client,
       count(*) filter (where read_only) as read_only_rows,
       count(*) filter (where is_stuck) as stuck
from os_tasks;
select status, count(*) from os_tasks group by 1 order by 2 desc limit 20;
select count(*) as comments from os_task_comments;

-- statuses the sync had to add
select * from os_task_statuses where stage = 'Other';

-- the runs themselves: one row per run, ok true when clean
select kind, started_at, finished_at, ok, discrepancy_count, left(coalesce(error, ''), 200) as error, counts
from os_sync_runs order by started_at desc limit 5;
```

Expected: `pipeline_tasks` and `os_tasks` both greater than 0, the latest `os_sync_runs` row has `ok = true`, and `with_client` is most of the Client Operations tasks. A large `no_board_account` count means clients without exactly one linked ad account (step 0).

Also open Integration health in the app as a builder. The ClickUp connector should leave its "not connected" state.

## Step 6. Cron jobs take over

Nothing to do. Confirm the next scheduled runs succeed:

```sql
select jobname, schedule, active from cron.job
where jobname in ('sync-clickup-tasks-4h', 'clickup-os-sync-nightly', 'clickup-writeback-every-minute');
```

After the next 4-hour mark, a new `pipeline_tasks.synced_at` newer than the manual run shows the cron path works. After 07:30 UTC the next day, `os_sync_runs` has a `nightly` row. A nightly run also records every field where the app differs from ClickUp in `os_sync_discrepancies`; read those before write-back is ever turned on.

## Step 7. Register the ClickUp webhook

The webhook keeps `os_tasks` current between syncs. It only reads: for each event the function reads the task from ClickUp and upserts it. `taskDeleted` removes the app row unless it is a read-only ending-client row. An event is accepted only when its `X-Signature` matches `CLICKUP_WEBHOOK_SECRET`; until that secret is set every event gets 401.

1. Dry run. This lists the team's webhooks and says what it would do; it creates nothing. Staging may already have one for its own URL, which is a different endpoint and is left alone.

   ```bash
   hq secrets exec --company goodo-studios --only CLICKUP_API_TOKEN -- env CLICKUP_TEAM_ID=90141422254 WEBHOOK_ENDPOINT=https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/clickup-webhook node scripts/register-clickup-webhook.mjs
   ```

2. Create it. The signing secret goes only to the file named in `WEBHOOK_SECRET_OUT` (mode 600, never printed). Use a path outside the repo.

   ```bash
   hq secrets exec --company goodo-studios --only CLICKUP_API_TOKEN -- env CLICKUP_TEAM_ID=90141422254 WEBHOOK_ENDPOINT=https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/clickup-webhook WEBHOOK_SECRET_OUT=/tmp/clickup-webhook-secret.txt node scripts/register-clickup-webhook.mjs --create
   ```

3. Store the secret in the vault as `CLICKUP_WEBHOOK_SECRET` from that file, set it on production, delete the file, and redeploy:

   ```bash
   hq secrets exec --company goodo-studios --only CLICKUP_WEBHOOK_SECRET -- sh -c 'supabase secrets set "CLICKUP_WEBHOOK_SECRET=$CLICKUP_WEBHOOK_SECRET" --project-ref gwyxaqoaldnaavkjqquv'
   rm /tmp/clickup-webhook-secret.txt
   supabase functions deploy clickup-webhook --project-ref gwyxaqoaldnaavkjqquv
   ```

   Do these three steps back to back. ClickUp posts events as soon as the webhook exists, and each one gets 401 until the secret and the redeploy are in place. A webhook that fails repeatedly is marked unhealthy by ClickUp; re-run the dry run to read its `status`.

4. Verify. Change a harmless field on one task in ClickUp (for example a comment on a test task), then:

   ```sql
   select kind, started_at, ok, counts from os_sync_runs where kind = 'webhook' order by started_at desc limit 5;
   ```

   A `webhook` row with `ok = true` and the task's new value in `os_tasks` means it works. The webhook run can also be seen unsigned: `curl -i -X POST <endpoint>` must answer 401.

The script never changes or deletes an existing webhook or any task.

## Step 8. Check the client Content Pipeline page

1. In the app, sign in as a client login that is linked to one ad account and has `client_ad_accounts` and `clients` rows. Production has one client login today. Do not create test accounts; ask the owner which real client login to use, or use an invited login after step 11 of `docs/staging.md`.
2. Open `/pipeline`. It should show the five client-facing columns with that client's cards, and an "Updated ... ago" line close to the time of the last sync.
3. Confirm the wall. The client sees only its own cards: compare the card count with `select count(*) from pipeline_tasks where client_slug = '<slug>'`. A client must never see another client's card, a creator task, or a meeting-call or guideline task. Run the client wall check from `docs/staging.md` release step 12 and treat any failure as a stop.
4. As a builder, open Integration health and confirm the ClickUp connector shows a recent successful sync.

If the board is empty for a client that has ClickUp work: check `unmatchedFolders` in the last sync answer, then `no_board_account` (the client needs exactly one linked ad account), then `unknownStatuses`.

## Step 9. Write-back (off until the owner says go)

Write-back sends changes made in the app (status, due date, strategist, producer, editor, description, priority, start date, custom fields, comments, client decisions) to ClickUp. Everything is queued in `os_clickup_outbox`. Changes made by the sync or the webhook are never queued.

How rows are treated while it is off: each cron run marks every queued row `held` with a reason and does not call ClickUp. `held` rows are not sent later. If write-back is turned on afterwards, the old held rows stay held; only changes made after it is on are sent. To send an old change, make the edit again.

A row is sent only when all three hold:

1. `CLICKUP_WRITEBACK_ENABLED` is `true`;
2. the task's list id is in `CLICKUP_WRITEBACK_LIST_IDS` (comma separated, empty means every row is held);
3. the write guard allows the list. On production the guard allows everything unless `CLICKUP_WRITES` is `off`. Recommended second lock for the first trial: set `CLICKUP_WRITES=off` and `CLICKUP_WRITE_ALLOWED_LIST_IDS=<same test list id>`, so a typo in `CLICKUP_WRITEBACK_LIST_IDS` cannot reach a client list.

To turn it on for one test list:

1. Pick a ClickUp list that is not a client's Project View list. Note its numeric id.
2. Set `CLICKUP_WRITEBACK_ENABLED=true` and `CLICKUP_WRITEBACK_LIST_IDS=<list id>` (and the second lock above) with the same `supabase secrets set` pattern as step 1.
3. Redeploy `clickup-writeback` so it reads them: `supabase functions deploy clickup-writeback --project-ref gwyxaqoaldnaavkjqquv`. The existing cron job `clickup-writeback-every-minute` then sends due rows.
4. Make one edit to a task in that test list in the app (for example change its due date). Watch it:

   ```sql
   select state, kind, field, attempts, left(coalesce(last_error, ''), 120) as last_error, created_at, sent_at
   from os_clickup_outbox order by created_at desc limit 10;
   select enabled, allowed_list_ids, blocked_reason, last_run_at, last_counts from os_clickup_writeback_state;
   select kind, field, winner, created_at from os_clickup_clashes order by created_at desc limit 10;
   ```

   Expected: the row goes `queued`, then `sent`, and the value shows in ClickUp. Integration health also shows the write-back counts to builders.
5. Behaviour to expect: a change older than ClickUp's own last change to the same field is a clash. ClickUp's value is kept, the app row takes it, and the clash is logged in `os_clickup_clashes`. A failed write retries after 1, 5, 15 and 60 minutes, then shows as failed. A 429 waits for ClickUp's reset time. Our own comments are not imported back and the webhook ignores the echo of our own write.
6. Widen `CLICKUP_WRITEBACK_LIST_IDS` one list at a time. Do not include client Project View lists until the nightly `os_sync_discrepancies` are understood.

Turn it off again: unset `CLICKUP_WRITEBACK_ENABLED` (or set it to anything but `true`), redeploy `clickup-writeback`. Rows held while it was off stay held.

## Later: client invites and Slack (off, not part of the ClickUp go-live)

Both send messages to people. Leave them off until the owner decides. Names only:

- Client invites: `CLIENT_INVITES_SEND_ENABLED=true`, `RESEND_API_KEY`, and the project's auth email sending (SMTP or the built-in provider). Without `CLIENT_INVITES_SEND_ENABLED=true`, `client-invite` answers a dry run that lists what would be sent and writes and sends nothing; `CLIENT_INVITES_ALLOWED_DOMAINS` (optional) limits sending to listed email domains. Without the auth email setup, `invite-user` fails with "The invite email could not be sent" and leaves no login. Send one invite to the owner's own address first. Redeploy `client-invite`, `invite-user` and `send-digest` after setting secrets.
- Slack: `SLACK_BOT_TOKEN`, `SLACK_WEBHOOK_URL`, and the `slack_sends` switch in the app. `run-slack-jobs` runs every 5 minutes today and answers "the slack_sends switch is off". Setting the token alone sends nothing until the switch is on and a channel is confirmed. Redeploy `run-slack-jobs`, `integration-health` and `system-health-check`.
- Meeting recaps: `FIREFLIES_API_KEY`; redeploy `fireflies-transcript` and `meeting-recaps`. Read-only against Fireflies.

## Rollback

Each step can be undone on its own. Nothing here deletes anything in ClickUp.

- Stop all reads: `supabase secrets unset CLICKUP_API_TOKEN --project-ref gwyxaqoaldnaavkjqquv`, then redeploy the six functions in step 2. They go back to the quiet 503 `clickup.no_token` answer, no row changes, and clients keep the last board with its "Updated ... ago" line.
- Stop the cron jobs from running at all (optional; they are quiet without the token): `select cron.unschedule('sync-clickup-tasks-4h');` and `select cron.unschedule('clickup-os-sync-nightly');`. The migrations that create them can re-create them.
- Remove the webhook: delete it in ClickUp (Settings, Integrations, Webhooks, or `DELETE /api/v2/webhook/{id}`; the repo script never deletes one), then `supabase secrets unset CLICKUP_WEBHOOK_SECRET` and redeploy `clickup-webhook`. Without the secret every event gets 401.
- Write-back off: step 9, last paragraph. Rows already sent stay sent in ClickUp; undo those by hand in ClickUp, using `os_clickup_outbox` rows with `state = 'sent'` as the list of what was written.
- Clear synced data (only with the owner's explicit word, and after a backup, because it cannot be undone from the app): `pipeline_tasks` and `pipeline_delivered` rows and `os_tasks` rows with a `clickup_task_id` all refill on the next sync, so clearing them is rarely needed. Never delete `clients`, which other tables point at.

## What to look at in the first days

- `os_sync_runs`: every row `ok = true`; a run with an `error` stops before deleting anything.
- `os_sync_discrepancies` after the first nightly run: fields where the app and ClickUp differ.
- Integration health: the ClickUp connector and the write-back line.
- Edge function logs for `sync-clickup-tasks`, `clickup-os-sync` and `clickup-webhook`: status drift lines ("unmapped statuses") and unmatched folder lines each name what to fix.
