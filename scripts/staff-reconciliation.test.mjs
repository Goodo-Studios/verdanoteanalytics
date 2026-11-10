import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNotProduction, countIssues, formatReport, ISSUE_ORDER } from "./staff-reconciliation-lib.mjs";

test("countIssues counts people, clean rows and each issue", () => {
  const r = countIssues([
    { email: "a@example.test", issues: [] },
    { email: "b@example.test", issues: ["no_login", "possible_name_match"] },
    { email: "c@example.test", issues: ["not_on_team_list", "possible_name_match"] },
    { email: "d@example.test", issues: null },
  ]);
  assert.equal(r.people, 4);
  assert.equal(r.clean, 2);
  assert.equal(r.withIssues, 2);
  assert.equal(r.counts.no_login, 1);
  assert.equal(r.counts.not_on_team_list, 1);
  assert.equal(r.counts.possible_name_match, 2);
  assert.equal(r.counts.role_differs, 0);
});

test("countIssues keeps an issue name it does not know", () => {
  assert.equal(countIssues([{ issues: ["something_new"] }]).counts.something_new, 1);
});

test("formatReport prints every known issue in order and no personal data", () => {
  const out = formatReport(countIssues([{ email: "secret@example.test", team_name: "Secret Name", issues: ["no_login"] }]));
  const lines = out.split("\n");
  assert.deepEqual(lines.slice(0, 3), ["people 1", "lined up 0", "with at least one issue 1"]);
  assert.deepEqual(lines.slice(3).map((l) => l.split(" ")[0]), ISSUE_ORDER);
  assert.ok(!out.includes("secret@example.test"));
  assert.ok(!out.includes("Secret Name"));
});

test("assertNotProduction refuses the production project and a missing URL", () => {
  assert.throws(() => assertNotProduction("https://gwyxaqoaldnaavkjqquv.supabase.co"), /production/);
  assert.throws(() => assertNotProduction(undefined), /Set STAGING_SUPABASE_URL/);
  assert.doesNotThrow(() => assertNotProduction("https://mnvcksbhbvypuiwozvct.supabase.co"));
});
