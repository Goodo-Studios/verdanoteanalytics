# Verdanote User Guide
_Last updated: February 27, 2026_

---

## What Is Verdanote?

Verdanote is Goodo Studios' creative analytics dashboard. It pulls ad performance data directly from Meta (Facebook/Instagram) and shows you which creatives are working, which aren't, and why.

**Every number in Verdanote comes from real Meta ad data.** It syncs automatically. You don't have to log into Ads Manager.

---

## Roles

There are four roles in Verdanote. What you see depends on your role.

| Role | Who | Access |
|---|---|---|
| **Builder** | Matthew (admin) | Everything — settings, all accounts, sync controls, user management |
| **Employee** | Creative strategists, account leads | All analytics, all accounts, tagging, reports |
| **Editor** | Video editors | Their accounts only — creative grid with performance, no strategy tools |
| **Client** | Brand clients | Their account only — simplified overview and creative view |

---

## Logging In

1. Go to the Verdanote URL (ask Matthew for the link)
2. Enter your email and password
3. You'll land on your dashboard automatically based on your role

**Forgot your password?** Click "Forgot password" on the login screen. A reset link goes to your email.

**First time?** Matthew or your account manager will create your account and send you credentials.

---

## For Editors — Your Dashboard

When you log in as an editor, you'll see **Your Creatives** — a grid of every ad your work has appeared in, sorted by performance.

### What You're Looking At

Each card shows:
- **Thumbnail or video preview** — click to play the video
- **Ad name** — the internal name used in Meta
- **ROAS** — Return on Ad Spend. How much revenue was made for every $1 spent
  - 🟢 Green = 2x or above (winning)
  - 🟡 Yellow = 1–2x (monitoring)
  - 🔴 Red = below 1x (not converting)
- **Spend** — how much has been spent on this ad
- **CTR** — Click-through rate. What % of people who saw the ad clicked it

### Filters

- **Search** — type any part of an ad name to find it
- **Status filter** — show All / Winning (≥2x ROAS) / Needs Work (<1x ROAS)

### What This Means for Your Work

A 2x+ ROAS means the edit is converting. The creative is working.

If you see a lot of red, it's not necessarily the edit — it could be the hook, the offer, the audience, or the copy. Talk to your creative strategist. They can see the full picture.

Metrics update daily. Everything reflects the last 14 days.

---

## For Creative Strategists — Full Dashboard

### Overview

The main overview shows headline metrics for a selected account:
- **Total Spend** — all money spent in the date range
- **ROAS** — blended return across all active creatives
- **CPA** — cost per purchase/conversion
- **Total Purchases** — conversions driven by ads

Switch accounts using the dropdown in the top-left sidebar.

**This Period's Highlights** — a written summary you can edit. Use this to frame the numbers for clients before sharing.

**What's Working** — top 3 creatives by ROAS for the selected account.

**Spend & ROAS Trend** — daily chart showing how spend and returns are moving over time.

### Creatives Page

Full table of every creative with spend data.

**Columns:**
- Ad Name, ROAS, Spend, CPA, Purchases, CTR, Hook Rate (thumb stop rate), Add to Cart

**Filters:**
- Search by name
- Filter by status: Scaling / Monitoring / Paused
- Sort by: Best ROAS, Most Spend, Newest

**Status indicators:**
- 🟢 **Scaling** — ROAS above your scale threshold (default 2x)
- 🟡 **Monitoring** — between kill and scale threshold
- 🔴 **Paused** — ROAS below kill threshold (default 1x)

Click any creative to open the detail view — see the thumbnail/video, full metrics, and notes.

### Analytics Page

Deeper cuts:

- **Scale / Kill list** — which creatives to scale up budget on, which to cut
- **Win Rate** — what % of your creatives hit the scale threshold
- **Iterations** — tracks how creative concepts evolve over time
- **Trends** — daily performance over time
- **Tag Insights** — performance broken down by creative tags (hook type, format, angle, etc.)

### Tagging Page

This is where you label creatives with structured data so you can analyze patterns.

**Tags include:**
- Hook type (question, shock, testimonial, etc.)
- Format (UGC, static image, motion graphic, etc.)
- Angle (social proof, problem/solution, founder story, etc.)
- Awareness stage (unaware through most-aware)

