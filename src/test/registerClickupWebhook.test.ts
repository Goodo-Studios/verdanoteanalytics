/**
 * scripts/register-clickup-webhook.mjs (OS-007): dry run by default, creates only with --create
 * and only when no webhook exists for the endpoint, never prints the secret, and subscribes to
 * exactly the events clickup-webhook handles.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain .mjs script without types
import { EVENTS, main, sameEndpoint } from "../../scripts/register-clickup-webhook.mjs";

const ENDPOINT = "https://example.supabase.co/functions/v1/clickup-webhook";
const SECRET = "whsec-made-up-value";

function setup(webhooks: unknown[]) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const logs: string[] = [];
  const written: { path: string; data: string }[] = [];
  const fetchFn = async (url: string, init: { method: string; body?: string }) => {
    calls.push({ method: init.method, url, body: init.body });
    if (init.method === "GET") return new Response(JSON.stringify({ webhooks }), { status: 200 });
    return new Response(JSON.stringify({ id: "wh-new", webhook: { id: "wh-new", secret: SECRET } }), { status: 200 });
  };
  const env = {
    CLICKUP_API_TOKEN: "made-up-token",
    CLICKUP_TEAM_ID: "90141422254",
    WEBHOOK_ENDPOINT: ENDPOINT,
    WEBHOOK_SECRET_OUT: "/tmp/made-up-secret-file",
  };
  const writeFile = (path: string, data: string) => written.push({ path, data });
  return { calls, logs, written, fetchFn, env, log: (m: string) => logs.push(m), writeFile };
}

describe("register-clickup-webhook", () => {
  it("dry run lists webhooks and creates nothing", async () => {
    const s = setup([]);
    const res = await main({ env: s.env, argv: [], fetchFn: s.fetchFn, log: s.log, writeFile: s.writeFile });
    expect(res.action).toBe("dry_run");
    expect(s.calls.map((c) => c.method)).toEqual(["GET"]);
    expect(s.calls[0].url).toBe("https://api.clickup.com/api/v2/team/90141422254/webhook");
    expect(s.written).toEqual([]);
  });

  it("--create posts the team webhook once and writes the secret only to the file", async () => {
    const s = setup([{ id: "wh-other", endpoint: "https://elsewhere.test/hook" }]);
    const res = await main({ env: s.env, argv: ["--create"], fetchFn: s.fetchFn, log: s.log, writeFile: s.writeFile });
    expect(res).toEqual({ action: "created", id: "wh-new" });
    expect(s.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(JSON.parse(s.calls[1].body!)).toEqual({ endpoint: ENDPOINT, events: EVENTS });
    expect(s.written).toEqual([{ path: "/tmp/made-up-secret-file", data: SECRET }]);
    expect(s.logs.join("\n")).not.toContain(SECRET);
    expect(s.logs.join("\n")).toContain("wh-new");
  });

  it("--create does nothing when a webhook for the endpoint exists", async () => {
    const s = setup([{ id: "wh-1", endpoint: `${ENDPOINT}/` }]);
    const res = await main({ env: s.env, argv: ["--create"], fetchFn: s.fetchFn, log: s.log, writeFile: s.writeFile });
    expect(res).toEqual({ action: "exists", id: "wh-1" });
    expect(s.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("--create refuses without a secret file path", async () => {
    const s = setup([]);
    await expect(
      main({ env: { ...s.env, WEBHOOK_SECRET_OUT: "" }, argv: ["--create"], fetchFn: s.fetchFn, log: s.log, writeFile: s.writeFile }),
    ).rejects.toThrow(/WEBHOOK_SECRET_OUT/);
    expect(s.calls).toEqual([]);
  });

  it("compares endpoints ignoring case and a trailing slash", () => {
    expect(sameEndpoint("https://A.test/x/", "https://a.test/x")).toBe(true);
    expect(sameEndpoint("https://a.test/x", "https://a.test/y")).toBe(false);
  });

  it("subscribes to exactly the events the webhook function handles", () => {
    const fn = readFileSync(join(process.cwd(), "supabase/functions/clickup-webhook/index.ts"), "utf8");
    for (const e of EVENTS) expect(fn).toContain(`"${e}"`);
    expect([...EVENTS].sort()).toEqual([
      "taskAssigneeUpdated", "taskCommentPosted", "taskCommentUpdated", "taskCreated", "taskDeleted",
      "taskDueDateUpdated", "taskMoved", "taskStatusUpdated", "taskUpdated",
    ]);
  });
});
