// The pure parts of scripts/migrate-goodo-time.mjs (OS-011): the target check, mapping
// Goodo Time rows, and the per-person per-month totals comparison.
import { describe, expect, it } from "vitest";
import {
  STAGING_REF,
  assertTarget,
  compareCounts,
  compareTotals,
  formatTotals,
  mapEntry,
  mapInvoice,
  mapInvoiceLine,
  mapPerson,
  mapProject,
  monthKey,
  parseArgs,
  totalsByPersonMonth,
} from "../../scripts/migrate-goodo-time-lib.mjs";

const zone = "America/New_York";

describe("command line and target", () => {
  it("reads the flags and refuses unknown ones", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, allowProduction: false, help: false });
    expect(parseArgs(["--dry-run", "--allow-production"])).toMatchObject({ dryRun: true, allowProduction: true });
    expect(() => parseArgs(["--dryrun"])).toThrow(/Unknown option/);
  });

  it("allows the staging project and refuses any other target without --allow-production", () => {
    expect(assertTarget(`https://${STAGING_REF}.supabase.co`)).toBe(`${STAGING_REF}.supabase.co`);
    expect(() => assertTarget("https://prodref123456789.supabase.co")).toThrow(/not the staging project/);
    expect(() => assertTarget(`https://evil.example.com/${STAGING_REF}`)).toThrow(/not the staging project/);
    expect(() => assertTarget(`https://${STAGING_REF}-x.example.com`)).toThrow(/not the staging project/);
    expect(assertTarget("https://prodref123456789.supabase.co", { allowProduction: true })).toBe("prodref123456789.supabase.co");
    expect(() => assertTarget(undefined)).toThrow(/Set TARGET_SUPABASE_URL/);
    expect(() => assertTarget(`http://${STAGING_REF}.supabase.co`)).toThrow(/https/);
  });
});

describe("mapping Goodo Time rows", () => {
  it("maps a person by lower-case email and leaves out address, payment and sign-in fields", () => {
    const row = mapPerson({
      id: 7, email: "  Alice@GoodoStudios.com ", name: "Alice", role: "admin", active: true, monthly_fee_cents: 500000,
      password_hash: "x", invoice_from: "1 Main St", payment_details: "Zelle",
    });
    expect(row).toEqual({
      source_id: 7, email: "alice@goodostudios.com", name: "Alice", source_role: "admin", active: true, monthly_fee_cents: 500000,
    });
    expect(() => mapPerson({ id: 8, email: "", name: "No email" })).toThrow(/no usable email/);
  });

  it("maps projects, invoices, lines and entries onto the copied ids", () => {
    const clientIds = new Map([[1, "client-uuid"]]);
    const personIds = new Map([[7, "person-uuid"]]);
    const projectIds = new Map([[3, "project-uuid"]]);
    const invoiceIds = new Map([[5, "invoice-uuid"]]);

    expect(mapProject({ id: 3, client_id: 1, name: "Brand film", archived: false }, clientIds)).toMatchObject({
      source_id: 3, client_id: "client-uuid",
    });
    expect(mapProject({ id: 4, client_id: null, name: "Reels", archived: true }, clientIds)).toMatchObject({
      client_id: null, archived: true,
    });

    const invoice = mapInvoice({
      id: 5, user_id: 7, number: 1, status: "submitted", period_from: "2026-10-16", period_to: "2026-10-31",
      issued_on: "2026-11-02", due_on: null, from_details: "1 Main St", payment_details: "Zelle", bill_to: "Goodo Studios",
      notes: "", submitted_at: new Date("2026-11-02T15:00:00Z"), paid_at: null,
    }, personIds);
    expect(invoice).toMatchObject({ person_id: "person-uuid", status: "submitted", period_from: "2026-10-16", submitted_at: "2026-11-02T15:00:00.000Z" });
    expect(invoice).not.toHaveProperty("from_details");
    expect(invoice).not.toHaveProperty("payment_details");

    expect(mapInvoiceLine({ id: 9, invoice_id: 5, kind: "time", description: "Reels", seconds: 2700, amount_cents: 0, position: 1 }, invoiceIds))
      .toEqual({ source_id: 9, invoice_id: "invoice-uuid", kind: "time", description: "Reels", seconds: 2700, amount_cents: 0, position: 1 });

    const running = mapEntry({ id: 11, user_id: 7, project_id: null, description: "", start_at: "2026-10-30T13:00:00Z", end_at: null, invoice_id: null },
      { personIds, projectIds, invoiceIds });
    expect(running).toMatchObject({ person_id: "person-uuid", project_id: null, end_at: null, invoice_id: null, start_at: "2026-10-30T13:00:00.000Z" });
    const billed = mapEntry({ id: 12, user_id: 7, project_id: 3, description: "Cut", start_at: "2026-10-30T14:00:00Z", end_at: "2026-10-30T15:00:00Z", invoice_id: 5 },
      { personIds, projectIds, invoiceIds });
    expect(billed).toMatchObject({ project_id: "project-uuid", invoice_id: "invoice-uuid" });
  });

  it("stops when a row points at something that was not copied", () => {
    expect(() => mapEntry({ id: 1, user_id: 99, start_at: "2026-10-30T13:00:00Z" },
      { personIds: new Map(), projectIds: new Map(), invoiceIds: new Map() })).toThrow(/No person was copied for Goodo Time id 99/);
  });
});