Tag creatives manually or upload a CSV. Once tagged, the Tag Insights tab in Analytics shows which tag combinations perform best.

### Reports Page

Create and share performance reports with clients.

- Build a report for a time range
- Add context / highlights
- Share via public link (no login required for the client)

### AI Analyst

Ask questions about your creative data in plain English.

Examples:
- "Which creatives have the best hook rate?"
- "What's our average CPA for video ads vs. static?"
- "Show me Everdries' top performers this month"

---

## Content Pipeline

The **Content Pipeline** (`/pipeline`) shows the live status of creative briefs and their tasks — Planning, Production, Review, Your Review, Complete — synced automatically from Coda every few hours, so you don't need a Coda login. Clients see a read-only view of their own account; strategists and builders use the account selector to view any client's pipeline.

---

## For Matthew (Builder) — Settings & Admin

### Settings → Account Settings

Per-account configuration:
- **Scale threshold** — ROAS above which a creative is flagged as "scaling" (default 2x)
- **Kill threshold** — ROAS below which a creative is flagged for pausing (default 1x)
- **Date range** — how many days of data to pull (default 14)
- **Iteration spend threshold** — minimum spend before a creative is counted

### Settings → Sync

- **Manual sync** — trigger a fresh pull from Meta right now
- **Sync history** — see past syncs, errors, how many creatives were fetched
- **Cancel sync** — stop a running sync

### Settings → AI Context

Write notes about the account that the AI Analyst uses to give better answers. Describe the brand, the offer, what's worked historically.

### User Management

In your account settings or user settings page:
- **Create users** — set email, password, role, and linked accounts
- **Delete users** — remove access
- **Roles**: builder, employee, editor, client

Client users only see their assigned account. Editor users see their assigned accounts. Employee/builder see all.

---

## Syncing — How It Works

Verdanote pulls from Meta automatically. Here's what happens:

1. **Phase 1** — Fetches all your ads (id, name, campaign, status)
2. **Phase 2** — Fetches aggregated performance metrics (ROAS, spend, CPA, etc.)
3. **Phase 3** — Cleans up zero-spend creatives
4. **Phase 4** — Fetches daily breakdowns (spend per day per creative)
5. **Phase 5** — Finalizes and updates account totals

Large accounts (10k+ creatives) sync campaign-by-campaign. A full sync on a large account can take 15–30 minutes.

**If a sync shows "completed with errors"** — some data came through but something failed partway. Check the sync history for details. Usually it resolves on the next sync.

---

## Troubleshooting

**"No creatives showing"**
- Check the account selector — make sure you have the right account selected
- Check Settings → Sync History. Has a sync completed successfully?
- If the last sync failed, try triggering a manual sync

**"ROAS seems wrong"**
- Make sure your date range covers the period you're checking
- Meta attribution can shift retroactively — numbers from last week may update as conversions are attributed
- Check if your pixel events are correctly set up in Meta (purchase vs. other events)

**"I can't see an account"**
- You may not have been assigned to that account. Ask Matthew to check your user settings

**"The sync is stuck"**
- Check Settings → Sync History. If it's been "running" for more than 30 minutes with no activity, trigger a cancel and restart
- Very large accounts (18k+ creatives) can take longer — check the "last activity" timestamp

**"Thumbnails aren't loading"**
- Thumbnails are fetched separately from ad data. They may take an extra sync cycle to appear
- Some ad formats don't have thumbnails — static image ads show the image directly

---

## Quick Reference

| Thing | Where |
|---|---|
| See top performing creatives | Overview → What's Working |
| Find a specific ad | Creatives → Search |
| Check daily trend | Overview → Spend & ROAS Trend |
| See which tags convert | Analytics → Tag Insights |
| Scale / kill recommendations | Analytics → Scale or Kill |
| Share results with a client | Reports → Create Report → Share Link |
| Add a new user | Settings → Users → Create User |
| Trigger a fresh sync | Settings → Sync → Sync Now |
| Ask a data question | AI Analyst |

---

_Questions? Slack Matthew or drop a message in #11-ai._
