/**
 * Client progress feed section on Integration health (P9): builders only; the raw token is shown once
 * after creation with a copy button and is gone once dismissed; revoke asks first; employees see nothing.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { IngestTokensSection } from "@/features/integration-health/IngestTokensSection";

const RAW = "vni_" + "1".repeat(64);
let tokens: unknown[] = [];

beforeEach(() => {
  rpc.mockReset();
  tokens = [{ id: "t1", name: "hq-processes", scope: "client_progress", created_at: "2026-11-09T10:00:00Z", last_used_at: null, revoked_at: null }];
  rpc.mockImplementation((name: string) => {
    if (name === "list_ingest_tokens") return Promise.resolve({ data: tokens, error: null });
    if (name === "list_ingest_audit") return Promise.resolve({ data: [], error: null });
    if (name === "create_ingest_token") return Promise.resolve({ data: { id: "t2", name: "new one", scope: "client_progress", token: RAW }, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

describe("IngestTokensSection", () => {
  it("renders nothing and calls nothing for a non-builder", () => {
    const { container } = render(<IngestTokensSection isBuilder={false} environment="other" />);
    expect(container.textContent).toBe("");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lists tokens and names the staging vault secret", async () => {
    render(<IngestTokensSection isBuilder environment="other" />);
    expect(await screen.findByTestId("ingest-token-hq-processes")).toHaveTextContent("never used");
    expect(screen.getAllByText("STAGING_VERDANOTE_INGEST_TOKEN").length).toBeGreaterThan(0);
  });

  it("shows the raw token once with a copy button and drops it when dismissed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<IngestTokensSection isBuilder environment="production" />);
    await screen.findByTestId("ingest-token-hq-processes");
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "new one" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    const box = (await screen.findByLabelText("New ingest token")) as HTMLInputElement;
    expect(box.value).toBe(RAW);
    expect(rpc).toHaveBeenCalledWith("create_ingest_token", { p_name: "new one", p_scope: "client_progress" });
    fireEvent.click(screen.getByRole("button", { name: "Copy token" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RAW));
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "I have stored it" }));
    expect(screen.queryByLabelText("New ingest token")).toBeNull();
    expect(document.body.textContent).not.toContain(RAW);
  });

  it("asks before revoking and then revokes", async () => {
    render(<IngestTokensSection isBuilder environment="other" />);
    await screen.findByTestId("ingest-token-hq-processes");
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(rpc).not.toHaveBeenCalledWith("revoke_ingest_token", expect.anything());
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("revoke_ingest_token", { p_id: "t1" }));
  });
});
