// Tests for the ClickUp task -> os_tasks mapper (OS-007).
//
//   deno test -A supabase/functions/_shared/os-task-map.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  asText,
  columnsFromEntries,
  type CuTask,
  decideStatus,
  diffTask,
  dropdownName,
  FIELD_COLUMNS,
  FIELDS,
  findField,
  firstListStatus,
  isAssetList,
  isEditableFieldType,
  type MapContext,
  mapTask,
  msToDate,
  OS_SPACE_IDS,
  qaChecklist,
  safeLink,
  STUCK_REASON,
} from "./os-task-map.ts";

const NOW = "2026-11-12T10:00:00.000Z";
const CLIENT_SPACE = "90146671303";
const PROD_SPACE = "90147169333";
const ms = (iso: string) => String(Date.parse(iso));

const passFail = (id: string, name: string, value: unknown) => ({
  id,
  name,
  type: "drop_down",
  value,
  type_config: { options: [{ id: "opt-pass", name: "PASS", orderindex: 0 }, { id: "opt-fail", name: "FAIL", orderindex: 1 }] },
});

const TASK: CuTask = {
  id: "86abc",
  name: "  November   Asset 3 - Gifting ",
  text_content: "Shoot at the studio.\n",
  status: { status: "Editing" },
  due_date: ms("2026-11-20T17:00:00Z"),
  date_created: ms("2026-11-01T12:00:00Z"),
  date_updated: ms("2026-11-10T09:30:00Z"),
  parent: null,
  url: "https://app.clickup.com/t/86abc",
  assignees: [{ id: 11, username: "Pat Editor", email: "Pat@Goodo.test" }, { id: 12, username: "No Mail" }],
  custom_fields: [
    { id: FIELDS.strategist.id, name: "Strategist", type: "users", value: [{ id: 21, username: "Sam", email: "SAM@goodo.test" }] },
    { id: FIELDS.producer.id, name: "Producer", type: "users", value: [] },
    { id: FIELDS.editor.id, name: "Editor", type: "users", value: [{ id: 11, username: "Pat Editor", email: "pat@goodo.test" }] },
    { id: FIELDS.reviewedBy.id, name: "Reviewed By", type: "users", value: [{ id: 21, username: "Sam", email: "sam@goodo.test" }] },
    {
      id: FIELDS.brief.id,
      name: "Brief",
      type: "drop_down",
      value: "brief-opt-2",
      type_config: { options: [{ id: "brief-opt-1", name: "Static", orderindex: 0 }, { id: "brief-opt-2", name: "UGC Video", orderindex: 1 }] },
    },
    {
      id: FIELDS.contentType.id,
      name: "Type of Content",
      type: "drop_down",
      value: 0,
      type_config: { options: [{ id: "ct-1", name: "UGC", orderindex: 0 }] },
    },
    { id: FIELDS.assetLink.id, name: "Link to Asset", type: "text", value: " https://app.air.inc/a/xyz " },
    { id: FIELDS.hook1.id, name: "Goodo Ad Name Hook 1", type: "short_text", value: "Hook one" },
    { id: FIELDS.hook2.id, name: "Goodo Ad Name Hook 2", type: "short_text", value: "   " },
    passFail(FIELDS.qaPolish.id, "Overall Polish", 0),
    passFail(FIELDS.qaStory.id, "Story & Pacing", "opt-fail"),
    passFail(FIELDS.qaAudio.id, "Audio & Captions", null),
    passFail(FIELDS.qaVisual.id, "Visual Quality", "0"),
    { id: FIELDS.briefDue.id, name: "Brief due", type: "date", value: ms("2026-11-05T12:00:00Z") },
    { id: FIELDS.cutToStrategist.id, name: "Cut to strategist", type: "date", value: ms("2026-11-14T12:00:00Z") },
    { id: FIELDS.cutToClient.id, name: "Cut to client", type: "date", value: ms("2026-11-17T12:00:00Z") },
    { id: FIELDS.editDue.id, name: "Edit due", type: "date", value: ms("2026-11-13T12:00:00Z") },
    { id: FIELDS.productionDate.id, name: "Production Date", type: "date", value: ms("2026-11-08T12:00:00Z") },
    { id: FIELDS.briefHandedOff.id, name: "Brief handed off", type: "date", value: null },
  ],
};

const CTX: MapContext = {
  clientSlug: "bearaby",
  spaceId: CLIENT_SPACE,
  list: { id: "l-pv", name: "Bearaby Project View" },
  readOnly: false,
  previousStatus: null,
  nowIso: NOW,
};

