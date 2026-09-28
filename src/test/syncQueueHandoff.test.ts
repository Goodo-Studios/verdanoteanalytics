// Regression guards for the 2026-09-28 queue handoff stall. After a sync
// finished inside the between-account cooldown, promoteNextQueued returned
// without promoting and nothing re-fired /continue. And when the next account
// was promoted, the finishing chain fired /continue with its own claim, which
// the new sync didn't hold, so the claim failed and the chain died. Either way
// the queue sat idle until an external cron kicked it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  COOLDOWN_WAIT_CAP_MS,
  cooldownRemainingMs,
  cooldownWaitMs,
} from "../../supabase/functions/_shared/sync-handoff";

const syncSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions/sync/index.ts"),
  "utf8",
);

describe("cooldownRemainingMs", () => {
  const now = Date.parse("2026-09-28T14:10:00Z");
  it("returns the time left inside the cooldown", () => {
    expect(cooldownRemainingMs("2026-09-28T14:09:30Z", 1, now)).toBe(30_000);
  });
  it("returns 0 once the cooldown has passed", () => {
    expect(cooldownRemainingMs("2026-09-28T14:08:00Z", 1, now)).toBe(0);
  });
  it("returns 0 with no prior completion, no cooldown, or a bad date", () => {
    expect(cooldownRemainingMs(null, 1, now)).toBe(0);
    expect(cooldownRemainingMs("2026-09-28T14:09:30Z", 0, now)).toBe(0);
    expect(cooldownRemainingMs("not a date", 1, now)).toBe(0);
  });
});

describe("cooldownWaitMs", () => {
  it("waits the remaining cooldown plus a 1s margin", () => {
    expect(cooldownWaitMs(30_000)).toBe(31_000);
  });
  it("caps a single wait so the invocation stays under the wall-clock limit", () => {
    expect(cooldownWaitMs(5 * 60_000)).toBe(COOLDOWN_WAIT_CAP_MS);
    expect(COOLDOWN_WAIT_CAP_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("sync /continue handoff wiring", () => {
  it("promoteNextQueued reports cooldown instead of silently returning", () => {
    expect(syncSrc).toContain('return { kind: "cooldown", remainingMs };');
    expect(syncSrc).not.toContain("return; // cron will retry in ~1 minute");
  });

  it("promotion clears a stale claim so a fresh kick can claim the sync", () => {
    const fn = syncSrc.match(/async function promoteNextQueued[\s\S]*?\n\}/);
    expect(fn, "promoteNextQueued not found").not.toBeNull();
    expect(fn![0]).toContain("claim_id: _staleClaim");
  });

  it("the no-running branch waits out the cooldown and re-fires /continue", () => {
    const block = syncSrc.match(/if \(!runningSyncs\?\.length\) \{[\s\S]*?\n {6}\}/);
    expect(block, "no-running branch not found").not.toBeNull();
    const b = block![0];
    expect(b).toContain('promotion.kind === "cooldown"');
    expect(b).toContain("cooldownWaitMs(promotion.remainingMs)");
    expect(b).toContain("await selfContinue(null)");
  });

  it("a finished sync hands off with a fresh (unclaimed) kick", () => {
    expect(syncSrc).toMatch(/await selfContinue\(after\?\.status === "running" \? newClaimId : null\)/);
  });
});
