# Verdanote Analytics

Meta ad creative analytics platform for DTC brands. Analyze, tag, grade, and optimize creatives with win-rate analysis, kill/scale recommendations, and AI-powered insights.

## Stack

- **Frontend**: React 18 + TypeScript + Vite + shadcn/ui + Tailwind CSS
- **Backend**: Supabase Edge Functions (Deno)
- **Database**: Supabase / Postgres
- **Auth**: Supabase Auth with role-based access (builder / employee / client)
- **Charts**: Recharts
- **Deployment**: Vercel (frontend — **manual**, see [Deployment](#deployment)) + Supabase (backend + DB)

## Environment Variables

Create a `.env.local` file in the project root (see `.env.example`):

```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
```

## Local Development

```sh
# Install dependencies
npm install

# Start dev server (runs on port 8080)
npm run dev

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Run tests
npm run test
```

## Deployment

**The frontend does NOT deploy automatically.** Vercel is not connected to this
repository, so merging a PR to `main` ships nothing user-visible — it only
updates the code. Every production release is a manual CLI deploy:

```sh
vercel --prod
```

Deploy from a **clean checkout of `origin/main`**, not from your working tree.
`vercel --prod` uploads the current directory verbatim, so deploying while
parked on a feature branch silently ships the wrong code:

```sh
git worktree add /tmp/deploy --detach origin/main
cd /tmp/deploy && vercel --prod
```

Because releases are manual, `main` can drift ahead of production for days
without any signal. Check before you deploy — `vercel ls` shows the last
production release, and anything merged since then ships with your change:

```sh
vercel ls              # last production deploy
git log --oneline origin/main   # compare against what's live
```

Edge functions are the exception: CI deploys those automatically on push to
`main` (the `deploy-functions` job in `.github/workflows/ci.yml`). So a merge
*can* change backend behaviour while leaving the frontend untouched — worth
remembering when a change spans both.

### Verify the deploy

CI passing does not mean the deployed site works. `vercel.json` headers,
rewrites, and the CSP never execute in local dev or CI — they exist only on
Vercel, so a broken value passes every gate and fails only in production. This
has happened: a CSP missing `media-src` shipped green and blocked every video in
the app.

After deploying, assert against the live origin:

```sh
curl -sI https://www.verdanote.com/ | grep -i content-security-policy
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://www.verdanote.com/manifest.json
```

## Edge Functions

Edge functions live in `supabase/functions/`. Each is a standalone Deno module.

To deploy a single function:
```sh
supabase functions deploy <function-name>
```

To deploy every function (required whenever `supabase/functions/_shared/` changes — each function bundles its own snapshot of `_shared/` at deploy time):
```sh
./scripts/deploy-functions.sh
```

After any deploy, verify CORS preflight + auth gates with the smoke test:
```sh
./scripts/smoke-test.sh
# or override the project: SUPABASE_URL=https://... ./scripts/smoke-test.sh
```

To set secrets used by edge functions:
```sh
supabase secrets set ANTHROPIC_API_KEY=your_key
supabase secrets set APP_URL=https://your-domain.com
```

## Roles

Three roles are enforced at the URL level and validated against the database:

| Role | URL prefix | Access |
|---|---|---|
| builder | `/builder/` | Full access — all accounts, all data |
| employee | `/employee/` | Internal view — assigned accounts |
| client | `/client/` | Client portal — own account only |

Role is resolved via the `get_user_role` Postgres RPC on login.

**Exception — the phone capture routes are deliberately un-prefixed:**

| Route | Why it has no role prefix |
|---|---|
| `/capture/share-target` | The Android OS opens this path verbatim from the manifest's `share_target.action`. A manifest action is a single fixed path and cannot vary by role. |
| `/capture/quick-add` | Opened from an iOS home-screen bookmark, so the path is baked into the icon the user saved. |

Both still refuse client-role accounts. Because there is no URL prefix to enforce
against, capture is gated in the shared service layer
(`src/features/vault/hooks/useVaultCapture.ts`) so every surface behaves the same
— that is a client-side gate for consistency and a clear message; the server
still owns the real boundary via RLS and edge-function auth, exactly as
elsewhere.

Do not "fix" these routes by moving them under `/builder/`: it breaks the Android
share sheet and every home-screen icon the team has already saved.

Staying outside the role-prefixed app shell also keeps them light, which matters
— they launch from a share sheet or a bare bookmark on a phone connection.

## PWA / phone capture

The app is installable to a phone home screen, which is what lets the team save
content into the Creative Vault from Instagram or TikTok.

| Piece | Location | Notes |
|---|---|---|
| Web app manifest | `public/manifest.json` | `id`/`start_url`/`scope` are all `/`. Declares `share_target` → `/capture/share-target`. |
| Service worker | `src/sw.ts` → emitted as `/sw.js` | Pass-through, caches nothing. Required for installability and to receive the Android POST share. Emitted un-hashed at the root via a second rollup entry in `vite.config.ts` so its scope covers the whole app — do not let it get hashed or nested. |
| Icons | `public/icons/` | `src/test/pwaInstallability.test.ts` asserts each icon's real PNG dimensions match the manifest, so replacements must keep the same sizes. |
| iOS quick-add document | `capture/quick-add.html` | A separate Vite entry that links **no** manifest. |

### Why `/capture/quick-add` has its own HTML document

iOS Safari's Add to Home Screen does not bookmark the page you are on — when a
manifest is linked, it installs the app against the manifest's `start_url`. With
`start_url: "/"`, every icon opened the site root, which defeated the point of
the quick-add page.

The fix is `capture/quick-add.html`: same app, no manifest link, plus the legacy
Apple meta tags (`apple-mobile-web-app-capable`, `-title`, `-status-bar-style`,
`apple-touch-icon`) so it still launches standalone. With no manifest, Safari
falls back to bookmarking the real URL.

Two things this depends on — both easy to break:

- The `vercel.json` rewrite `/capture/quick-add → /capture/quick-add.html` **must
  stay ordered before** the SPA catch-all, or the catch-all wins and serves
  `index.html` (manifest included, bug back).
- The post-login return to `/capture/quick-add` is a **full page load**, not a
  client-side navigation. A client-side route change lands the user on the
  manifest-bearing document and reintroduces the bug.

Removing the manifest link with JavaScript does not work: since iOS 15.4 the
manifest is fetched at page load, so a post-load DOM removal races a fetch that
already happened.

## Key Edge Functions

| Function | Purpose |
|---|---|
| `ai-chat` | AI assistant (weekly brief, competitive debrief, concept planner) |
| `client-insights` | AI-generated client performance insights |
| `reports` | AI-generated performance reports |
| `creatives` | Fetch and filter ad creatives with pagination |
| `sync` | Meta Marketing API sync — pulls ad data into DB |
| `backfill-daily-history` | One-time backfill of daily metrics to a full year |
| `drain-media-queue` | Event-driven media caching worker (dedupe, no re-download) |
| `enrich-thumbnails` | Downloads Meta ad thumbnails → Supabase Storage |
| `send-digest` | Sends scheduled email digests |
| `scheduled-reports` | Cron-triggered report generation |
