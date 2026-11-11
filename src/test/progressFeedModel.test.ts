import { describe, expect, it } from "vitest";
import { deliveryText, deriveMonthDelivery, lastUpdatedLine, progressText } from "@/features/dashboard/model";
import { auditOutcomeLabel, secretNameFor, tokenState } from "@/features/integration-health/ingestModel";

const NOW = new Date("2026-11-10T12:00:00Z");

describe("last updated and progress lines", () => {
  it("covers hand-made, never updated and updated clients", () => {
    expect(lastUpdatedLine({ origin: "manual", last_synced: null }, NOW)).toBe("Added by hand");
    expect(lastUpdatedLine({ origin: "coda", last_synced: null }, NOW)).toBe("Waiting for the first update from HQ");
    expect(lastUpdatedLine({ origin: "coda", last_synced: "2026-11-10T09:00:00Z" }, NOW)).toBe("Last updated 3 hr ago");
  });
  it("never shows a bare zero", () => {
    expect(progressText(null, { origin: "coda", last_synced: null })).toMatch(/^No progress yet/);
    expect(progressText(null, { origin: "manual", last_synced: null })).toBe("No progress recorded");
    expect(progressText(0, { origin: "coda", last_synced: null })).toBe("0% complete");
    expect(progressText(140, { origin: "coda", last_synced: null })).toBe("100% complete");
  });
});

describe("deriveMonthDelivery", () => {
  const open = [
    { stage: "Ready to Launch", cycle_month: "2026-11-01", delivered_at: "2026-11-05" },
    { stage: "Editing", cycle_month: "2026-11-01", delivered_at: null },
    { stage: "Editing", cycle_month: "2026-10-01", delivered_at: null },
  ];
  const old = [{ cycle_month: "2026-11-01", delivered_at: "2026-11-02" }];
  it("counts open and archived delivered work for the month and finds the last day", () => {
    const d = deriveMonthDelivery(open, old, "2026-11");
    expect(d).toEqual({ total: 3, delivered: 2, lastDelivery: "2026-11-05" });
    expect(deliveryText(d!)).toBe("2 of 3 delivered");
  });
  it("is null when ClickUp has no task for the month, so the HQ row is used", () => {
    expect(deriveMonthDelivery(open, old, "2026-09")).toBeNull();
  });
  it("falls back to the due date when the sync stored no cycle month", () => {
    expect(deriveMonthDelivery([{ stage: "Production", due_date: "2026-12-03" }], [], "2026-12")?.total).toBe(1);
  });
});

describe("ingest token helpers", () => {
  it("names the vault secret by environment", () => {
    expect(secretNameFor("production")).toBe("VERDANOTE_INGEST_TOKEN");
    expect(secretNameFor("other")).toBe("STAGING_VERDANOTE_INGEST_TOKEN");
  });
  it("reads token state and call outcomes", () => {
    expect(tokenState({ revoked_at: null })).toBe("active");
    expect(tokenState({ revoked_at: "2026-11-10T00:00:00Z" })).toBe("revoked");
    expect(auditOutcomeLabel({ outcome: "ok", rejected_count: 0, error_code: null })).toBe("accepted");
    expect(auditOutcomeLabel({ outcome: "partial", rejected_count: 2, error_code: null })).toBe("accepted, 2 refused");
    expect(auditOutcomeLabel({ outcome: "rejected", rejected_count: 0, error_code: "too_large" })).toBe("refused: the body was too large");
  });
});
