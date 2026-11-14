// OS-023: the JavaScript scorecard follows the same rules as the pgTAP case for os_scorecard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scorecard } from "./os023-scorecard-lib.mjs";

const milestones = [
  { milestone: "brief_due", status: "client brief review" },
  { milestone: "cut_to_strategist", status: "internal review" },
  { milestone: "cut_to_client", status: "ready to send to client" },
  { milestone: "cut_to_client", status: "client review" },
];
const tasks = [
  { id: "t1", client_slug: "alpha", brief_due_date: "2026-10-05", cut_to_strategist_date: "2026-10-10", cut_to_client_date: "2026-10-20" },
  { id: "t2", client_slug: "alpha", brief_due_date: "2026-10-01", cut_to_strategist_date: null, cut_to_client_date: null },
];
const h = (task_id, from_status, to_status, changed_at) => ({ task_id, from_status, to_status, changed_at });
const history = [
  h("t1", "brief creation", "client brief review", "2026-10-04T15:00:00Z"),
  h("t1", "editing", "internal review", "2026-10-12T15:00:00Z"),
  h("t1", "internal review", "internal review edits", "2026-10-13T15:00:00Z"),
  h("t1", "internal review edits", "internal review", "2026-10-14T15:00:00Z"),
  h("t1", "versions exported", "client review", "2026-10-19T15:00:00Z"),
  h("t1", "client review", "client revisions", "2026-10-21T15:00:00Z"),
  h("t1", "client review", "complete", "2026-10-28T15:00:00Z"),
  h("t2", "brief creation", "client brief review", "2026-10-03T15:00:00Z"),
  h("t2", "brief creation", "client brief review", "2026-09-20T15:00:00Z"),
];

test("October numbers match the pgTAP case", () => {
  const [alpha, total] = scorecard({ month: "2026-10", tasks, history, milestones });
  assert.deepEqual(alpha, {
    is_total: false, client_slug: "alpha",
    briefs_done: 1, briefs_on_time: 1, cuts_to_strategist: 1, cuts_to_strategist_on_time: 0,
    cuts_to_client: 1, cuts_to_client_on_time: 1, internal_revisions: 1, client_revisions: 1, completed: 1,
  });
  assert.equal(total.is_total, true);
  assert.equal(total.completed, 1);
});

test("a month with nothing gives only an empty total row", () => {
  const rows = scorecard({ month: "2026-08", tasks, history, milestones });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].is_total, true);
  assert.equal(rows[0].briefs_done, 0);
});
