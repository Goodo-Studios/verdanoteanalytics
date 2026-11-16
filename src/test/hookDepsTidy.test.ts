// Audit Batch 9 (lint, react-hooks/exhaustive-deps): the warnings in these files were checked one
// by one and none of them showed stale data on screen (the real bugs are fixed separately, with
// their own tests, in Quick Tag, presence and Settings). They are tidied without changing
// behavior so the remaining warnings stay meaningful. This keeps them from coming back.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ESLint } from "eslint";

const FILES = [
  "src/components/creative-detail/CreativeTagEditor.tsx",
  "src/components/reports/sections/TagBreakdownSection.tsx",
  "src/components/settings/SyncHistorySection.tsx",
  "src/features/ad-library/components/AdCard.tsx",
  "src/hooks/useCachedMedia.ts",
  "src/hooks/useOverviewPageState.ts",
  "src/lib/killScaleLogic.ts",
  "src/pages/AgencyDashboardPage.tsx",
  "src/pages/CreativesPage.tsx",
  "src/pages/LandingPagesPage.tsx",
];

describe("hook dependency lists", () => {
  it("have no react-hooks/exhaustive-deps warnings in the tidied files", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    // lintText rather than lintFiles: the file walker needs Node's AbortSignal, which the jsdom
    // test environment replaces.
    const found: string[] = [];
    for (const file of FILES) {
      const [result] = await eslint.lintText(readFileSync(file, "utf8"), { filePath: file });
      for (const m of result.messages) {
        if (m.ruleId === "react-hooks/exhaustive-deps") found.push(`${file}:${m.line}`);
      }
    }
    expect(found).toEqual([]);
  }, 60_000);
});