describe("totals per person per month", () => {
  const rows = [
    { email: "alice@goodostudios.com", start_at: "2026-10-30T13:00:00Z", end_at: "2026-10-30T14:30:00Z" },
    { email: "Alice@GoodoStudios.com", start_at: "2026-10-31T13:00:00Z", end_at: "2026-10-31T13:45:00Z" },
    // 31 Oct 23:30 in New York: still October in the studio, though it is November in UTC.
    { email: "alice@goodostudios.com", start_at: "2026-11-01T03:30:00Z", end_at: "2026-11-01T04:00:00Z" },
    { email: "alice@goodostudios.com", start_at: "2026-11-02T13:00:00Z", end_at: "2026-11-02T14:00:00Z" },
    // Running timers are not counted, as in Goodo Time's reports.
    { email: "bob@goodostudios.com", start_at: "2026-11-03T13:00:00Z", end_at: null },
  ];

  it("groups by email and the month the entry started in, in the studio zone", () => {
    expect(monthKey("2026-11-01T03:30:00Z", zone)).toBe("2026-10");
    expect(monthKey("2026-11-01T05:30:00Z", zone)).toBe("2026-11");
    const totals = totalsByPersonMonth(rows, zone);
    expect([...totals.entries()]).toEqual([
      ["alice@goodostudios.com|2026-10", { ms: (90 + 45 + 30) * 60_000, entries: 3 }],
      ["alice@goodostudios.com|2026-11", { ms: 60 * 60_000, entries: 1 }],
    ]);
  });

  it("finds no difference when the copy matches", () => {
    expect(compareTotals(totalsByPersonMonth(rows, zone), totalsByPersonMonth(rows, zone))).toEqual([]);
  });

  it("reports a missing entry, a changed time and an extra person", () => {
    const source = totalsByPersonMonth(rows, zone);
    const missing = totalsByPersonMonth(rows.slice(1), zone);
    expect(compareTotals(source, missing).map((d) => d.key)).toEqual(["alice@goodostudios.com|2026-10"]);

    const changed = totalsByPersonMonth([{ ...rows[0], end_at: "2026-10-30T14:30:01Z" }, ...rows.slice(1)], zone);
    expect(compareTotals(source, changed)).toEqual([
      { key: "alice@goodostudios.com|2026-10", source: { ms: 9_900_000, entries: 3 }, target: { ms: 9_901_000, entries: 3 } },
    ]);

    const extra = totalsByPersonMonth([...rows, { email: "carol@goodostudios.com", start_at: "2026-10-05T13:00:00Z", end_at: "2026-10-05T14:00:00Z" }], zone);
    expect(compareTotals(source, extra).map((d) => d.key)).toEqual(["carol@goodostudios.com|2026-10"]);
  });

  it("prints a line per person-month and marks differences", () => {
    const source = totalsByPersonMonth(rows, zone);
    const text = formatTotals(source, totalsByPersonMonth(rows.slice(1), zone));
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toMatch(/2026-10 {2}alice@goodostudios\.com +source +2\.75 h \(3\) +target +1\.25 h \(2\) {2}DIFFERENT/);
    expect(text).toMatch(/2026-11.*ok$/);
  });

  it("compares row counts per table", () => {
    expect(compareCounts({ time_entries: 3, time_people: 2 }, { time_entries: 3, time_people: 2 })).toEqual([]);
    expect(compareCounts({ time_entries: 3 }, { time_entries: 2 })).toEqual([{ table: "time_entries", source: 3, target: 2 }]);
  });
});
