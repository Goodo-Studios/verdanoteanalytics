// Tests for the ClickUp -> pipeline_tasks rules.
//   deno test -A supabase/functions/_shared/clickup-pipeline.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cleanFolderName,
  decideStage,
  dropdownValue,
  isAssetTask,
  isClearedTask,
  LAUNCH_WINDOW_DAYS,
  boardAccountId,
  type ClientRow,
  pickProjectList,
  resolveClientSlug,
  STAGE_MAP,
  toIsoDate,
  toPipelineRecord,
} from "./clickup-pipeline.ts";

// The 21 statuses read live from the ClickUp workspace on 2026-11-09.
const LIVE_STATUSES = [
  "assigned",
  "brief creation",
  "client brief review",
  "ready to shoot",
  "ready for creator",
  "shooting client",
  "ready to edit",
  "editing",
  "internal review",
  "internal review edits",
  "ready to send to client",
  "quality assurance review",
  "client review",
  "client revisions",
  "ready to transfer",
  "stuck",
  "export versions",
  "versions exported",
  "ready for editing queue",
  "ready for launch",
  "complete",
];

const BOARD_COLUMNS = new Set([
  "Preparing Content",
  "Production",
  "Editing",
  "Client Review",
  "Ready to Launch",
]);

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const CLEAR_FIELD = (value: unknown) => ({
  name: "Clear Task",
  type: "drop_down",
  value,
  type_config: {
    options: [
      { id: "311d1e83", name: "true", orderindex: 0 },
      { id: "c60e251a", name: "false", orderindex: 1 },
    ],
  },
});

const TYPE_FIELD = (value: unknown) => ({
  name: "Type of Content",
  type: "drop_down",
  value,
  type_config: {
    options: [
      { id: "58281c32", name: "Motion Graphic", orderindex: 0 },
      { id: "1e55d6d1", name: "Net New Static", orderindex: 1 },
    ],
  },
});

Deno.test("every live ClickUp status is either mapped to a board column or skipped", () => {
  for (const status of LIVE_STATUSES) {
    const d = decideStage(status);
    assert(d.kind !== "unknown", `"${status}" has no decision`);
    if (d.kind === "stage") assert(BOARD_COLUMNS.has(d.stage), `"${status}" maps off the board`);
  }
  assertEquals(decideStage("stuck").kind, "skip");
  assertEquals(Object.keys(STAGE_MAP).length, LIVE_STATUSES.length - 1);
});

Deno.test("status mapping keeps the client-facing meaning", () => {
  assertEquals(decideStage("assigned"), { kind: "stage", stage: "Preparing Content" });
  assertEquals(decideStage("Client Brief Review"), { kind: "stage", stage: "Preparing Content" });
  assertEquals(decideStage("ready to edit"), { kind: "stage", stage: "Production" });
  // Internal review and QA never read as "your turn" to the client.
  assertEquals(decideStage("quality assurance review"), { kind: "stage", stage: "Editing" });
  assertEquals(decideStage("client revisions"), { kind: "stage", stage: "Editing" });
  assertEquals(decideStage("client review"), { kind: "stage", stage: "Client Review" });
  assertEquals(decideStage("complete"), { kind: "stage", stage: "Ready to Launch" });
});

Deno.test("an unmapped status is reported and never passed through as a label", () => {
  assertEquals(decideStage("secret internal thing"), {
    kind: "unknown",
    status: "secret internal thing",
  });
  assertEquals(decideStage(""), { kind: "skip" });
  assertEquals(decideStage(null), { kind: "skip" });
});

Deno.test("only asset tasks reach the board", () => {
  assert(isAssetTask("November Asset 8 - Softcurve Pillow Pregnancy "));
  assert(isAssetTask("October Asset 19- Overhead Hug Pillow"));
  assert(isAssetTask("august asset 2"));
  assert(!isAssetTask("October Shoot Day"));
  assert(!isAssetTask("November Creator Production"));
  assert(!isAssetTask("Set up Client Hub"));
  assert(!isAssetTask("Collect brand assets"));
  assert(!isAssetTask(null));
});

Deno.test("dropdown fields resolve by orderindex and by option id", () => {
  assertEquals(dropdownValue([TYPE_FIELD(1)], "Type of Content"), "Net New Static");
  assertEquals(dropdownValue([TYPE_FIELD("58281c32")], "Type of Content"), "Motion Graphic");
  assertEquals(dropdownValue([TYPE_FIELD(null)], "Type of Content"), null);
  assertEquals(dropdownValue([], "Type of Content"), null);
  assertEquals(dropdownValue([TYPE_FIELD(9)], "Type of Content"), null);
});

