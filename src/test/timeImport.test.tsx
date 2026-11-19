/**
 * Time CSV import: the parser checks every row with its line number (dates, clock times, end or
 * hours, active client or Internal, category, overlaps inside the file), and the Time log panel
 * previews the file and writes each row through the same save path as a manual entry.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { parseTimeCsv } from "@/lib/timeImport";
import { toTimestamp } from "@/lib/timeLog";

const h = vi.hoisted(() => ({
  clients: [] as unknown[],
  inserts: [] as unknown[],
  rpcs: [] as string[],
  insertError: null as null | { message: string },
  failOnStart: "" as string,
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string, op: string): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "is", "gte", "lt", "or", "order", "limit", "range"]) b[m] = () => b;
    b.maybeSingle = () => b;
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(
        op !== "select" ? { data: null, error: null } : { data: table === "clients" ? h.clients : [], error: null },
      ).then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: (table: string) => ({
        select: () => chain(table, "select"),
        insert: (v: { start_at: string }) => {
          if (h.insertError && (!h.failOnStart || v.start_at === h.failOnStart)) return Promise.resolve({ data: null, error: h.insertError });
          h.inserts.push(v);
          return Promise.resolve({ data: null, error: null });
        },
        update: () => chain(table, "update"),
        delete: () => chain(table, "delete"),
      }),
      rpc: (fn: string) => {
        h.rpcs.push(fn);
        return Promise.resolve({ data: fn === "time_my_person" ? "person-1" : null, error: null });
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, isBuilder: true, isEmployee: false, isClient: false }),
}));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import TimeLogPage from "@/features/home/TimeLogPage";

const CLIENTS = [
  { slug: "glow", name: "Glow Drip" },
  { slug: "zeta", name: "Zeta Co" },
];
const HEADER = "Date,Start,End,Client,Category,Description";

describe("parseTimeCsv", () => {
  it("reads rows with an end time, matching clients by name or slug and Internal, and categories in any case", () => {
    const r = parseTimeCsv(`${HEADER}\n2026-11-02,09:00,10:30,Glow Drip,editing,Cut v1\n2026-11-02,11:00,11:45,zeta,Admin,\n2026-11-03,9:00 AM,5:15 PM,Internal,Meetings,Planning`, CLIENTS);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.clientSlug, x.category, x.start, x.end, x.seconds])).toEqual([
      ["glow", "Editing", "09:00", "10:30", 5400],
      ["zeta", "Admin", "11:00", "11:45", 2700],
      [null, "Meetings", "09:00", "17:15", 29700],
    ]);
    expect(r.rows[0].startAt).toBe(toTimestamp("2026-11-02", "09:00"));
    expect(r.totalSeconds).toBe(5400 + 2700 + 29700);
  });

  it("works from Hours when there is no end, including a late start that rolls to the next day", () => {
    const r = parseTimeCsv("Date,Start,Hours,Client,Category\n11/02/2026,09:00,1.5,glow,Editing\n2026-11-02,23:00,1:30,glow,Editing", CLIENTS);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ end: "10:30", seconds: 5400, date: "2026-11-02" });
    expect(r.rows[1]).toMatchObject({ end: "00:30", endDate: "2026-11-03", seconds: 5400 });
  });

  it("accepts a file made by the Time report export, ignoring the person columns", () => {
    const csv = "Date,Start,End,Hours,H:MM,Person,Email,Client,Task,Content type,Category,Description\n2026-11-02,09:00,10:00,1,1:00,Sam,sam@example.test,Glow Drip,,,Editing,Cut";
    const r = parseTimeCsv(csv, CLIENTS);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });

  it("rejects a client that is not active, a bad category, a bad date, a bad time and an end before the start, by line", () => {
    const r = parseTimeCsv(
      `${HEADER}\n2026-11-02,09:00,10:00,Old Client,Editing,\n2026-11-02,09:00,10:00,glow,Napping,\n2026-02-30,09:00,10:00,glow,Editing,\n2026-11-02,25:00,26:00,glow,Editing,\n2026-11-02,10:00,09:00,glow,Editing,\n2026-11-02,10:00,11:00,,Editing,`,
      CLIENTS,
    );
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(r.errors[0].message).toMatch(/not an active client/);
    expect(r.errors[1].message).toMatch(/not a category/);
    expect(r.errors[2].message).toMatch(/not a date/);
    expect(r.errors[3].message).toMatch(/not a start time/);
    expect(r.errors[4].message).toMatch(/end must be after the start/);
    expect(r.errors[5].message).toMatch(/Client is empty/);
    expect(r.rows).toEqual([]);
  });

  it("flags rows that overlap each other and rows longer than 24 hours", () => {
    const r = parseTimeCsv(`${HEADER}\n2026-11-02,09:00,10:00,glow,Editing,\n2026-11-02,09:30,10:30,glow,Editing,\nDate,Start,End,Client,Category,Description`, CLIENTS);
    expect(r.errors.some((e) => e.line === 3 && /Overlaps the entry on line 2/.test(e.message))).toBe(true);
    const long = parseTimeCsv("Date,Start,Hours,Client,Category\n2026-11-02,09:00,25,glow,Editing", CLIENTS);
    expect(long.errors[0].message).toMatch(/longer than 24 hours/);
  });

  it("refuses files with missing or unknown columns, no rows, or too many rows", () => {
    expect(parseTimeCsv("Date,Start,End,Client\n2026-11-02,09:00,10:00,glow", CLIENTS).fatal).toMatch(/Missing column: category/);
    expect(parseTimeCsv("Date,Start,Client,Category\n2026-11-02,09:00,glow,Editing", CLIENTS).fatal).toMatch(/End column or an Hours column/);
    expect(parseTimeCsv(`${HEADER},Mood\n2026-11-02,09:00,10:00,glow,Editing,,ok`, CLIENTS).fatal).toMatch(/Unknown column: Mood/);
    expect(parseTimeCsv(HEADER, CLIENTS).fatal).toMatch(/header row/);
    const many = [HEADER, ...Array.from({ length: 201 }, () => "2026-11-02,09:00,10:00,glow,Editing,")].join("\n");
    expect(parseTimeCsv(many, CLIENTS).fatal).toMatch(/at most 200/);
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/builder/time?week=2026-11-02"]}>
        <TimeLogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openPanel() {
  renderPage();
  fireEvent.click(screen.getByTestId("time-import-open"));
  const area = await screen.findByLabelText("Time CSV text");
  // Wait for the active client list to load before checking a file against it.
  await waitFor(() => expect(screen.getByTestId("time-import-check")).toBeEnabled());
  return area;
}

describe("Time log import panel", () => {
  beforeEach(() => {
    h.clients = CLIENTS;
    h.inserts = [];
    h.rpcs = [];
    h.insertError = null;
    h.failOnStart = "";
  });
  afterEach(() => cleanup());

  it("previews valid rows and writes each one like a manual entry (no task, the person row first)", async () => {
    const area = await openPanel();
    fireEvent.change(area, { target: { value: `${HEADER}\n2026-11-02,09:00,10:30,Glow Drip,Editing,Cut v1\n2026-11-03,13:00,14:00,Internal,Admin,Invoices` } });
    fireEvent.click(screen.getByTestId("time-import-check"));
    const preview = await screen.findByTestId("time-import-preview");
    expect(preview).toHaveTextContent("2 entries ready, 2h 30m in total.");
    expect(within(preview).getAllByTestId("time-import-row")).toHaveLength(2);
    expect(h.inserts).toHaveLength(0);

    fireEvent.click(screen.getByTestId("time-import-run"));
    await waitFor(() => expect(h.inserts).toHaveLength(2));
    expect(h.inserts[0]).toEqual({
      task_id: null,
      client_slug: "glow",
      is_internal: false,
      category: "Editing",
      description: "Cut v1",
      start_at: toTimestamp("2026-11-02", "09:00"),
      end_at: toTimestamp("2026-11-02", "10:30"),
      person_id: "person-1",
    });
    expect(h.inserts[1]).toMatchObject({ client_slug: null, is_internal: true, category: "Admin" });
    expect(await screen.findByTestId("time-import-summary")).toHaveTextContent("Added 2 of 2 entries.");
  });

  it("imports nothing and lists the line when any row is wrong", async () => {
    const area = await openPanel();
    fireEvent.change(area, { target: { value: `${HEADER}\n2026-11-02,09:00,10:30,Glow Drip,Editing,\n2026-11-03,13:00,14:00,Gone Client,Admin,` } });
    fireEvent.click(screen.getByTestId("time-import-check"));
    expect(await screen.findByTestId("time-import-errors")).toHaveTextContent("Line 3");
    expect(screen.getByTestId("time-import-errors")).toHaveTextContent("Nothing was imported");
    expect(screen.queryByTestId("time-import-run")).toBeNull();
    expect(h.inserts).toHaveLength(0);
  });

  it("an inactive client is not accepted, because only active clients are loaded", async () => {
    h.clients = [{ slug: "glow", name: "Glow Drip" }];
    const area = await openPanel();
    fireEvent.change(area, { target: { value: `${HEADER}\n2026-11-02,09:00,10:30,Zeta Co,Editing,` } });
    fireEvent.click(screen.getByTestId("time-import-check"));
    expect(await screen.findByTestId("time-import-errors")).toHaveTextContent('"Zeta Co" is not an active client');
  });

  it("reports a row the database refuses (an overlap with saved time) and keeps only that row to retry", async () => {
    const area = await openPanel();
    h.insertError = { message: 'conflicting key value violates exclusion constraint "time_entries_no_overlap"' };
    h.failOnStart = toTimestamp("2026-11-03", "13:00");
    fireEvent.change(area, { target: { value: `${HEADER}\n2026-11-02,09:00,10:30,Glow Drip,Editing,\n2026-11-03,13:00,14:00,Internal,Admin,` } });
    fireEvent.click(screen.getByTestId("time-import-check"));
    fireEvent.click(await screen.findByTestId("time-import-run"));
    expect(await screen.findByTestId("time-import-summary")).toHaveTextContent("Added 1 of 2 entries. 1 could not be added.");
    expect(screen.getByTestId("time-import-failed")).toHaveTextContent("Line 3: This time overlaps another of your entries.");
    expect(h.inserts).toHaveLength(1);
    // Only the refused row is left to import again.
    expect(screen.getByTestId("time-import-run")).toHaveTextContent("Import 1 entry");
  });
});
