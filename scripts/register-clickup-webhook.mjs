#!/usr/bin/env node
// Register the ClickUp team webhook that feeds clickup-webhook (Goodo OS story OS-007).
//
// Environment:
//   CLICKUP_API_TOKEN   ClickUp token (pass it with `hq secrets exec`, never paste it)
//   CLICKUP_TEAM_ID     the ClickUp team (workspace) id, 90141422254 for Goodo
//   WEBHOOK_ENDPOINT    the deployed function URL, e.g. https://<ref>.supabase.co/functions/v1/clickup-webhook
//   WEBHOOK_SECRET_OUT  file path the new webhook's signing secret is written to (mode 600).
//                       Required with --create. The secret is never printed.
//
// Usage:
//   node scripts/register-clickup-webhook.mjs            dry run (default): lists webhooks, says what it would do
//   node scripts/register-clickup-webhook.mjs --create   creates the webhook if none exists for WEBHOOK_ENDPOINT
//
// It only ever reads ClickUp (GET /team/{id}/webhook), plus one POST /team/{id}/webhook with
// --create when no webhook for the endpoint exists. It never changes or deletes a webhook or task.
// After creating, set the secret on the function:  supabase secrets set CLICKUP_WEBHOOK_SECRET=...
// (read it from the file, e.g. with `hq secrets` tooling), then delete the file.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EVENTS = [
  "taskCreated",
  "taskUpdated",
  "taskDeleted",
  "taskStatusUpdated",
  "taskAssigneeUpdated",
  "taskDueDateUpdated",
  "taskMoved",
  "taskCommentPosted",
  "taskCommentUpdated",
];

const API = "https://api.clickup.com/api/v2";

export function sameEndpoint(a, b) {
  const norm = (u) => String(u ?? "").trim().replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

export async function main({ env = process.env, argv = process.argv.slice(2), fetchFn = fetch, log = console.log, writeFile = writeFileSync } = {}) {
  const create = argv.includes("--create");
  const token = env.CLICKUP_API_TOKEN;
  const teamId = env.CLICKUP_TEAM_ID;
  const endpoint = env.WEBHOOK_ENDPOINT;
  const secretOut = env.WEBHOOK_SECRET_OUT;

  const missing = [
    ["CLICKUP_API_TOKEN", token],
    ["CLICKUP_TEAM_ID", teamId],
    ["WEBHOOK_ENDPOINT", endpoint],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
  if (!/^\d+$/.test(teamId)) throw new Error("CLICKUP_TEAM_ID must be numeric");
  if (!/^https:\/\//.test(endpoint)) throw new Error("WEBHOOK_ENDPOINT must be an https URL");
  if (create && !secretOut) throw new Error("--create needs WEBHOOK_SECRET_OUT (a file path for the secret)");

  const headers = { Authorization: token, "Content-Type": "application/json" };
  const listRes = await fetchFn(`${API}/team/${teamId}/webhook`, { method: "GET", headers });
  if (!listRes.ok) throw new Error(`Listing webhooks failed: HTTP ${listRes.status}`);
  const { webhooks = [] } = await listRes.json();

  log(`Team ${teamId} has ${webhooks.length} webhook(s):`);
  for (const w of webhooks) {
    log(`  ${w.id}  ${w.endpoint}  status=${w.health?.status ?? "?"}  events=${(w.events ?? []).length}`);
  }

  const existing = webhooks.find((w) => sameEndpoint(w.endpoint, endpoint));
  if (existing) {
    log(`A webhook for ${endpoint} already exists: ${existing.id}. Nothing to do.`);
    return { action: "exists", id: existing.id };
  }
  if (!create) {
    log(`Dry run: would create a team webhook for ${endpoint} with events: ${EVENTS.join(", ")}.`);
    log("Run again with --create to create it.");
    return { action: "dry_run" };
  }

  const createRes = await fetchFn(`${API}/team/${teamId}/webhook`, {
    method: "POST",
    headers,
    body: JSON.stringify({ endpoint, events: EVENTS }),
  });
  if (!createRes.ok) throw new Error(`Creating the webhook failed: HTTP ${createRes.status}`);
  const created = await createRes.json();
  const id = created.id ?? created.webhook?.id;
  const secret = created.webhook?.secret ?? created.secret;
  if (!secret) throw new Error(`Webhook ${id} was created but ClickUp returned no secret; delete it in ClickUp and retry.`);
  writeFile(secretOut, secret, { mode: 0o600 });
  log(`Created webhook ${id}. The signing secret was written to ${secretOut}.`);
  return { action: "created", id };
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
