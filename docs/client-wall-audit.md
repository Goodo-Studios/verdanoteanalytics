# Client wall audit, 2026-11-01

Scope: all 73 edge functions in `supabase/functions` (the plan README says 74; the directory and `scripts/deploy-functions.sh` both have 73), the `public` tables on staging, and the staff pages. Staging only. Nothing here touches production.

Every function is classified in `supabase/function-access.json`. This note records what the audit found and changed.

## Counts

| Class | Functions | What it means |
|---|---|---|
| staff | 25 | Refuses client accounts. Needs a staff role (builder or employee), or builder only for `apify-debug`, `clear-media-cache`, `settings`, `user-management`. |
| service | 28 | Only the service-role key gets in (cron jobs, backfills, other functions). |
| secret | 7 | Shared secret, signature or API key (`api`, `webhooks-dispatch`, `ingest-reviews`, `sadie-read`, `vault-extract-webhook`, `vault-slack-events`, `write-brief`). |
| account-scoped | 12 | A client may call it for accounts linked to them. |
| public | 1 | `portfolio`, a public page by slug, limited to accounts that switched it on. |

## Gaps found and fixed (18 functions)

Before this change a client token (a signed-in client account) was accepted by these functions on staging. The first run of `scripts/staging-client-wall-functions.mjs` showed 18 of 60 refusal checks failing. After the changes below all 71 checks pass.

| Function | What a client could do | Fix |
|---|---|---|
| `vault-save`, `vault-save-creative`, `quick-save` | Write into the vault (service-role insert) | Staff gate |
| `vault-ads` | Search the Meta ad library with the org token | Staff gate |
| `vault-search`, `vault-status`, `vault-frame-analyze` | Spend embedding and vision budget, read vault status | Staff gate |
| `vault-slack-connect`, `vault-slack-import` | Store Slack credentials and import channels with the service role | Staff gate |
| `vault-share-item` | Mint or revoke public share links (owner check only) | Mint and revoke need staff. `resolve` stays public by share token |
| `scrape-ad`, `transcribe-ad` | Spend Apify and Deepgram budget | Staff gate |
| `create-coda-brief` | Create rows in the shared Coda doc for any creative | Staff gate |
| `account-taxonomy` | Create, rename and archive Themes and Personas for a linked account (service-role write) | Staff gate for the whole function |
| `creative-library`, `creative-media-archive` | Archive media and build ZIP exports for a linked account (service-role writes) | Staff gate |
| `send-digest` | Digest email built with the service role from `user_preferences.digest_accounts`. A client could list any account id, or leave the list empty (meaning all accounts), and receive other accounts' numbers by email | Accounts are filtered to the caller's linked accounts for non-staff |

## Checked and left as is

- `accounts`, `creatives`, `leaderboard`, `landing-pages`, `entity-report`, `creative-rotation`, `matrix`, `cache-creative-image`, `ad-preview`: ownership checks are in place, and writes are staff only. Clients may read their own accounts. The five that take an account id are probed with a client that has no linked accounts; all refuse.
- `ai-chat`, `client-insights`: read through the caller's own session, so row rules limit them to linked accounts.
- `api`, `webhooks-dispatch`: API key auth, with per-account ownership checks inside.

## Tables

All 78 `public` tables on staging have row rules on. No policy uses `using (true)`. One policy gives any signed-in user read access: `creative_type_menu` (reference list of creative type names, allow-listed). `viral_feed_items`, named in the earlier research note, no longer exists: migration `20260609000001_remove_viral_feed.sql` dropped it.

The client read test seeds a row owned by another account in each table (76 of 78 get one; the two single-row backend state tables cannot take a second row) and confirms a signed-in client sees none of them.

## Database functions callable with the public key: fixed by migration 20261101000020

Found while checking tables. 60 `SECURITY DEFINER` functions in `public` could be executed by the `anon` role (anyone holding the public key in the browser bundle) or `authenticated`. Many take an account id and did not check who was asking. Read-only probe on staging, as an unauthenticated caller and as a client with no linked accounts, for the demo account:

- `rpc_creative_matrix`: returned data to the unauthenticated caller. The client was refused, because the grant to `authenticated` was revoked but the grant to `anon` was not.
- `rpc_entity_report`: returned data to both.
- `get_media_coverage`: returned data to both.
- `get_landing_pages_report`: both callers got past permissions and only stopped on the date window check (the default `PUBLIC` grant was still in place after an earlier migration revoked `authenticated`).
- `get_creative_library`: the unauthenticated caller got past permissions and stopped on the date window check. The client was refused.
- `get_account_metrics`, `get_period_metrics`, `get_daily_trends`, `get_agency_dashboard_summary` check the caller inside and refused.
- Also executable with no check inside: `bulk_update_creative_metrics`, `bulk_update_creative_metadata`, the `claim_*` queue functions and `snapshot_*` functions. These write or lock rows.

What the migration does: for every `SECURITY DEFINER` function in `public` it revokes `EXECUTE` from `PUBLIC`, `anon` and `authenticated` and grants it to `service_role` (edge functions and cron). Three groups keep `authenticated`:

- Browser calls through `supabase.rpc` in `src/`: `create_api_key`, `get_agency_dashboard_summary`, `get_creative_window_aggregates`, `get_daily_trends`, `get_period_metrics`, `get_user_role`. The four reports check staff role or account membership inside. `create_api_key` stores the key against `auth.uid()`, with no role check: any signed-in user, a client included, can create an API key for themselves. That is unchanged and worth a decision.
- Helpers that row rules call (rules run as the caller): `has_role`, `get_user_account_ids`, `owns_ad_library_ad`, `owns_ad_library_board`, `vault_owns_board`, `vault_visible_item_ids`, and `match_items` (the vault-search function uses a user-token client). `board_is_public` and `ad_is_on_public_board` also keep `anon` because public Ad Library board rules apply to signed-out visitors. `has_role`, `get_user_role` and `get_user_account_ids` accept any user id, so a signed-in user who knows another user's id can read that user's role or account list. They cannot be locked down without rewriting every row rule.
- The 48 staff area functions added by migrations 20261101000002, 05 and 06 (create_shoot, approve_application and so on). Each starts with a `has_role(auth.uid(), 'builder' ...)` check, never reaches `anon`, and the test fails if one loses the check.

Every other edge-function call to a locked function goes through a service-role client (checked for all callers of `supabase.rpc` in `supabase/functions`), and `pg_cron` jobs run as `postgres`, so none of them lose access. Trigger functions are not affected: `EXECUTE` is checked when a trigger is created, not when it fires.

Not done: a default that stops new functions from being open. PostgreSQL grants `EXECUTE` on new functions to `PUBLIC`, and a schema-level `ALTER DEFAULT PRIVILEGES` cannot remove that. The global form also changes functions created by extension installs. The pgTAP test is the gate instead: it fails CI when a new `SECURITY DEFINER` function is open to `anon` or `authenticated` without an allow-list entry.

Checks: `supabase/tests/security_definer_grants_test.sql` (CI, with a self-test) and `scripts/staging-function-grants-check.mjs` (staging, calls every exposed function as `anon` and as client B).

Also noted: `moodboards` and `moodboard_items` have a policy for the `public` role that lets anyone read every row flagged shared, without presenting the share token. Same for shared `briefs` and public Ad Library boards. That is how share links work today, so it is listed and not changed.
