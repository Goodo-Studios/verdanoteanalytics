// Regression guards for three sync-pipeline error-handling bugs found in the
// 2026-05-30 sync audit. These are source-invariant guards (read the edge
// function source directly) so they run in CI with no Deno/Docker/DB — the
// same pattern as claimSyncContinueSignature.test.ts.
//
//   #1 Phase 2 (aggregated insights) API error fell THROUGH to the
//      "Phase 2 complete" branch, which bumps ad_accounts.last_data_sync and
//      saveState(3). That marked insights complete and advanced the sync past
//      the unfetched pages — a silent, persistent data gap, because the bumped
//      last_data_sync stops the next incremental run from backfilling. The fix
//      is to `return` (not `break`) from the Phase 2 error branch so the sync
//      stays in phase 2 and the next /continue resumes from insights_cursor.
//
//   #2 Both the Phase 2 and Phase 4 error branches logged
//      `result.error.message`, but metaFetch returns `error` as a BOOLEAN, so
//      `.message` was always undefined ("...: undefined"). The real Meta error
//      detail is already pushed to ctx.apiErrors inside metaFetch.
//
//   #3 cleanup-stuck-syncs declared ANY sync running > 2h dead regardless of
//      heartbeat, force-failing large accounts that legitimately sync for
//      hours while still making progress. The fix gates on heartbeat staleness
//      (stall), keeping only a generous 24h absolute backstop.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FUNCTIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/functions",
);

const syncSrc = readFileSync(
  path.join(FUNCTIONS_DIR, "sync/index.ts"),
  "utf8",
);
const cleanupSrc = readFileSync(
  path.join(FUNCTIONS_DIR, "cleanup-stuck-syncs/index.ts"),
  "utf8",
);

describe("sync Phase 2 insights error handling (#1 data-gap fix)", () => {
  it("the Phase 2 pagination error branch returns and does not break", () => {
    // Capture from the Phase 2 error marker to the end of its if-block (the
    // first line that is only a closing brace).
    const block = syncSrc.match(/Phase 2 pagination halted[\s\S]*?\n\s*\}/);
    expect(block, "Phase 2 error branch not found").not.toBeNull();
    // Must return so control never reaches the last_data_sync bump + saveState(3).
    expect(block![0]).toContain("return;");
    // A bare `break` here is the bug — it falls through to "Phase 2 complete".
    expect(block![0]).not.toContain("break;");
  });

  it("Phase 2 only bumps last_data_sync / advances to phase 3 in the complete branch", () => {
    // last_data_sync update and saveState(3) must appear AFTER the
    // "Phase 2 complete" log, never inside the error branch.
    const completeIdx = syncSrc.indexOf("Phase 2 complete");
    const lastDataSyncIdx = syncSrc.indexOf("last_data_sync: new Date()");
    const saveState3Idx = syncSrc.indexOf("saveState(3");
    expect(completeIdx).toBeGreaterThan(-1);
    expect(lastDataSyncIdx).toBeGreaterThan(completeIdx);
    expect(saveState3Idx).toBeGreaterThan(completeIdx);
  });
});

describe("metaFetch error is a boolean, not an object (#2 logging fix)", () => {
  it("no call site reads .message off the boolean result.error", () => {
    // result.error is `boolean` per metaFetch's return type — `.message` is
    // always undefined. The detail lives in ctx.apiErrors (pushed by metaFetch).
    expect(syncSrc).not.toContain("result.error.message");
  });

  it("Phase 4 chunk error stays in-phase (nextUrl=null + break, idempotent re-fetch)", () => {
    // Phase 4 daily upserts are idempotent, so its error path intentionally
    // null-cursors and breaks to retry the chunk — it must NOT adopt Phase 2's
    // return semantics. Guard that behavior didn't drift.
    const block = syncSrc.match(/Phase 4 chunk[\s\S]*?\n\s*\}/);
    expect(block, "Phase 4 error branch not found").not.toBeNull();
    expect(block![0]).toContain("nextUrl = null");
    expect(block![0]).toContain("break;");
  });
});

describe("cleanup-stuck-syncs gates on stall, not wall-clock (#3 fix)", () => {
  it("no 2-hour wall-clock cap remains", () => {
    expect(cleanupSrc).not.toContain("twoHoursAgo");
    expect(cleanupSrc).not.toMatch(/2\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it("uses a generous 24h absolute backstop instead", () => {
    expect(cleanupSrc).toContain("absoluteCapMs");
    expect(cleanupSrc).toMatch(/24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it("a fresh heartbeat is only stuck once past the 24h absolute backstop", () => {
    // This is the core invariant: a progressing sync (fresh last_activity) is
    // NOT declared stuck on elapsed time alone — only the 24h backstop applies.
    expect(cleanupSrc).toContain("return startedAt < absoluteCapMs;");
  });

  it("the only time-based terminal trigger is the absolute backstop", () => {
    expect(cleanupSrc).toContain("const isWallClockExpired = startedAt < absoluteCapMs;");
  });
});
