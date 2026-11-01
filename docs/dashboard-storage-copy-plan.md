# Copying dashboard media files to Verdanote staging

Plan only. Nothing has been copied yet. This is step 6 of the data foundation work and follows the row copy in `docs/dashboard-copy.md`.

## What has to move

Creator and actor photos and videos live in 12 private Supabase Storage buckets in the old dashboard project. Migration 4 creates the same 12 buckets in Verdanote with the same size limits and file types:

| Bucket | Holds | Limit |
|---|---|---|
| creator-headshots | approved creator headshots | 5 MB |
| creator-family-pet-photos | creator family and pet photos | 5 MB |
| creator-filming-locations | creator filming location photos | 5 MB |
| creator-videos | creator videos and poster frames | 100 MB |
| actor-headshots | actor headshots | 5 MB |
| actor-photos | extra actor photos | 5 MB |
| actor-videos | actor videos and poster frames | 250 MB |
| location-photos | studio location photos | 5 MB |
| creator-application-headshots | headshots from pending creator applications | 5 MB |
| creator-application-videos | videos from pending creator applications | 250 MB |
| actor-application-headshots | headshots from pending actor applications | 5 MB |
| actor-application-videos | videos from pending actor applications | 250 MB |

Database rows keep object paths (`headshot_path`, `storage_path`, `thumbnail_path`, `file_path`), not full URLs. Copying every object to the same bucket and the same path keeps every copied row valid with no rewriting.

## How many files and how big

Not known yet. The data copy report ends with a per bucket inventory (file count and total size) read from the old dashboard, so the size of the job is known before any file moves. Staging storage cost and time scale with that number.

## Method

1. Run after the row copy, so the rows and buckets exist. Migration 4 must be applied first.
2. A script, `scripts/dashboard-storage-copy.mjs`, to be written once the inventory is in. It follows the same rules as the row copy: source is only read, target is hard wired to `verdanote-staging`, refuses production, needs the confirmation flag, credentials from the vault.
3. For each bucket: list objects in the old project (paged), download each object, upload it to the same bucket and path in staging with the same content type. Streamed one file at a time, four at a time in parallel, so a 250 MB video never sits fully in memory.
4. Safe to repeat: skip an object if staging already has the same path with the same size. A failed run resumes where it stopped.
5. Order: headshots and photos first (small, visible in the pages soonest), then videos, then the four application buckets.

### Credentials for reading the old project

Storage has no database style read only role, so one of these is needed. Matthew picks:

1. A service key for the old project stored in the vault under a new name. The script only issues list and download calls, and a test pins that. Simplest, but the key itself can write.
2. A dashboard login with the viewer role. Viewers can read every private bucket (the read policy) but cannot write, so the database rules enforce read only. Needs a dedicated viewer account and its password in the vault.

Recommendation: option 2 if a viewer account can be created quickly, otherwise option 1.

Staging writes use the staging service role key, which is already in the vault as `STAGING_SUPABASE_SERVICE_ROLE_KEY`.

## Checks

- Per bucket: object count and total bytes match between the old project and staging.
- Per object: size matches. For a random 5 percent sample, a content hash matches too.
- In the staging pages, open 10 creators and 10 actors with photos and videos and confirm the media loads.
- No object in staging that is not in the old project (the staging buckets start empty).

## Things to know

- These are real people's photos and videos, copied into staging. Staging is behind a shared password and the bucket policies are staff only, so a client or anon login cannot read them.
- The application buckets are filled by the public forms, which stay on the old dashboard. Anything submitted after the copy needs another run. The same applies to the release copy into production.
- Approving an application moves files from the application buckets into the creator or actor buckets, through the Storage API. Staging needs the two vault secrets listed in `docs/dashboard-copy.md` before approvals work there.
- Do not delete anything from the old project at any point. Its storage stays as the source of truth until release.
