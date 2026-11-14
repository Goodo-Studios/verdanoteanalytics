/**
 * "Last run" line on Operating costs and Integration health (phase 4 PR 3).
 * - Shows when the newest run happened, whether the schedule or a person ran it, and when it failed.
 * - No run yet is said plainly; a load error is not shown as "not run yet".
 * The database and schedule rules are in supabase/tests/scheduled_checks_test.sql.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ result: { data: [] as unknown, error: null as null | { message: string } }, throwNow: false, keys: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => {
        if (h.throwNow) throw new Error("no connection");
        const q = {
          eq: (_c: string, v: string) => (h.keys.push(v), q),
          order: () => q,
          limit: () => q,
          then: (r: (v: unknown) => unknown) => Promise.resolve(h.result).then(r),
        };
        return q;
      },
    }),
  },
}));

import { LastRunLine } from "@/components/LastRunLine";
import { lastRunText } from "@/lib/lastRun";

const NOW = new Date("2026-11-12T12:00:00Z");
const run = (over = {}) => ({ check_key: "budget_check", trigger: "scheduled" as const, outcome: "ok" as const, created_at: "2026-11-12T09:00:00Z", ...over });

beforeEach(() => {
  h.result = { data: [], error: null };
  h.throwNow = false;
  h.keys = [];
});
afterEach(() => cleanup());

describe("lastRunText", () => {
  it("says when, by whom, and whether it finished", () => {
    expect(lastRunText(run(), "Note.", NOW)).toBe("Last run 3 hours ago (by the schedule). Note.");
    expect(lastRunText(run({ trigger: "manual" }), "Note.", NOW)).toBe("Last run 3 hours ago (by hand). Note.");
    expect(lastRunText(run({ outcome: "failed" }), "Note.", NOW)).toBe("Last run 3 hours ago (by the schedule) did not finish. Note.");
    expect(lastRunText(null, "Note.", NOW)).toBe("Not run yet. Note.");
  });
});

describe("LastRunLine", () => {
  it("shows the newest run of the named check", async () => {
    h.result = { data: [run({ created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() })], error: null };
    render(<LastRunLine checkKey="budget_check" scheduleNote="Runs daily." />);
    expect(await screen.findByTestId("last-run-budget_check")).toHaveTextContent("Last run 2 hours ago (by the schedule). Runs daily.");
    expect(h.keys).toEqual(["budget_check"]);
  });

  it("says plainly when nothing has run", async () => {
    render(<LastRunLine checkKey="alert_check" scheduleNote="Every 30 minutes in production." />);
    expect(await screen.findByTestId("last-run-alert_check")).toHaveTextContent("Not run yet. Every 30 minutes in production.");
  });

  it("does not call a load error 'not run yet'", async () => {
    h.result = { data: null, error: { message: "denied" } };
    render(<LastRunLine checkKey="alert_check" scheduleNote="x" />);
    const line = await screen.findByTestId("last-run-alert_check");
    expect(line).toHaveTextContent("could not load");
    expect(line.textContent).not.toContain("Not run yet");
  });

  it("copes with a query that throws", async () => {
    h.throwNow = true;
    render(<LastRunLine checkKey="budget_check" scheduleNote="x" />);
    expect(await screen.findByTestId("last-run-budget_check")).toHaveTextContent("could not load");
  });
});
