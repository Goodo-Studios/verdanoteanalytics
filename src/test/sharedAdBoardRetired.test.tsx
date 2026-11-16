/**
 * The shared ad board page is retired (audit plan item 3.3, Matthew's decision).
 *
 * The page read the deprecated ad_library_* tables with no login, showed anonymous viewers Delete,
 * Edit Tags and an "Add Note" that saved nothing, and lost the board order. Old links now open a
 * short "no longer available" page that reads nothing from the database.
 */
import { render, screen } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

import SharedAdBoardPage from "@/pages/SharedAdBoardPage";

describe("retired shared ad board", () => {
  it("an old link shows that the board is no longer available and reads nothing", () => {
    render(
      <MemoryRouter initialEntries={["/shared/ad-board/old-token-123"]}>
        <Routes>
          <Route path="/shared/ad-board/:shareToken" element={<SharedAdBoardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /no longer available/i })).toBeTruthy();
    expect(screen.queryByText(/delete/i)).toBeNull();
    expect(screen.queryByText(/add note/i)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("the old board view is gone", () => {
    expect(existsSync(join(process.cwd(), "src/features/ad-library/components/SharedBoardView.tsx"))).toBe(false);
  });
});