Deno.test("Clear Task = true removes a task, false and unset do not", () => {
  assert(isClearedTask([CLEAR_FIELD(0)]));
  assert(isClearedTask([CLEAR_FIELD("311d1e83")]));
  assert(!isClearedTask([CLEAR_FIELD(1)]));
  assert(!isClearedTask([CLEAR_FIELD(null)]));
  assert(!isClearedTask(undefined));
});

Deno.test("dates convert from millisecond strings", () => {
  assertEquals(toIsoDate("1795194000000"), "2026-11-20");
  assertEquals(toIsoDate(null), null);
  assertEquals(toIsoDate(""), null);
  assertEquals(toIsoDate("not a date"), null);
});

Deno.test("folder names drop the commercial suffix", () => {
  assertEquals(cleanFolderName("Royo - Ending October"), "Royo");
  assertEquals(cleanFolderName("Marek - Ending September 1"), "Marek");
  assertEquals(cleanFolderName("The Flatpack Company"), "The Flatpack Company");
});

// Clients as the sync builds them: own name, linked ad account ids, and the names of
// the linked active ad accounts.
const client = (slug: string, name: string, accounts: [string, string][] = []): ClientRow => ({
  slug,
  name,
  accountIds: accounts.map(([id]) => id),
  accountNames: accounts.map(([, n]) => n),
});

Deno.test("client resolution prefers no match over a wrong match", () => {
  const clients = [
    client("bearaby", "Bearaby", [["act_bearaby", "Bearaby"]]),
    client("flatpack", "Flatpack Co", [["act_flatpack", "Flatpack"]]),
    client("miracle", "Miracle Health", [
      ["act_miracle", "Miracle Brand"],
      ["act_miracle2", "Miracle Brand Secondary Ad Account"],
    ]),
    client("holy", "Holy", [["act_holy", "Holy"]]),
    client("tea", "Pretty Tasty Tea"), // no ad account
  ];
  const r = (id: string, name: string, mappings: Record<string, string> = {}) =>
    resolveClientSlug({ id, name }, clients, mappings);

  assertEquals(r("f1", "Bearaby"), { kind: "client", slug: "bearaby", via: "name" }); // exact
  // matched through a linked ad account name inside the folder name
  assertEquals(r("f2", "The Flatpack Company"), { kind: "client", slug: "flatpack", via: "name" });
  // alias to an ad account name; both Miracle accounts belong to one client
  assertEquals(r("f3", "Miracle - Ending October"), { kind: "client", slug: "miracle", via: "name" });
  assertEquals(r("f4", "Osmo"), { kind: "none", reason: "unmatched" }); // no client
  assertEquals(r("f5", "Holy Cow Canvas"), { kind: "client", slug: "holy", via: "name" }); // one candidate
  // a client with no ad account is matched by its own name
  assertEquals(r("f6", "Pretty Tasty Tea - Ending December"), { kind: "client", slug: "tea", via: "name" });
});

Deno.test("a staff source mapping wins over the name rules", () => {
  const clients = [client("bearaby", "Bearaby"), client("flatpack", "Flatpack")];
  // The folder is named Bearaby, but staff mapped it to Flatpack.
  assertEquals(
    resolveClientSlug({ id: "f1", name: "Bearaby" }, clients, { f1: "flatpack" }),
    { kind: "client", slug: "flatpack", via: "mapping" },
  );
  // A mapping for another folder does not change this one.
  assertEquals(
    resolveClientSlug({ id: "f1", name: "Bearaby" }, clients, { f9: "flatpack" }),
    { kind: "client", slug: "bearaby", via: "name" },
  );
});

Deno.test("a mapping to a missing or inactive client is not followed and not replaced by a guess", () => {
  const clients = [client("bearaby", "Bearaby")];
  assertEquals(
    resolveClientSlug({ id: "f1", name: "Bearaby" }, clients, { f1: "gone" }),
    { kind: "none", reason: "stale_mapping" },
  );
});

Deno.test("names of two different clients matching resolve to nothing", () => {
  // fuzzy: both names are inside the folder name
  assertEquals(
    resolveClientSlug(
      { id: "f", name: "Holy Cow Canvas" },
      [client("holycow", "Holy Cow"), client("canvas", "Canvas")],
      {},
    ),
    { kind: "none", reason: "ambiguous" },
  );
  // exact: one client's name equals another client's ad account name
  assertEquals(
    resolveClientSlug(
      { id: "f", name: "Osmo" },
      [client("osmo", "Osmo"), client("other", "Other Co", [["act_x", "Osmo"]])],
      {},
    ),
    { kind: "none", reason: "ambiguous" },
  );
});