Deno.test("maps a Project View task with every field", () => {
  const { row, people } = mapTask(TASK, CTX);
  assertEquals(row.clickup_task_id, "86abc");
  assertEquals(row.title, "November Asset 3 - Gifting");
  assertEquals(row.client_slug, "bearaby");
  assertEquals(row.status, "editing");
  assertEquals(row.raw_status, "Editing");
  assertEquals(row.is_stuck, false);
  assertEquals(row.stuck_reason, null);
  assertEquals(row.due_date, "2026-11-20");
  assertEquals(row.cycle_month, "2026-11-01");
  assertEquals(row.description, "Shoot at the studio.");
  assertEquals(row.content_type, "UGC");
  assertEquals(row.brief_type, "UGC Video");
  assertEquals(row.asset_url, "https://app.air.inc/a/xyz");
  assertEquals(row.hooks, ["Hook one"]);
  assertEquals(row.qa_checklist, [
    { item: "Overall Polish", result: "PASS" },
    { item: "Story & Pacing", result: "FAIL" },
    { item: "Visual Quality", result: "PASS" },
  ]);
  assertEquals(row.brief_due_date, "2026-11-05");
  assertEquals(row.cut_to_strategist_date, "2026-11-14");
  assertEquals(row.cut_to_client_date, "2026-11-17");
  assertEquals(row.edit_due_date, "2026-11-13");
  assertEquals(row.production_date, "2026-11-08");
  assertEquals(row.brief_handed_off_date, null);
  assertEquals(row.assignees, [
    { id: "11", username: "Pat Editor", email: "pat@goodo.test" },
    { id: "12", username: "No Mail", email: null },
  ]);
  assertEquals(row.reviewed_by, [{ id: "21", username: "Sam", email: "sam@goodo.test" }]);
  assertEquals(row.is_asset, true);
  assertEquals(row.read_only, false);
  assertEquals(row.clickup_space_id, CLIENT_SPACE);
  assertEquals(row.clickup_list_id, "l-pv");
  assertEquals(row.clickup_list_name, "Bearaby Project View");
  assertEquals(row.clickup_parent_id, null);
  assertEquals(row.clickup_url, "https://app.clickup.com/t/86abc");
  assertEquals(row.clickup_updated_at, "2026-11-10T09:30:00.000Z");
  assertEquals(row.last_synced_at, NOW);
  assertEquals(people, { strategist: "sam@goodo.test", producer: null, editor: "pat@goodo.test" });
});

Deno.test("the asset link is trimmed and kept when it is an http(s) link", () => {
  const bad = { ...TASK, custom_fields: [{ id: FIELDS.assetLink.id, name: "Link to Asset", value: "javascript:alert(1)" }] };
  assertEquals(mapTask(bad, CTX).row.asset_url, null);
  assertEquals(safeLink("https://app.air.inc/a/xyz"), "https://app.air.inc/a/xyz");
  assertEquals(safeLink("javascript:alert(1)"), null);
  assertEquals(safeLink("https://user:pw@evil.test/x"), null);
  assertEquals(safeLink("not a link"), null);
  assertEquals(safeLink(null), null);
});

Deno.test("custom fields are found by id first, then by name", () => {
  const byName = [{ id: "other-id", name: " brief DUE ", value: ms("2026-12-01T12:00:00Z") }];
  assertEquals(findField(byName, FIELDS.briefDue)?.id, "other-id");
  const both = [
    { id: "x", name: "Brief due", value: "1" },
    { id: FIELDS.briefDue.id, name: "Renamed", value: "2" },
  ];
  assertEquals(findField(both, FIELDS.briefDue)?.value, "2");
  assertEquals(findField([], FIELDS.briefDue), null);
});

Deno.test("drop-downs resolve from orderindex (number or string) or option id", () => {
  const f = (value: unknown) => passFail("q", "QA", value);
  assertEquals(dropdownName(f(1)), "FAIL");
  assertEquals(dropdownName(f("1")), "FAIL");
  assertEquals(dropdownName(f("opt-pass")), "PASS");
  assertEquals(dropdownName(f(7)), null);
  assertEquals(dropdownName(f(null)), null);
  assertEquals(dropdownName(null), null);
});

Deno.test("dates: ms epoch strings become YYYY-MM-DD; junk is null", () => {
  assertEquals(msToDate(ms("2026-02-28T23:00:00Z")), "2026-02-28");
  assertEquals(msToDate(1767225600000), "2026-01-01");
  assertEquals(msToDate(""), null);
  assertEquals(msToDate("abc"), null);
  assertEquals(msToDate(0), null);
  assertEquals(msToDate(null), null);
});

Deno.test("QA checklist keeps only the items that have a result", () => {
  assertEquals(qaChecklist([]), []);
  assertEquals(qaChecklist([passFail(FIELDS.qaAudio.id, "Audio & Captions", "opt-fail")]), [{ item: "Audio & Captions", result: "FAIL" }]);
});

