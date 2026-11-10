/**
 * The live page-query check. PostgREST refuses a select that names a column or relationship that does
 * not exist, which leaves a page empty while every mocked unit test passes (PR #173 fixed pages that
 * were broken exactly that way). So every browser query of the restructured staff shell is listed in
 * src/lib/pageQueries.ts and run against the real staging database, with the same select string, by
 * scripts/staging-client-wall-check.mjs (as the staff users, and as a client to prove the wall).
 *
 * This test keeps the two in step: a query added to the list without a line in the script, or a
 * select string edited in one place only, fails here, before it can reach staging unchecked.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_QUERIES } from "@/lib/pageQueries";

const script = readFileSync(path.resolve(__dirname, "../../scripts/staging-client-wall-check.mjs"), "utf8");
const sources = import.meta.glob("../contexts/ClientSelectionProvider.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("page queries are run by the staging wall check", () => {
  it.each(PAGE_QUERIES.map((q) => [q.table, q.select, q.usedBy, q.filter ?? ""]))("%s (%s) is run live with the same select string", (table, select, _usedBy, filter) => {
    const entry = filter ? `["${table}", "${select}", "${filter}"]` : `["${table}", "${select}"]`;
    expect(script, `${table} select "${select}" is missing from scripts/staging-client-wall-check.mjs`).toContain(entry);
  });

  it("runs a query a page filters by client for a real client, as staff and as a client", () => {
    expect(PAGE_QUERIES.some((q) => q.filter === "client_slug")).toBe(true);
    expect(script).toContain("with the Work tab query");
    expect(script).toContain("client B loads no cards of a client it does not belong to");
  });

  it("is run as a staff user and as a client", () => {
    expect(script).toContain("loads the shell page query on");
    expect(script).toContain("client A loads no client account links with the shell page query");
    expect(script).toContain("client A loads only its own clients with the shell page query");
  });

  it("the switcher sends the listed columns, not its own copy", () => {
    const source = Object.values(sources)[0];
    expect(source).toContain("CLIENT_SWITCHER_COLUMNS");
    expect(source).toContain("CLIENT_SWITCHER_LINK_COLUMNS");
    expect(source).not.toMatch(/select\("slug, name, active"\)/);
  });

  it("the Work tab sends the listed columns, not its own copy", () => {
    const hook = readFileSync(path.resolve(__dirname, "../hooks/useClientWork.ts"), "utf8");
    expect(hook).toContain("PIPELINE_TASK_COLUMNS");
    expect(hook).toContain('.eq("client_slug"');
    expect(hook).not.toContain("task_name, stage");
  });

  it("lists no query twice", () => {
    const keys = PAGE_QUERIES.map((q) => `${q.table}:${q.select}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