Deno.test("the board account is written only when a client has exactly one ad account", () => {
  assertEquals(boardAccountId(client("a", "A", [["act_1", "A"]])), "act_1");
  assertEquals(boardAccountId(client("a", "A")), null);
  assertEquals(boardAccountId(client("a", "A", [["act_1", "A"], ["act_2", "A2"]])), null);
});

Deno.test("the project list is picked only when there is exactly one", () => {
  assertEquals(
    pickProjectList([
      { id: "1", name: "Meeting Calls" },
      { id: "2", name: "Bearaby Project View" },
      { id: "3", name: "Bearaby Guidelines" },
    ])?.id,
    "2",
  );
  assertEquals(pickProjectList([{ id: "1", name: "Meeting Calls" }]), null);
  assertEquals(
    pickProjectList([
      { id: "1", name: "A Project View" },
      { id: "2", name: "B Project View" },
    ]),
    null,
  );
});

const OWNER = { client_slug: "a", account_id: null };

Deno.test("a client with no single ad account still gets rows, keyed by client only", () => {
  const out = toPipelineRecord(
    { id: "t9", name: "November Asset 2", status: { status: "client review" }, date_updated: String(NOW) },
    { client_slug: "tea", account_id: null },
    NOW,
  );
  assert(out.kind === "record");
  assertEquals(out.record.client_slug, "tea");
  assertEquals(out.record.account_id, null);
});

Deno.test("a task becomes a row holding only client-safe fields", () => {
  const out = toPipelineRecord(
    {
      id: "86bcpujx2",
      name: "November Asset 8 -  Softcurve Pillow Pregnancy ",
      status: { status: "editing" },
      due_date: "1795194000000",
      date_updated: String(NOW - DAY),
      custom_fields: [TYPE_FIELD(0), CLEAR_FIELD(1)],
    },
    { client_slug: "bearaby", account_id: "act_bearaby" },
    NOW,
  );
  assert(out.kind === "record");
  assertEquals(out.record, {
    clickup_task_id: "86bcpujx2",
    client_slug: "bearaby",
    account_id: "act_bearaby",
    task_name: "November Asset 8 - Softcurve Pillow Pregnancy",
    stage: "Editing",
    due_date: "2026-11-20",
    content_type: "Motion Graphic",
    synced_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
  });
  // The raw ClickUp status is not a column on the row.
  assert(!("status" in out.record));
});

Deno.test("delivered work shows for the launch window only", () => {
  const task = (touched: number, closed = false) => ({
    id: "t1",
    name: "October Asset 1",
    status: { status: closed ? "complete" : "ready for launch" },
    date_updated: String(touched),
    date_closed: closed ? String(touched) : null,
  });
  assertEquals(toPipelineRecord(task(NOW - 5 * DAY), OWNER, NOW).kind, "record");
  assertEquals(toPipelineRecord(task(NOW - 5 * DAY, true), OWNER, NOW).kind, "record");
  assertEquals(toPipelineRecord(task(NOW - (LAUNCH_WINDOW_DAYS + 1) * DAY), OWNER, NOW).kind, "skip");
  assertEquals(
    toPipelineRecord(task(NOW - (LAUNCH_WINDOW_DAYS + 1) * DAY, true), OWNER, NOW).kind,
    "skip",
  );
});

Deno.test("stuck, cleared, non-asset and unknown-status tasks are left out", () => {
  const base = { id: "t", name: "November Asset 3", date_updated: String(NOW) };
  assertEquals(toPipelineRecord({ ...base, status: { status: "stuck" } }, OWNER, NOW).kind, "skip");
  assertEquals(
    toPipelineRecord(
      { ...base, status: { status: "editing" }, custom_fields: [CLEAR_FIELD(0)] },
      OWNER,
      NOW,
    ).kind,
    "skip",
  );
  assertEquals(
    toPipelineRecord({ ...base, name: "Nov Shoot Day", status: { status: "assigned" } }, OWNER, NOW).kind,
    "skip",
  );
  assertEquals(toPipelineRecord({ ...base, status: { status: "brand new" } }, OWNER, NOW), {
    kind: "unknown",
    status: "brand new",
  });
});
