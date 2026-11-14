/**
 * Briefs page: deleting a brief asks first, and a new brief opens straight in
 * the editor with its name ready to type over.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deleteMutate: vi.fn(),
  createMutate: vi.fn(),
  briefs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({ selectedAccountId: "act_1" }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useAccountsApi", () => ({ useAccounts: () => ({ data: [{ id: "act_1", name: "Glow" }] }) }));
vi.mock("@/hooks/useBriefsApi", () => ({
  useBriefs: () => ({ data: h.briefs, isLoading: false }),
  useBriefTemplates: () => ({ data: [] }),
  useCreateBrief: () => ({ mutate: h.createMutate, isPending: false }),
  useDeleteBrief: () => ({ mutate: h.deleteMutate }),
}));
vi.mock("@/components/briefs/BriefEditorModal", () => ({
  BriefEditorModal: ({ brief, open, isNew }: { brief: { name: string } | null; open: boolean; isNew?: boolean }) =>
    open && brief ? <div data-testid="brief-editor" data-new={String(!!isNew)}>{brief.name}</div> : null,
}));

import BriefsPage from "@/pages/BriefsPage";

beforeEach(() => {
  h.deleteMutate.mockReset();
  h.createMutate.mockReset();
  h.briefs = [{ id: "b1", name: "Spring hook brief", account_id: "act_1", share_token: "tok" }];
});

describe("BriefsPage", () => {
  it("asks before deleting a brief; Cancel keeps it", async () => {
    render(<BriefsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Spring hook brief" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete this brief?");
    expect(dialog).toHaveTextContent("Spring hook brief");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(h.deleteMutate).not.toHaveBeenCalled();
  });

  it("deletes only after the confirm button", async () => {
    render(<BriefsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Spring hook brief" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete brief" }));
    expect(h.deleteMutate).toHaveBeenCalledWith("b1");
  });

  it("opens a new brief straight in the editor as a new brief", async () => {
    h.createMutate.mockImplementation((_brief: unknown, opts: { onSuccess: (b: unknown) => void }) =>
      opts.onSuccess({ id: "b2", name: "New Brief", account_id: "act_1", share_token: "t2" }),
    );
    render(<BriefsPage />);
    fireEvent.click(screen.getByRole("button", { name: /New Brief/ }));
    const editor = await screen.findByTestId("brief-editor");
    expect(editor).toHaveTextContent("New Brief");
    expect(editor).toHaveAttribute("data-new", "true");
  });

  it("opens an existing brief in the editor as not new", async () => {
    render(<BriefsPage />);
    fireEvent.click(screen.getByText("Spring hook brief"));
    expect(await screen.findByTestId("brief-editor")).toHaveAttribute("data-new", "false");
  });
});
