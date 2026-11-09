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
  pickProjectList,
  resolveAccountId,
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

Deno.test("account resolution prefers no match over a wrong match", () => {
  const accounts = [
    { id: "act_bearaby", name: "Bearaby" },
    { id: "act_flatpack", name: "Flatpack" },
    { id: "act_miracle", name: "Miracle Brand" },
    { id: "act_miracle2", name: "Miracle Brand Secondary Ad Account" },
    { id: "act_holy", name: "Holy" },
  ];
  const r = (id: string, name: string, overrides: Record<string, string> = {}) =>
    resolveAccountId({ id, name }, accounts, overrides);

  assertEquals(r("f1", "Bearaby"), "act_bearaby"); // exact
  assertEquals(r("f2", "The Flatpack Company"), "act_flatpack"); // account name inside folder name
  assertEquals(r("f3", "Miracle - Ending October"), "act_miracle"); // alias, not the secondary account
  assertEquals(r("f4", "Osmo"), null); // no account
  assertEquals(r("f5", "Holy Cow Canvas"), "act_holy"); // only one account matches
  // An override wins over the name.
  assertEquals(r("f1", "Bearaby", { f1: "act_flatpack" }), "act_flatpack");
  // An override pointing at an unknown account is not followed and not replaced by a guess.
  assertEquals(r("f1", "Bearaby", { f1: "act_gone" }), null);
});

Deno.test("an ambiguous fuzzy match resolves to nothing", () => {
  const accounts = [
    { id: "act_holycow", name: "Holy Cow" },
    { id: "act_canvas", name: "Canvas" },
  ];
  assertEquals(resolveAccountId({ id: "f", name: "Holy Cow Canvas" }, accounts, {}), null);
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
    "act_bearaby",
    NOW,
  );
  assert(out.kind === "record");
  assertEquals(out.record, {
    clickup_task_id: "86bcpujx2",
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
  assertEquals(toPipelineRecord(task(NOW - 5 * DAY), "a", NOW).kind, "record");
  assertEquals(toPipelineRecord(task(NOW - 5 * DAY, true), "a", NOW).kind, "record");
  assertEquals(toPipelineRecord(task(NOW - (LAUNCH_WINDOW_DAYS + 1) * DAY), "a", NOW).kind, "skip");
  assertEquals(
    toPipelineRecord(task(NOW - (LAUNCH_WINDOW_DAYS + 1) * DAY, true), "a", NOW).kind,
    "skip",
  );
});

Deno.test("stuck, cleared, non-asset and unknown-status tasks are left out", () => {
  const base = { id: "t", name: "November Asset 3", date_updated: String(NOW) };
  assertEquals(toPipelineRecord({ ...base, status: { status: "stuck" } }, "a", NOW).kind, "skip");
  assertEquals(
    toPipelineRecord(
      { ...base, status: { status: "editing" }, custom_fields: [CLEAR_FIELD(0)] },
      "a",
      NOW,
    ).kind,
    "skip",
  );
  assertEquals(
    toPipelineRecord({ ...base, name: "Nov Shoot Day", status: { status: "assigned" } }, "a", NOW).kind,
    "skip",
  );
  assertEquals(toPipelineRecord({ ...base, status: { status: "brand new" } }, "a", NOW), {
    kind: "unknown",
    status: "brand new",
  });
});