Deno.test("stuck keeps the previous status and flags the row", () => {
  const stuck = { ...TASK, status: { status: "stuck" } };
  const { row } = mapTask(stuck, { ...CTX, previousStatus: "internal review" });
  assertEquals(row.status, "internal review");
  assertEquals(row.raw_status, "stuck");
  assertEquals(row.is_stuck, true);
  assertEquals(row.stuck_reason, STUCK_REASON);
});

Deno.test("a new stuck task takes the first status of its list, else assigned", () => {
  assertEquals(decideStatus("STUCK", null, "to do"), { status: "to do", isStuck: true });
  assertEquals(decideStatus("stuck", null, null), { status: "assigned", isStuck: true });
  assertEquals(decideStatus("stuck", "stuck", null), { status: "assigned", isStuck: true });
});

Deno.test("leaving stuck clears the flag and takes the ClickUp status", () => {
  const { row } = mapTask(TASK, { ...CTX, previousStatus: "internal review" });
  assertEquals(row.status, "editing");
  assertEquals(row.is_stuck, false);
  assertEquals(row.stuck_reason, null);
});

Deno.test("a task with no status keeps the previous one, else assigned", () => {
  assertEquals(decideStatus(null, "editing"), { status: "editing", isStuck: false });
  assertEquals(decideStatus("  ", null), { status: "assigned", isStuck: false });
});

Deno.test("first list status ignores stuck and sorts by orderindex", () => {
  assertEquals(
    firstListStatus([{ status: "Complete", orderindex: 9 }, { status: "stuck", orderindex: 0 }, { status: "To Do", orderindex: 1 }]),
    "to do",
  );
  assertEquals(firstListStatus([]), null);
  assertEquals(firstListStatus(undefined), null);
});

Deno.test("is_asset only for Project View lists in Client Operations", () => {
  assertEquals(isAssetList(CLIENT_SPACE, "Bearaby Project View"), true);
  assertEquals(isAssetList(CLIENT_SPACE, "Meeting Calls"), false);
  assertEquals(isAssetList(CLIENT_SPACE, "Bearaby Guidelines"), false);
  assertEquals(isAssetList(PROD_SPACE, "Something Project View"), false);
  assertEquals(OS_SPACE_IDS.length, 3);
});

Deno.test("internal tasks: no client, subtask parent, read-only flag passed through", () => {
  const { row } = mapTask(
    { id: "s1", name: "", parent: "p1", status: { status: "Active" }, custom_fields: [] },
    { ...CTX, clientSlug: null, spaceId: PROD_SPACE, list: { id: "901419234642", name: "Creator Management" }, readOnly: true },
  );
  assertEquals(row.client_slug, null);
  assertEquals(row.title, "(untitled ClickUp task)");
  assertEquals(row.clickup_parent_id, "p1");
  assertEquals(row.status, "active");
  assertEquals(row.is_asset, false);
  assertEquals(row.read_only, true);
  assertEquals(row.hooks, []);
  assertEquals(row.qa_checklist, []);
  assertEquals(row.assignees, []);
  assertEquals(row.description, null);
});

Deno.test("diff reports only fields that differ, in text form", () => {
  const { row } = mapTask(TASK, CTX);
  const app: Record<string, unknown> = { ...row };
  assertEquals(diffTask(app, row), []);

  app.status = "complete";
  app.title = "Renamed in app";
  app.hooks = [];
  app.due_date = "2026-11-20T00:00:00";
  const diffs = diffTask(app, row);
  assertEquals(diffs.map((d) => d.field).sort(), ["hooks", "status", "title"]);
  const status = diffs.find((d) => d.field === "status")!;
  assertEquals(status, { clickup_task_id: "86abc", field: "status", app_value: "complete", clickup_value: "editing" });
  assertEquals(diffs.find((d) => d.field === "hooks")!.clickup_value, '["Hook one"]');
});

// ------------------------------------------------------------------ the rest of the ClickUp task

const RICH: CuTask = {
  ...TASK,
  markdown_description: "Shoot at the **studio**.\n",
  priority: { priority: "High" },
  start_date: ms("2026-11-09T12:00:00Z"),
  tags: [{ name: "gifting" }, { name: "  " }, { name: "q4" }],
  creator: { id: 7, username: "Pat Strategist", email: "Pat.S@Goodo.test" },
  time_estimate: 5400000,
  custom_fields: [
    ...(TASK.custom_fields ?? []),
    { id: "cf-chk", name: "Rush", type: "checkbox", value: "true" },
    { id: "cf-chk2", name: "Late", type: "checkbox", value: null },
    { id: "cf-num", name: "Budget", type: "number", value: "1200.50" },
    {
      id: "cf-lbl",
      name: "Channels",
      type: "labels",
      value: ["l1", "l3"],
      type_config: { options: [{ id: "l1", name: "Meta" }, { id: "l2", name: "TikTok" }, { id: "l3", name: "YouTube" }] },
    },
  ],
};

