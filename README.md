# Verdanote Analytics

Meta ad creative analytics platform for DTC brands. Analyze, tag, grade, and optimize creatives with win-rate analysis, kill/scale recommendations, and AI-powered insights.

## Stack

- **Frontend**: React 18 + TypeScript + Vite + shadcn/ui + Tailwind CSS
- **Backend**: Supabase Edge Functions (Deno)
- **Database**: Supabase / Postgres
- **Auth**: Supabase Auth with role-based access (builder / employee / client)
- **Charts**: Recharts
- **Deployment**: Vercel (frontend) + Supabase (backend + DB)

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

# Build and check the bundle budget (CI runs this)
npm run build:check
```

### Bundle budget

`scripts/check-bundle-budget.mjs` runs after the build and fails it when:

- the JavaScript loaded on first open is over 840,000 bytes. That is every
  module script and modulepreload link in `dist/index.html`, plus every chunk
  those files import statically. Lazy page chunks (`import()`) are not counted.
  The cap was the measured first-load size on 2026-11-10 (764,031 bytes) plus
  about 10 percent.
- any single chunk in `dist/assets` is over 380,000 bytes.

The total of all chunks is printed for information only and has no cap (owner
decision, 2026-11-10). Raising either cap is an owner decision.

## Deployment

The frontend deploys automatically to Vercel on every push to `main`.

To deploy manually:
```sh
vercel --prod
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
