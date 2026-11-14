# Client and ad account setup for the ClickUp sync

Companion to `docs/clickup-go-live.md`, step 0. Both ClickUp syncs decide which client a ClickUp folder belongs to from three tables, and on production (2026-11-14) all three are empty: `clients` has 0 rows, `client_ad_accounts` has 0, `source_mappings` has 0, while `ad_accounts` has 15 rows (14 active) that no client owns. Until clients exist, every folder is "unmatched" and the sync writes nothing.

There are two ways to fill them. The first is the planned path. The second is the manual path if the dashboard copy is not ready at cutover.

## Path A: the dashboard data copy

`docs/staging.md` release step 7 and `docs/dashboard-copy.md` copy the old dashboard's clients (and the rest of its staff tables) into production. That step is blocked until the copy script gets a production target (known gap in step 7) and owner decision 10 is made. After it runs, go to "Link ad accounts and ClickUp folders" below: the copy fills `clients` but does not link ad accounts to them.

## Path B: create the clients in the app (no database edit)

Adding a client needs a builder or employee login; the Setup tab and its links need a builder. Nothing here uses SQL.

1. Open the Team page, Clients section, "Add a client". Fill in:
   - Client name, spelled as it appears in ClickUp and in the ad account name. The sync compares normalised names, so "Acme" matches a ClickUp folder "Acme" or "Acme - Ending October" (the " - Ending ..." part is dropped).
   - Slug: suggested from the name (lowercase, hyphens). Other tables point at the slug, so treat it as permanent and pick it once.
   - "Does creators" and "Does production" boxes, which decide which service lines the client sees.
   Then "Add client". Check that the client shows as "On the Client overview"; the Team page has a Show/Hide button per client, and the sync reads only active clients.
2. Repeat for every active client. Ending clients (Cattasaurus, Marek, Miracle, Royo) also need a client row if their old tasks should attach to them; they import as read-only.

Rows that come from the dashboard copy are marked as synced and the Team page does not offer to edit their name or service lines.

## Link ad accounts and ClickUp folders

For each client, a builder opens `/clients/<slug>/setup` (also reached from the "Set up" link on the Team page Clients section). The Setup tab has a checklist and two sections.

1. **Ad accounts**: choose the client's ad account and press "Link ad account". An ad account belongs to one client; accounts already linked elsewhere are listed as such. The client's logins see only the accounts linked here. This also drives the Content Pipeline page, which filters by ad account: a client needs exactly one linked ad account for its pipeline cards to show.
2. **ClickUp link**: needed only when the folder name does not match the client name. Paste the ClickUp folder link or id (or pick the folder, once `CLICKUP_API_TOKEN` is set), keep the kind as "folder", add a label, and save. This writes a `source_mappings` row with provider `clickup`. A folder id is in the folder's URL.
3. **Client logins**: invite them from the same tab only when the owner has decided invites go out. Invites stay off until `CLIENT_INVITES_SEND_ENABLED` is set (see `docs/clickup-go-live.md`).

Read-only check from the SQL editor, before and after (counts only):

```sql
select (select count(*) from clients where active) as active_clients,
       (select count(*) from client_ad_accounts) as account_links,
       (select count(*) from ad_accounts where is_active) as active_ad_accounts,
       (select count(*) from ad_accounts a
         where a.is_active and not exists (select 1 from client_ad_accounts l where l.account_id = a.id)) as unlinked_active_accounts,
       (select count(*) from source_mappings where provider = 'clickup' and kind = 'folder' and active) as folder_mappings;
```

Done when `active_clients` is more than 0 and `unlinked_active_accounts` is 0 for every account that belongs to a client.

## Then run the sync and read what it could not match

After the token is set (go-live step 1 and 2), the first `sync-clickup-tasks` answer lists `unmatchedFolders`, `ambiguousFolders` and `staleMappingFolders`. Settle each one:

| Answer | Cause | Fix |
| --- | --- | --- |
| `unmatchedFolders` (internal or ending folder) | No client by that name | Expected for non-client folders; otherwise add the client or a ClickUp link on its Setup tab |
| `ambiguousFolders` | The name matches two clients or ad accounts | Add a ClickUp link for the folder on the right client's Setup tab (a mapping wins over the name) |
| `staleMappingFolders` | A mapping points at a client that is inactive or gone | Fix or remove the mapping on the Setup tab |
| `clientsWithoutBoardAccount` | Client has no linked ad account, or more than one | Link exactly one ad account |

Run the sync again after each change. Nothing here writes to ClickUp.

## What an owner has to provide

- The list of active clients with their exact ClickUp folder names and which ad account each owns (14 active ad accounts exist and none is linked).
- Which clients are ending, so they are created and left read-only.
- A decision on Path A or Path B, and whether client logins get invited at cutover.