Deno.test("maps the markdown description, priority, start date, tags, creator, estimate and creation time", () => {
  const { row } = mapTask(RICH, CTX);
  assertEquals(row.description, "Shoot at the studio.");
  assertEquals(row.description_markdown, "Shoot at the **studio**.");
  assertEquals(row.priority, "high");
  assertEquals(row.start_date, "2026-11-09");
  assertEquals(row.clickup_tags, ["gifting", "q4"]);
  assertEquals(row.clickup_creator, { id: "7", username: "Pat Strategist", email: "pat.s@goodo.test" });
  assertEquals(row.time_estimate_ms, 5400000);
  assertEquals(row.clickup_created_at, "2026-11-01T12:00:00.000Z");
});

Deno.test("a task with none of those keeps them empty", () => {
  const { row } = mapTask({ id: "bare", name: "x", status: { status: "assigned" } }, CTX);
  assertEquals(
    [row.description_markdown, row.priority, row.start_date, row.clickup_tags, row.clickup_creator, row.time_estimate_ms, row.clickup_fields],
    [null, null, null, [], null, null, []],
  );
  assertEquals(mapTask({ id: "p", name: "x", priority: { priority: "someday" } }, CTX).row.priority, null);
});

Deno.test("clickup_fields keeps every custom field with its canonical text and choices", () => {
  const { row } = mapTask(RICH, CTX);
  const by = (id: string) => row.clickup_fields.find((f) => f.id === id)!;
  assertEquals(row.clickup_fields.length, (RICH.custom_fields ?? []).length);
  assertEquals([by(FIELDS.contentType.id).type, by(FIELDS.contentType.id).display], ["drop_down", "UGC"]);
  assertEquals(by(FIELDS.contentType.id).options, [{ id: "ct-1", name: "UGC" }]);
  assertEquals(by(FIELDS.briefDue.id).display, "2026-11-05");
  assertEquals(by(FIELDS.briefHandedOff.id).display, null);
  assertEquals(by(FIELDS.hook1.id).display, "Hook one");
  assertEquals(by(FIELDS.hook2.id).display, null);
  assertEquals(by(FIELDS.reviewedBy.id).display, "sam@goodo.test");
  assertEquals([by("cf-chk").display, by("cf-chk2").display], ["true", "false"]);
  assertEquals(by("cf-num").display, "1200.5");
  assertEquals([by("cf-lbl").display, by("cf-lbl").options?.length], ["Meta, YouTube", 3]);
});

Deno.test("only text, number, date, drop-down and checkbox style fields are editable", () => {
  for (const t of ["short_text", "text", "url", "email", "phone", "number", "currency", "date", "drop_down", "checkbox"]) {
    assert(isEditableFieldType(t), t);
  }
  for (const t of ["users", "labels", "tasks", "attachments", "formula", "rating", "location", "", undefined]) {
    assert(!isEditableFieldType(t), String(t));
  }
});

Deno.test("columnsFromEntries gives the columns that mirror the fields, hooks in order", () => {
  const { row } = mapTask(RICH, CTX);
  const cols = columnsFromEntries(row.clickup_fields);
  assertEquals(cols, {
    content_type: "UGC",
    asset_url: "https://app.air.inc/a/xyz",
    brief_type: "UGC Video",
    brief_due_date: "2026-11-05",
    cut_to_strategist_date: "2026-11-14",
    cut_to_client_date: "2026-11-17",
    edit_due_date: "2026-11-13",
    production_date: "2026-11-08",
    brief_handed_off_date: null,
    hooks: ["Hook one"],
  });
  assertEquals(columnsFromEntries([]), {});
  // The mapped columns equal what mapTask puts in the row, so a sync and an edit agree.
  for (const [k, v] of Object.entries(cols)) assertEquals((row as unknown as Record<string, unknown>)[k], v, k);
  assertEquals(Object.keys(FIELD_COLUMNS).length, 11);
});

Deno.test("the nightly comparison also covers the description, markdown, priority and start date", () => {
  const { row } = mapTask(RICH, CTX);
  const app = { ...row, description_markdown: "old", priority: "low", start_date: "2026-11-01" } as Record<string, unknown>;
  const fields = diffTask(app, row).map((d) => d.field);
  assertEquals(fields, ["description_markdown", "priority", "start_date"]);
});

Deno.test("diff treats empty string, empty array and null alike", () => {
  assertEquals(asText(""), null);
  assertEquals(asText([]), null);
  assertEquals(asText(null), null);
  assertEquals(asText(false), "false");
  const { row } = mapTask({ id: "e", name: "x", status: { status: "assigned" } }, CTX);
  const app: Record<string, unknown> = { ...row, description: "", hooks: [], content_type: undefined };
  assert(diffTask(app, row).length === 0);
});
