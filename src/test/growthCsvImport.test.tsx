/**
 * Growth Dashboard CSV import: every row is checked with its line number, a file with any bad row
 * imports nothing, and good rows merge into the saved numbers (a stored month, day or week is
 * replaced, a stored deal is skipped, stored week totals are kept). All numbers are made up.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeCsvIntoState, parseGrowthCsv } from "@/features/growth-dashboard/csvImport";
import { CsvImportBlock } from "@/features/growth-dashboard/CsvImportBlock";
import { emptyState, withDefaults } from "@/features/growth-dashboard/model";

afterEach(() => cleanup());

describe("parseGrowthCsv", () => {
  it("reads revenue by month, by short or full month name or number", () => {
    const r = parseGrowthCsv("revenue", "month,revenue\nJul,42000\nAugust,45500.5\n9,1000\n2026-10,2000");
    expect(r.errors).toEqual([]);
    expect(r.fatal).toBeNull();
    expect(r.patch.rev).toEqual({ "6": 42000, "7": 45500.5, "8": 1000, "9": 2000 });
    expect(r.validRows).toBe(4);
  });

  it("reports each bad revenue row with its line and imports none", () => {
    const r = parseGrowthCsv("revenue", "month,revenue\nJan,100\nJul,$42,000\nAug,5\nAug,6\nSep,abc");
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 5, 6]);
    expect(r.errors[0].message).toMatch(/not a month from July to December/);
    expect(r.errors[1].message).toMatch(/Expected 2 values, found 3/);
    expect(r.errors[2].message).toMatch(/appears more than once \(first on line 4\)/);
    expect(r.errors[3].message).toMatch(/not a plain number/);
  });

  it("reads calls by day and rejects bad dates and non-whole counts", () => {
    const ok = parseGrowthCsv("calls", "date,calls\n2026-11-02,6\n2026-11-03,0");
    expect(ok.patch.calls).toEqual({ "2026-11-02": 6, "2026-11-03": 0 });
    const bad = parseGrowthCsv("calls", "date,calls\n11/02/2026,6\n2026-02-30,1\n2026-11-04,2.5");
    expect(bad.errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });

  it("reads deals and flags an empty client or a repeated deal", () => {
    const ok = parseGrowthCsv("deals", "date,client,monthly price\n2026-10-14,Glow Drip,4500");
    expect(ok.patch.deals).toEqual([{ id: "csv-2026-10-14-glowdrip-4500", date: "2026-10-14", client: "Glow Drip", price: 4500 }]);
    const bad = parseGrowthCsv("deals", "date,client,monthly price\n2026-10-14,,4500\n2026-10-15,A,10\n2026-10-15,a,10");
    expect(bad.errors.map((e) => e.message)).toEqual(["Client is empty", "This deal repeats line 3"]);
  });

  it("reads weekly output counts by channel key or name, and requires a Friday", () => {
    const ok = parseGrowthCsv("outputs", "week ending,liPosts,LinkedIn direct messages\n2026-11-06,5,10");
    expect(ok.errors).toEqual([]);
    expect(ok.patch.weeks["2026-11-06"].acts).toEqual({ liPosts: 5, liDM: 10 });
    const bad = parseGrowthCsv("outputs", "week ending,liPosts\n2026-11-05,5");
    expect(bad.errors[0].message).toMatch(/not a Friday/);
  });

  it("refuses a file with missing, unknown or no columns, or no rows", () => {
    expect(parseGrowthCsv("revenue", "month\nJul").fatal).toMatch(/Missing column: revenue/);
    expect(parseGrowthCsv("revenue", "month,revenue,notes\nJul,1,x").fatal).toMatch(/Unknown column: notes/);
    expect(parseGrowthCsv("outputs", "week ending\n2026-11-06").fatal).toMatch(/at least one channel column/);
    expect(parseGrowthCsv("calls", "date,calls").fatal).toMatch(/header row and at least one row/);
    expect(parseGrowthCsv("calls", "").fatal).toMatch(/header row/);
  });
});

describe("mergeCsvIntoState", () => {
  it("replaces stored months and days, skips stored deals and keeps stored week totals", () => {
    const stored = withDefaults({
      rev: { "6": 1, "7": 2 },
      calls: { "2026-11-02": 9 },
      deals: [{ id: "old", date: "2026-10-14", client: "glow drip", price: 4500 }],
      weeks: { "2026-11-06": { total: 7, paid: 3, spend: 100, acts: { liPosts: 1, warm: 2 } } },
    });
    const file = {
      rev: { "6": 10 },
      calls: { "2026-11-02": 1, "2026-11-03": 2 },
      deals: [
        { id: "n1", date: "2026-10-14", client: "Glow Drip", price: 4500 },
        { id: "n2", date: "2026-10-20", client: "New Co", price: 100 },
      ],
      weeks: { "2026-11-06": { total: 0, paid: 0, spend: 0, acts: { liPosts: 5 } } },
    };
    const next = mergeCsvIntoState(stored, file);
    expect(next.rev).toEqual({ "6": 10, "7": 2 });
    expect(next.calls).toEqual({ "2026-11-02": 1, "2026-11-03": 2 });
    expect(next.deals.map((d) => d.client)).toEqual(["glow drip", "New Co"]);
    expect(next.weeks["2026-11-06"]).toMatchObject({ total: 7, paid: 3, spend: 100, acts: { liPosts: 5, warm: 2 } });
  });
});

describe("CsvImportBlock", () => {
  const paste = (text: string) => fireEvent.change(screen.getByLabelText("CSV text"), { target: { value: text } });

  it("checks pasted rows, shows a preview and adds them to the saved numbers", async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<CsvImportBlock state={emptyState()} onImport={onImport} />);
    paste("month,revenue\nJul,42000\nAug,45500");
    fireEvent.click(screen.getByRole("button", { name: "Check CSV" }));
    expect(screen.getByTestId("growth-csv-preview")).toHaveTextContent("2 rows are ready to add");
    fireEvent.click(screen.getByRole("button", { name: "Add to saved numbers" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0].rev).toEqual({ "6": 42000, "7": 45500 });
    expect(await screen.findByRole("status")).toHaveTextContent("Added 2 rows to the saved numbers.");
  });

  it("shows row errors and offers no way to import when any row is wrong", () => {
    const onImport = vi.fn();
    render(<CsvImportBlock state={emptyState()} onImport={onImport} />);
    paste("month,revenue\nJul,42000\nJan,5");
    fireEvent.click(screen.getByRole("button", { name: "Check CSV" }));
    expect(screen.getByTestId("growth-csv-errors")).toHaveTextContent("Line 3");
    expect(screen.getByTestId("growth-csv-errors")).toHaveTextContent("Nothing was imported");
    expect(screen.queryByRole("button", { name: "Add to saved numbers" })).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("shows a whole-file problem, and changing the kind clears the last check", () => {
    render(<CsvImportBlock state={emptyState()} onImport={vi.fn()} />);
    paste("date,calls\n2026-11-02,3");
    fireEvent.click(screen.getByRole("button", { name: "Check CSV" }));
    expect(screen.getByTestId("growth-csv-fatal")).toHaveTextContent("Missing columns: month, revenue");
    fireEvent.change(screen.getByLabelText("CSV contents"), { target: { value: "calls" } });
    expect(screen.queryByTestId("growth-csv-fatal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check CSV" }));
    expect(screen.getByTestId("growth-csv-preview")).toBeInTheDocument();
  });

  it("keeps the rows and says so when saving fails", async () => {
    const onImport = vi.fn().mockRejectedValue(new Error("down"));
    render(<CsvImportBlock state={emptyState()} onImport={onImport} />);
    paste("month,revenue\nJul,1");
    fireEvent.click(screen.getByRole("button", { name: "Check CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to saved numbers" }));
    expect(await screen.findByText("Could not save: down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to saved numbers" })).toBeEnabled();
  });
});
