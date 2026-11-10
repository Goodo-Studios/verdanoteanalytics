/**
 * Staff pages ask "are you sure?" with the kit's confirm dialog (`useConfirm` or
 * `ConfirmTrigger` from "@/components/page-kit"), never the browser's `window.confirm`.
 * This static check fails when a page file under src/features or src/pages calls it.
 *
 * NOT_YET_MIGRATED lists page files still waiting for their migration PR. It only
 * shrinks: each migration PR removes the files it moves, and the last one empties it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const NOT_YET_MIGRATED: string[] = [
  "features/clients/ClientSetupTab.tsx",
  "features/dashboard/ApplicationDetailPage.tsx",
  "features/dashboard/ApplicationsPage.tsx",
  "features/dashboard/ApprovalBoardsPage.tsx",
  "features/dashboard/CallSheetsPage.tsx",
  "features/dashboard/CastingPage.tsx",
  "features/dashboard/CreatorPipelinePage.tsx",
  "features/dashboard/CrewPage.tsx",
  "features/dashboard/LocationsPage.tsx",
  "features/dashboard/ProductionCalendarPage.tsx",
  "features/dashboard/PropsPage.tsx",
  "features/dashboard/ShipmentsPage.tsx",
  "features/notifications/NotificationsPage.tsx",
  "features/team/ClientsSettings.tsx",
  "features/team/InviteSection.tsx",
  "features/team/TeamPage.tsx",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const RAW_CONFIRM = /\b(window|globalThis)\.confirm\s*\(/;

function filesCallingConfirm(): string[] {
  return [...walk(join(ROOT, "features")), ...walk(join(ROOT, "pages"))]
    .map((f) => relative(ROOT, f).split("\\").join("/"))
    .filter((rel) => RAW_CONFIRM.test(readFileSync(join(ROOT, rel), "utf8")))
    .sort();
}

describe("no raw window.confirm in staff pages", () => {
  const calling = filesCallingConfirm();

  it("has no page file that calls window.confirm outside the migration list", () => {
    expect(calling.filter((f) => !NOT_YET_MIGRATED.includes(f))).toEqual([]);
  });

  it("keeps the migration list honest: every listed file still calls it", () => {
    expect(NOT_YET_MIGRATED.filter((f) => !calling.includes(f))).toEqual([]);
  });
});
