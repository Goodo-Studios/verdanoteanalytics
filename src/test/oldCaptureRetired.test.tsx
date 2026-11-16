/**
 * The old capture paths are retired (audit plan item 4.1, Matthew's decision).
 *
 * The bookmarklet receiver page and the quick-save function (used by public/facebook-saver.js)
 * wrote to ad_library_saved_ads, which was deprecated in 20260527000004, so those saves never
 * reached the Vault. Production has 0 rows in that table, so nothing needs moving. The old route
 * now shows a short "use the Vault" message and saves nothing.
 */
import { render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from, rpc: vi.fn(), functions: { invoke: vi.fn() }, auth: { getSession: vi.fn() } },
}));

import BookmarkletReceiver from "@/pages/BookmarkletReceiver";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("old capture paths", () => {
  it("the bookmarklet page says the tool is retired, points to the Vault and saves nothing", () => {
    render(
      <MemoryRouter initialEntries={["/bookmarklet-receiver?url=https://www.facebook.com/ads/library/?id=1"]}>
        <BookmarkletReceiver />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /this tool has been retired/i })).toBeTruthy();
    expect(screen.getByText(/vault/i)).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
  });

  it("quick-save and the Facebook saver script are gone", () => {
    expect(existsSync(join(root, "supabase/functions/quick-save"))).toBe(false);
    expect(existsSync(join(root, "public/facebook-saver.js"))).toBe(false);
  });

  it("no config, manifest or script still lists quick-save", () => {
    const manifest = JSON.parse(read("supabase/function-access.json")).functions;
    expect(manifest["quick-save"]).toBeUndefined();
    expect(read("supabase/config.toml")).not.toMatch(/\[functions\.quick-save\]/);
    expect(read("scripts/deploy-functions.sh")).not.toMatch(/^\s*quick-save\s*$/m);
    expect(read("scripts/smoke-test.sh")).not.toMatch(/^\s*quick-save\s*$/m);
  });
});
