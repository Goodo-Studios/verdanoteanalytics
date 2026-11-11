/**
 * Push to ClickUp (replaces the removed Coda buttons).
 *
 * - "Push to ClickUp" in the brief editor and "Create brief in ClickUp" in the
 *   creative detail modal are shown to builders and employees only. A client
 *   never sees them, and neither does a builder previewing the client view.
 * - The dialog loads the client's empty asset tasks for the picker, pushes to a
 *   picked task or to "New asset task", and shows the task link on success.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { isBuilder: false, isEmployee: true, isClient: false, user: { id: "u1" } };
const preview = { isClientPreview: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => preview }));

const invoke = vi.fn();
function chain(): unknown {
  // A query builder stand-in: every method returns another builder, and awaiting
  // it gives an empty result.
  const result: Promise<unknown> = Promise.resolve({ data: null, error: null });
  return new Proxy(result, {
    get(target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        const fn = Reflect.get(target, prop) as (...args: unknown[]) => unknown;
        return fn.bind(target);
      }
      return () => chain();
    },
  });
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: () => chain(),
    rpc: () => chain(),
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));

// Heavy children of the two modals are not under test.
vi.mock("@/hooks/useBriefsApi", () => ({ useUpdateBrief: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock("@/components/briefs/CreativePickerModal", () => ({ CreativePickerModal: () => null }));
vi.mock("@/hooks/useCachedMedia", () => ({ useCachedMedia: () => ({ url: "/x.png", isLoading: false }) }));
vi.mock("@/components/creative-detail/CreativeMetrics", () => ({ CreativeMetrics: () => null }));
vi.mock("@/components/creative-detail/RetentionCurveChart", () => ({ RetentionCurveChart: () => null }));
vi.mock("@/components/creative-detail/CreativeTagEditor", () => ({ CreativeTagEditor: () => null }));
vi.mock("@/components/creative-detail/CreativeFrames", () => ({ CreativeFrames: () => null }));
vi.mock("@/components/creative-detail/CreativeAiTabs", () => ({
  CreativeAiHeader: () => null,
  CreativeScriptTab: () => null,
  CreativeFrameworkTab: () => null,
  CreativeAnalysisTab: () => null,
}));
vi.mock("@/hooks/useCreativeAiDetail", () => ({ useCreativeAiDetail: () => ({ data: null, isLoading: false }) }));
vi.mock("@/lib/vaultSave", () => ({ saveCreativeToVault: vi.fn() }));

import { PushToClickUpDialog } from "@/components/clickup/PushToClickUpDialog";
import { BriefEditorModal } from "@/components/briefs/BriefEditorModal";
import { CreativeDetailModal } from "@/components/CreativeDetailModal";

const wrap = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const LIST = {
  data: {
    client_slug: "smokeshow",
    list: { id: "l1", name: "Smokeshow Project View" },
    tasks: [
      { id: "86bc00t09", name: "November Asset 9", status: "assigned", url: "https://app.clickup.com/t/86bc00t09" },
      { id: "86bc00t10", name: "November Asset 10", status: "brief creation", url: "https://app.clickup.com/t/86bc00t10" },
    ],
  },
  error: null,
};

const brief = {
  id: "b1",
  name: "Sleep hook",
  account_id: "act_smoke",
  share_token: "tok",
  content: { angle_goal: "Win back tired parents", brief: "Hook: 3am again?" },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const creative = {
  ad_id: "1203",
  account_id: "act_smoke",
  ad_name: "Sleep UGC v2",
  thumbnail_url: null,
  full_res_url: null,
  video_url: null,
  ad_post_url: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function setRole(role: "builder" | "employee" | "client") {
  auth.isBuilder = role === "builder";
  auth.isEmployee = role === "employee";
  auth.isClient = role === "client";
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(LIST);
  setRole("employee");
  preview.isClientPreview = false;
});

describe("who sees the ClickUp buttons", () => {
  it("brief editor: employee and builder see Push to ClickUp, a client never does", () => {
    for (const role of ["employee", "builder"] as const) {
      setRole(role);
      const { unmount } = wrap(<BriefEditorModal brief={brief} open onClose={() => {}} onCopyShareLink={() => {}} />);
      expect(screen.getByRole("button", { name: /push to clickup/i })).toBeInTheDocument();
      unmount();
    }
    setRole("client");
    wrap(<BriefEditorModal brief={brief} open onClose={() => {}} onCopyShareLink={() => {}} />);
    expect(screen.queryByRole("button", { name: /push to clickup/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/clickup/i)).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("brief editor: hidden while a builder previews the client view", () => {
    setRole("builder");
    preview.isClientPreview = true;
    wrap(<BriefEditorModal brief={brief} open onClose={() => {}} onCopyShareLink={() => {}} />);
    expect(screen.queryByRole("button", { name: /push to clickup/i })).not.toBeInTheDocument();
  });

  it("creative modal: staff see Create brief in ClickUp, a client never does", () => {
    for (const role of ["employee", "builder"] as const) {
      setRole(role);
      const { unmount } = wrap(<CreativeDetailModal creative={creative} open onClose={() => {}} />);
      expect(screen.getByRole("button", { name: /create brief in clickup/i })).toBeInTheDocument();
      unmount();
    }
    setRole("client");
    wrap(<CreativeDetailModal creative={creative} open onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /create brief in clickup/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/clickup/i)).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("push-brief-to-clickup", expect.anything());
  });

  it("creative modal: hidden while a builder previews the client view", () => {
    setRole("builder");
    preview.isClientPreview = true;
    wrap(<CreativeDetailModal creative={creative} open onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /create brief in clickup/i })).not.toBeInTheDocument();
  });
});

describe("the push dialog", () => {
  it("brief editor opens the dialog with the brief prefilled and loads the picker", async () => {
    wrap(<BriefEditorModal brief={brief} open onClose={() => {}} onCopyShareLink={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /push to clickup/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("push-brief-to-clickup", { body: { action: "list", account_id: "act_smoke" } }),
    );
    const body = screen.getByLabelText("Brief") as HTMLTextAreaElement;
    expect(body.value).toBe("## Angle / Goal\nWin back tired parents\n\n## Brief\nHook: 3am again?");
    expect((screen.getByLabelText("Short title") as HTMLInputElement).value).toBe("Sleep hook");
  });

  it("pushes to a picked empty task and shows the task link", async () => {
    invoke.mockImplementation((_fn: string, { body }: { body: { action: string } }) =>
      Promise.resolve(
        body.action === "list"
          ? LIST
          : { data: { task_id: "86bc00t09", task_name: "November Asset 9", url: "https://app.clickup.com/t/86bc00t09", created: false }, error: null },
      ),
    );
    wrap(
      <PushToClickUpDialog open onOpenChange={() => {}} heading="Create brief in ClickUp" accountId="act_smoke"
        initialTitle="" initialBody="Hook idea" creative={{ ad_id: "1203", ad_name: "Sleep UGC v2" }} />,
    );
    await screen.findByRole("option", { name: "November Asset 9 (assigned)" });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "New asset task",
      "November Asset 9 (assigned)",
      "November Asset 10 (brief creation)",
    ]);
    fireEvent.change(screen.getByLabelText("ClickUp task"), { target: { value: "86bc00t09" } });
    expect(screen.queryByLabelText("Short title")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Push to ClickUp" }));
    const link = await screen.findByRole("link", { name: /November Asset 9/ });
    expect(link).toHaveAttribute("href", "https://app.clickup.com/t/86bc00t09");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(invoke).toHaveBeenLastCalledWith("push-brief-to-clickup", {
      body: {
        action: "push",
        account_id: "act_smoke",
        target: "86bc00t09",
        title: "",
        body: "Hook idea",
        creative: { ad_id: "1203", ad_name: "Sleep UGC v2" },
      },
    });
  });

  it("shows the server's note when a new task was created without the Asset task type", async () => {
    invoke.mockImplementation((_fn: string, { body }: { body: { action: string } }) =>
      Promise.resolve(
        body.action === "list"
          ? LIST
          : { data: { task_id: "n1", task_name: "November Asset 13 - Hook", url: "https://app.clickup.com/t/n1", created: true, task_type: null, note: "Set the type on the task by hand." }, error: null },
      ),
    );
    wrap(<PushToClickUpDialog open onOpenChange={() => {}} heading="Push to ClickUp" accountId="act_smoke" initialTitle="Hook" initialBody="Brief" />);
    await screen.findByRole("option", { name: "November Asset 9 (assigned)" });
    fireEvent.click(screen.getByRole("button", { name: "Push to ClickUp" }));
    expect(await screen.findByTestId("push-note")).toHaveTextContent("Set the type on the task by hand.");
  });

  it("a new asset task needs a title before it can be pushed", async () => {
    wrap(<PushToClickUpDialog open onOpenChange={() => {}} heading="Push to ClickUp" accountId="act_smoke" initialTitle="" initialBody="Brief" />);
    await screen.findByRole("option", { name: "November Asset 9 (assigned)" });
    const push = screen.getByRole("button", { name: "Push to ClickUp" });
    expect(push).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Short title"), { target: { value: "Sleep hook" } });
    expect(push).toBeEnabled();
  });

  it("shows the server's refusal and no link", async () => {
    const refusal = new Response(JSON.stringify({ error: "That task already has a description. Nothing was changed; pick an empty task or a new one." }), { status: 409 });
    invoke.mockImplementation((_fn: string, { body }: { body: { action: string } }) =>
      Promise.resolve(body.action === "list" ? LIST : { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: refusal }) }),
    );
    wrap(<PushToClickUpDialog open onOpenChange={() => {}} heading="Push to ClickUp" accountId="act_smoke" initialTitle="T" initialBody="Brief" />);
    await screen.findByRole("option", { name: "November Asset 9 (assigned)" });
    fireEvent.click(screen.getByRole("button", { name: "Push to ClickUp" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already has a description");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("a client with no ClickUp folder linked gets a plain message with a link to its Setup tab, not a table name", async () => {
    const refusal = new Response(JSON.stringify({
      error: "This client has no ClickUp folder linked yet. A builder can link one on the client's Setup tab.",
      needs_setup: true,
      client_slug: "glow drip",
    }), { status: 404 });
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: refusal }) });
    wrap(<PushToClickUpDialog open onOpenChange={() => {}} heading="Push to ClickUp" accountId="act_smoke" initialTitle="T" initialBody="Brief" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("no ClickUp folder linked yet");
    expect(alert.textContent ?? "").not.toMatch(/source_mappings/);
    expect(screen.getByRole("link", { name: "Open the Setup tab" })).toHaveAttribute("href", "/builder/clients/glow%20drip/setup");
  });

  it("without an ad account it loads nothing and cannot push", () => {
    wrap(<PushToClickUpDialog open onOpenChange={() => {}} heading="Push to ClickUp" accountId={null} initialTitle="T" initialBody="Brief" />);
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Push to ClickUp" })).toBeDisabled();
  });
});
