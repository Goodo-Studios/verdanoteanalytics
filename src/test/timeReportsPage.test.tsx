/**
 * Time reports page and the client hub's month-hours card (OS-013), with the data hooks mocked.
 *
 * Page: switching the grouping regroups the same entries (totals from the hand-checked sample in
 * timeReports.test.ts); a builder gets the person filter and grouping, a member gets neither; the
 * client and person filters narrow the list; Download CSV makes a Blob with the BOM, the header and
 * one row per entry; a bad custom range shows a message. Card: under scope, over scope (late colour),
 * no scope set, a builder can set the hours, and a client or the client preview sees nothing and
 * asks for nothing.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportEntry } from "@/lib/timeReports";

const h = vi.hoisted(() => ({
  role: "builder" as "builder" | "employee" | "client",
  preview: null as null | "client" | "employee",
  entries: [] as unknown[],
  reportArgs: [] as unknown[][],
  month: { data: { seconds: 0, scopeHours: null as number | null }, isLoading: false, isError: false } as Record<string, unknown>,
  monthArgs: [] as unknown[][],
  setHours: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, isBuilder: h.role === "builder", isEmployee: h.role === "employee", isClient: h.role === "client" }),
}));
vi.mock("@/hooks/useClientPreviewMode", () => ({
  useClientPreview: () => ({ isClientPreview: h.preview === "client", isEmployeePreview: h.preview === "employee" }),
}));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("@/hooks/useTimeReports", () => ({
  useTimeReport: (...args: unknown[]) => {
    h.reportArgs.push(args);
    return { data: h.entries, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useClientMonthHours: (...args: unknown[]) => {
    h.monthArgs.push(args);
    return h.month;
  },
  useSetScopeHours: () => ({ mutate: h.setHours, isPending: false }),
}));

import TimeReportsPage from "@/features/home/TimeReportsPage";
import { ClientMonthHours } from "@/features/clients/ClientMonthHours";

const ALICE = { name: "Alice", email: "alice@example.test" };
const BOB = { name: "Bob", email: "bob@example.test" };
const GLOW = { name: "Glow Drip" };
function entry(p: Partial<ReportEntry> & Pick<ReportEntry, "id" | "start_at" | "end_at">): ReportEntry {
  return {
    person_id: "alice", task_id: null, client_slug: null, is_internal: false, category: null, description: "",
    source_id: null, project_id: null, person: ALICE, task: null, client: null, project: null, ...p,
  };
}
// Same made-up sample as timeReports.test.ts, completed entries only.
const SAMPLE: ReportEntry[] = [
  entry({ id: "e1", task_id: "t1", task: { title: "Cut v1", content_type: "Video" }, client_slug: "glow", client: GLOW, category: "Editing", start_at: "2026-11-02T14:00:00Z", end_at: "2026-11-02T16:00:00Z" }),
  entry({ id: "e2", task_id: "t2", task: { title: "Hooks", content_type: "Static" }, client_slug: "glow", client: GLOW, start_at: "2026-11-03T14:00:00Z", end_at: "2026-11-03T14:30:00Z" }),
  entry({ id: "e3", person_id: "bob", person: BOB, client_slug: "glow", client: GLOW, category: "Strategy", start_at: "2026-11-04T15:00:00Z", end_at: "2026-11-04T16:15:00Z", description: "Plan, \"v2\"" }),
  entry({ id: "e4", person_id: "bob", person: BOB, is_internal: true, category: "Admin", start_at: "2026-11-05T13:00:00Z", end_at: "2026-11-05T13:45:00Z" }),
  entry({ id: "e5", person_id: "bob", person: BOB, source_id: 7, project_id: "p1", project: { name: "Retainer", client: { name: "glow drip" } }, start_at: "2026-11-06T14:00:00Z", end_at: "2026-11-06T17:00:00Z" }),
  entry({ id: "e6", source_id: 8, project_id: "p2", project: { name: "Studio", client: null }, start_at: "2026-11-07T14:00:00Z", end_at: "2026-11-07T15:00:00Z", description: "=cmd" }),
];

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/builder/time/reports"]}>
      <TimeReportsPage />
    </MemoryRouter>,
  );

const groupRows = () =>
  screen.getAllByTestId("time-report-group-row").map((r) => [
    within(r).getByTestId("time-report-group-label").textContent,
    within(r).getByTestId("time-report-group-hours").textContent,
  ]);

beforeEach(() => {
  h.role = "builder";
  h.preview = null;
  h.entries = SAMPLE;
  h.reportArgs = [];
  h.monthArgs = [];
  h.month = { data: { seconds: 0, scopeHours: null }, isLoading: false, isError: false };
  h.setHours.mockReset();
});

describe("time reports page", () => {
  it("groups by client first and switches grouping", () => {
    renderPage();
    // Glow Drip = 2 + 0.5 + 1.25 + 3 = 6.75 h
    expect(groupRows()).toEqual([
      ["Glow Drip", "6.75 h"],
      ["(No client)", "1.00 h"],
      ["Internal", "0.75 h"],
    ]);
    expect(screen.getByTestId("time-report-total")).toHaveTextContent("Total 8.50 h (8:30, 6 entries)");

    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "person" } });
    expect(groupRows()).toEqual([
      ["Bob", "5.00 h"],
      ["Alice", "3.50 h"],
    ]);

    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "category" } });
    expect(groupRows()).toEqual([
      ["Unsorted (Goodo Time)", "4.00 h"],
      ["Editing", "2.00 h"],
      ["Strategy", "1.25 h"],
      ["Admin", "0.75 h"],
      ["(No category)", "0.50 h"],
    ]);

    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "contentType" } });
    expect(groupRows()[0]).toEqual(["(No content type)", "6.00 h"]);

    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "task" } });
    expect(groupRows()[0]).toEqual(["Goodo Time: glow drip / Retainer", "3.00 h"]);
  });

  it("gives a builder the person filter, and the filters narrow the list", () => {
    renderPage();
    const person = screen.getByLabelText("Person");
    fireEvent.change(person, { target: { value: "bob" } });
    expect(screen.getByTestId("time-report-total")).toHaveTextContent("Total 5.00 h");
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "c:glow drip" } });
    // Bob on Glow Drip = e3 1.25 + e5 3 = 4.25 h
    expect(groupRows()).toEqual([["Glow Drip", "4.25 h"]]);
  });

  it("gives a member no person filter and no person grouping", () => {
    h.role = "employee";
    renderPage();
    expect(screen.queryByLabelText("Person")).toBeNull();
    const options = within(screen.getByLabelText("Group by")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Client", "Task", "Content type", "Category"]);
    expect(screen.getByLabelText("Client")).toBeTruthy();
  });

  it("treats a builder previewing as an employee like a member", () => {
    h.preview = "employee";
    renderPage();
    expect(screen.queryByLabelText("Person")).toBeNull();
  });

  it("asks for the chosen range and shows a plain message for a bad custom range", () => {
    renderPage();
    const first = h.reportArgs[h.reportArgs.length - 1];
    expect(typeof first[0]).toBe("string");
    fireEvent.change(screen.getByLabelText("Range"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-01" } });
    expect(screen.getByTestId("time-report-range-error")).toHaveTextContent("The end date must be on or after the start date.");
    expect(h.reportArgs[h.reportArgs.length - 1].slice(0, 2)).toEqual([null, null]);
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-12" } });
    expect(h.reportArgs[h.reportArgs.length - 1].slice(0, 2)).toEqual(["2026-11-10T05:00:00.000Z", "2026-11-13T05:00:00.000Z"]);
  });

  it("shows an empty state with no time", () => {
    h.entries = [];
    renderPage();
    expect(screen.getByTestId("time-report-empty")).toBeTruthy();
    // The CSV still downloads, with only its header.
    expect(screen.getByTestId("time-report-csv")).toBeEnabled();
  });

  describe("CSV download", () => {
    let blobs: Blob[];
    const create = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:report";
    });
    const revoke = vi.fn();
    let clickSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      blobs = [];
      Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });
    afterEach(() => clickSpy.mockRestore());

    const text = (b: Blob) =>
      new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsText(b);
      });

    it("downloads a Blob with the BOM, the header and one row per entry of the filtered set", async () => {
      renderPage();
      fireEvent.change(screen.getByLabelText("Person"), { target: { value: "bob" } });
      fireEvent.click(screen.getByTestId("time-report-csv"));
      expect(clickSpy).toHaveBeenCalledTimes(1);
      const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
      expect(anchor.download).toMatch(/^time-report-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(blobs).toHaveLength(1);
      expect(blobs[0].type).toBe("text/csv;charset=utf-8");
      const bytes = new Uint8Array(
        await new Promise<ArrayBuffer>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as ArrayBuffer);
          r.readAsArrayBuffer(blobs[0]);
        }),
      );
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
      const raw = await text(blobs[0]);
      const csv = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const lines = csv.split("\r\n");
      expect(lines[0]).toBe("Date,Start,End,Hours,H:MM,Person,Email,Client,Task,Content type,Category,Description");
      expect(lines.slice(1, -1)).toEqual([
        '2026-11-04,10:00,11:15,1.25,1:15,Bob,bob@example.test,Glow Drip,(No task),(No content type),Strategy,"Plan, ""v2"""',
        "2026-11-05,08:00,08:45,0.75,0:45,Bob,bob@example.test,Internal,(No task),(No content type),Admin,",
        "2026-11-06,09:00,12:00,3.00,3:00,Bob,bob@example.test,glow drip,Goodo Time: glow drip / Retainer,(No content type),Unsorted (Goodo Time),",
      ]);
      await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:report"));
    });
  });
});

describe("client hub: hours this month", () => {
  const NOW = new Date("2026-11-12T15:00:00Z");
  const renderCard = () => render(<ClientMonthHours slug="glow" now={NOW} />);

  it("shows hours under scope with a calm bar, for this calendar month in New York", () => {
    h.month = { data: { seconds: 12.5 * 3600, scopeHours: 20 }, isLoading: false, isError: false };
    renderCard();
    expect(screen.getByTestId("client-month-hours-text")).toHaveTextContent("12.5 h of 20 h this month");
    expect(screen.getByTestId("client-month-hours-text")).toHaveAttribute("data-over", "false");
    expect(screen.getByTestId("client-month-hours-bar")).toHaveAttribute("aria-label", "63 percent of scope hours used");
    expect(h.monthArgs[0]).toEqual(["glow", "2026-11-01T04:00:00.000Z", "2026-12-01T05:00:00.000Z", true]);
  });

  it("turns the late colour when over scope", () => {
    h.month = { data: { seconds: 22 * 3600, scopeHours: 20 }, isLoading: false, isError: false };
    renderCard();
    const t = screen.getByTestId("client-month-hours-text");
    expect(t).toHaveTextContent("22 h of 20 h this month");
    expect(t).toHaveAttribute("data-over", "true");
    expect(t.className).toContain("--gos-late");
    expect(screen.getByTestId("client-month-hours-bar").firstElementChild?.className).toContain("--gos-late");
  });

  it("says when no scope hours are set, and a builder can set them", () => {
    h.month = { data: { seconds: 3 * 3600, scopeHours: null }, isLoading: false, isError: false };
    renderCard();
    expect(screen.getByTestId("client-month-hours-text")).toHaveTextContent("3 h this month, no scope hours set");
    expect(screen.queryByTestId("client-month-hours-bar")).toBeNull();
    fireEvent.click(screen.getByTestId("scope-hours-edit"));
    fireEvent.change(screen.getByTestId("scope-hours-input"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("scope-hours-save"));
    expect(h.setHours).toHaveBeenCalledWith(20, expect.anything());
  });

  it("refuses a bad hours value before saving", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("scope-hours-edit"));
    fireEvent.change(screen.getByTestId("scope-hours-input"), { target: { value: "-4" } });
    fireEvent.click(screen.getByTestId("scope-hours-save"));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter hours between 0 and 744");
    expect(h.setHours).not.toHaveBeenCalled();
  });

  it("lets an employee see their own hours but not set scope", () => {
    h.role = "employee";
    h.month = { data: { seconds: 3600, scopeHours: 20 }, isLoading: false, isError: false };
    renderCard();
    expect(screen.getByTestId("client-month-hours-text")).toHaveTextContent("1 h of 20 h this month");
    expect(screen.queryByTestId("scope-hours-edit")).toBeNull();
    expect(screen.getByText("Counts only your own time. Admins see the whole team.")).toBeTruthy();
  });

  it("is hidden for a client login and asks for nothing", () => {
    h.role = "client";
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(h.monthArgs.every((a) => a[3] === false)).toBe(true);
  });

  it("is hidden for a builder previewing the client view", () => {
    h.preview = "client";
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(h.monthArgs.every((a) => a[3] === false)).toBe(true);
  });

  it("says so when the hours could not load", () => {
    h.month = { data: undefined, isLoading: false, isError: true };
    renderCard();
    expect(screen.getByTestId("client-month-hours-error")).toHaveTextContent("Hours could not load.");
  });
});
