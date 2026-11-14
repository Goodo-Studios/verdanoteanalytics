/**
 * Pure helpers behind the ClickUp fields of the task modal: which field types are edited, how the
 * stored field list is cleaned, which text is the brief and which columns an edit of it writes,
 * the time estimate, people and links, the staff pickers' list, and the guard on editable columns.
 */
import { describe, expect, it } from "vitest";
import {
  briefOf,
  briefUpdate,
  formatEstimate,
  isEditableField,
  isWebLink,
  personText,
  toFieldEntries,
} from "@/lib/taskFields";
import { EDITABLE_TASK_COLUMNS, toStaffPeople } from "@/hooks/useTaskEdit";

describe("isEditableField", () => {
  it("edits text, link, number, date, drop-down and checkbox fields", () => {
    for (const t of ["short_text", "text", "url", "email", "phone", "number", "currency", "date", "drop_down", "checkbox"]) {
      expect(isEditableField(t), t).toBe(true);
    }
  });
  it("shows people, labels, tasks, attachments and formulas without editing them", () => {
    for (const t of ["users", "labels", "tasks", "attachments", "formula", "rating", "location", "", null, undefined]) {
      expect(isEditableField(t as string | null | undefined), String(t)).toBe(false);
    }
  });
});

describe("toFieldEntries", () => {
  it("keeps well-formed entries and drops the rest", () => {
    const out = toFieldEntries([
      { id: "a", name: "Type", type: "drop_down", display: "Hook", options: [{ id: "o1", name: "Hook" }, { id: 5, name: "bad" }, { id: "o3", name: "" }] },
      { id: "b", name: "", type: "number", display: null },
      { id: "", name: "No id", type: "text" },
      null,
      { name: "No id either" },
      { id: "c", type: 7, display: 9 },
    ]);
    expect(out).toEqual([
      { id: "a", name: "Type", type: "drop_down", display: "Hook", options: [{ id: "o1", name: "Hook" }] },
      { id: "b", name: "b", type: "number", display: null },
      { id: "c", name: "c", type: "", display: null },
    ]);
  });
  it("returns an empty list for anything that is not a list", () => {
    expect(toFieldEntries(null)).toEqual([]);
    expect(toFieldEntries("x")).toEqual([]);
    expect(toFieldEntries({})).toEqual([]);
  });
});

describe("the brief", () => {
  it("is ClickUp's markdown, then its plain text, then the app brief, for a ClickUp task", () => {
    const base = { clickup_task_id: "cu1", brief: "app", description: "plain", description_markdown: "**md**" };
    expect(briefOf(base)).toBe("**md**");
    expect(briefOf({ ...base, description_markdown: null })).toBe("plain");
    expect(briefOf({ ...base, description_markdown: null, description: null })).toBe("app");
    expect(briefOf({ ...base, description_markdown: null, description: null, brief: null })).toBe("");
  });
  it("is the app brief first for a task made in the app", () => {
    expect(briefOf({ clickup_task_id: null, brief: "app", description: "plain", description_markdown: null })).toBe("app");
    expect(briefOf({ clickup_task_id: null, brief: null, description: "plain", description_markdown: null })).toBe("plain");
  });
  it("is empty when there is no task", () => {
    expect(briefOf(null)).toBe("");
    expect(briefOf(undefined)).toBe("");
  });
  it("is written to both forms of the description for a ClickUp task, and to brief otherwise", () => {
    expect(briefUpdate(true, "New brief")).toEqual({ description_markdown: "New brief", description: "New brief" });
    expect(briefUpdate(false, "New brief")).toEqual({ brief: "New brief" });
  });
  it("clears the columns when the text is blank", () => {
    expect(briefUpdate(true, "  \n ")).toEqual({ description_markdown: null, description: null });
    expect(briefUpdate(false, "")).toEqual({ brief: null });
  });
});

describe("small formatters", () => {
  it("formats a time estimate", () => {
    expect(formatEstimate(5_400_000)).toBe("1h 30m");
    expect(formatEstimate(3_600_000)).toBe("1h");
    expect(formatEstimate(900_000)).toBe("15m");
    expect(formatEstimate(0)).toBeNull();
    expect(formatEstimate(null)).toBeNull();
  });
  it("names a person by name, else email", () => {
    expect(personText({ username: " Sam ", email: "s@x.test" })).toBe("Sam");
    expect(personText({ username: "", email: "s@x.test" })).toBe("s@x.test");
    expect(personText({})).toBeNull();
    expect(personText(null)).toBeNull();
  });
  it("accepts only http and https links", () => {
    expect(isWebLink("https://a.test/x")).toBe(true);
    expect(isWebLink("http://a.test")).toBe(true);
    expect(isWebLink("ftp://a.test")).toBe(false);
    expect(isWebLink("https://a.test/a b")).toBe(false);
    expect(isWebLink(null)).toBe(false);
  });
});

describe("the people pickers' list", () => {
  it("keeps active staff with a login and names them by name, else email", () => {
    expect(
      toStaffPeople([
        { auth_user_id: "u1", name: "Sam", email: "sam@x.test", active: true },
        { auth_user_id: "u2", name: "", email: "ava@x.test", active: true },
        { auth_user_id: "u3", name: "Gone", email: "gone@x.test", active: false },
        { auth_user_id: null, name: "No login", email: "n@x.test", active: true },
      ]),
    ).toEqual([
      { user_id: "u1", name: "Sam", email: "sam@x.test" },
      { user_id: "u2", name: "ava@x.test", email: "ava@x.test" },
    ]);
    expect(toStaffPeople(null)).toEqual([]);
  });
});

describe("editable task columns", () => {
  it("are the brief, dates, priority and the three roles, and nothing that is not written back or safe to edit", () => {
    expect([...EDITABLE_TASK_COLUMNS].sort()).toEqual(
      ["brief", "description", "description_markdown", "due_date", "editor_id", "priority", "producer_id", "start_date", "strategist_id"].sort(),
    );
  });
});
