/**
 * Staff Home blocks. Each block is checked for its data, its empty message, its error state and its
 * loading state, and the three states look different. Role gating: a builder sees Clients needing
 * attention, an employee does not, and a client login (or a builder previewing the client view) sends
 * no query at all and sees none of it. The selects and filters sent are the ones listed for the
 * staging wall check.
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

type Table = { data?: unknown; error?: { message: string } | null; pending?: boolean };
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Table>,
  calls: [] as Array<{ table: string; select: string; filters: Array<[string, string]> }>,
  auth: {} as Record<string, unknown>,
  preview: { isClientPreview: false, isEmployeePreview: false },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (select: string) => {
        const call = { table, select, filters: [] as Array<[string, string]> };
        h.calls.push(call);
        const q = {
          eq: (c: string, v: string) => {
            call.filters.push([c, v]);
            return q;
          },
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            const t = h.tables[table] ?? {};
            const p = t.pending ? new Promise(() => {}) : Promise.resolve({ data: t.data ?? [], error: t.error ?? null });
            return p.then(res, rej);
          },
        };
        return q;
      },
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import { StaffHomeBlocks } from "@/features/home/StaffHomeBlocks";
import { WithClient } from "@/test/clientSelection";
import { addDaysIso, monthStartIso, todayIso } from "@/lib/homeData";
import { HOME_BUDGET_ALERT_COLUMNS, HOME_HANDOFF_COLUMNS, HOME_SUPPORT_COLUMNS, HOME_TASK_COLUMNS } from "@/lib/pageQueries";

const today = todayIso();
const day = (n: number) => addDaysIso(today, n);
const fresh = new Date(Date.now() - 3_600_000).toISOString();
const CLIENTS = [
  { slug: "glow", name: "Glow Drip", active: true },
  { slug: "bloom", name: "Bloom", active: true },
];

let n = 0;
const card = (over: Record<string, unknown> = {}) => ({
  id: `c${++n}`,
  clickup_task_id: `cu${n}`,
  client_slug: "glow",
  task_name: `Card ${n}`,
  stage: "Production",
  due_date: day(2),
  synced_at: fresh,
  ...over,
});

function setRole(role: "builder" | "employee" | "client", opts: { clientPreview?: boolean } = {}) {
  h.auth = {
    user: { id: "u1" },
    role,
    isBuilder: role === "builder",
    isEmployee: role === "employee",
    isClient: role === "client",
  };
  h.preview = { isClientPreview: !!opts.clientPreview, isEmployeePreview: false };
}

function renderBlocks() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WithClient slug="" clients={CLIENTS}>
          <StaffHomeBlocks />
        </WithClient>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const block = (id: string) => screen.findByTestId(`home-block-${id}`);

beforeEach(() => {
  h.tables = {};
  h.calls = [];
  n = 0;
  setRole("builder");
});

describe("Due this week", () => {
  it("lists cards due in the next 7 days across clients, one line each, with the client, stage and date", async () => {
    h.tables.pipeline_tasks = {
      data: [
        card({ task_name: "Hook video", client_slug: "bloom", stage: "Editing", due_date: day(1) }),
        card({ task_name: "Static ads", due_date: day(5) }),
        card({ task_name: "Far away", due_date: day(30) }),
      ],
    };
    renderBlocks();
    const due = await block("due");
    const rows = await within(due).findAllByTestId("home-block-due-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Hook video");
    expect(rows[0].textContent).toContain("Bloom");
    expect(rows[0].textContent).toContain("Editing");
    expect(rows[0].getAttribute("href")).toBe("/builder/clients/bloom/work");
    expect(rows[1].textContent).toContain("Static ads");
    expect(within(due).queryByText("Far away")).toBeNull();
    expect(within(due).getByTestId("home-block-due-see-all").getAttribute("href")).toBe("/builder/work?view=week");
  });

  it("shows at most five rows and still offers See all", async () => {
    h.tables.pipeline_tasks = { data: Array.from({ length: 8 }, (_, i) => card({ task_name: `Card ${i}`, due_date: day(1 + (i % 5)) })) };
    renderBlocks();
    const due = await block("due");
    expect(await within(due).findAllByTestId("home-block-due-row")).toHaveLength(5);
    expect(within(due).getByTestId("home-block-due-see-all")).toBeTruthy();
  });

  it("says something friendly when nothing is due", async () => {
    h.tables.pipeline_tasks = { data: [card({ due_date: day(30) })] };
    renderBlocks();
    expect((await within(await block("due")).findByTestId("home-block-due-empty")).textContent).toBe("Nothing is due in the next 7 days.");
  });

  it("is a different state when the cards could not load, and when they are still loading", async () => {
    h.tables.pipeline_tasks = { error: { message: "boom" } };
    const { unmount } = renderBlocks();
    const due = await block("due");
    expect(await within(due).findByTestId("home-block-due-error")).toBeTruthy();
    expect(within(due).queryByTestId("home-block-due-empty")).toBeNull();
    expect(within(due).queryByTestId("home-block-due-loading")).toBeNull();
    // Waiting on the client reads the same cards and fails the same way.
    expect(within(await block("waiting")).getByTestId("home-block-waiting-error")).toBeTruthy();
    unmount();

    h.tables.pipeline_tasks = { pending: true };
    renderBlocks();
    const loading = await block("due");
    expect(within(loading).getByTestId("home-block-due-loading")).toBeTruthy();
    expect(within(loading).queryByTestId("home-block-due-error")).toBeNull();
    expect(within(loading).queryByTestId("home-block-due-empty")).toBeNull();
  });

  it("draws red only on a late row", async () => {
    h.tables.pipeline_tasks = { data: [card({ task_name: "On time", due_date: day(0) })] };
    renderBlocks();
    const rows = await within(await block("due")).findAllByTestId("home-block-due-row");
    expect(rows.every((r) => r.getAttribute("data-late") === null)).toBe(true);
  });
});

describe("Waiting on the client", () => {
  it("lists the cards in Client Review, soonest first, and links to the Work page for the rest", async () => {
    h.tables.pipeline_tasks = {
      data: [
        card({ task_name: "Second", stage: "Client Review", due_date: day(9) }),
        card({ task_name: "First", stage: "Client Review", due_date: day(3), client_slug: "bloom" }),
        card({ task_name: "Not waiting", stage: "Editing" }),
      ],
    };
    renderBlocks();
    const waiting = await block("waiting");
    const rows = await within(waiting).findAllByTestId("home-block-waiting-row");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("First"), expect.stringContaining("Second")]);
    expect(within(waiting).getByTestId("home-block-waiting-see-all").getAttribute("href")).toBe("/builder/work?view=all&stage=Client+Review");
  });

  it("is friendly when nothing is waiting", async () => {
    h.tables.pipeline_tasks = { data: [card({ stage: "Editing" })] };
    renderBlocks();
    expect((await within(await block("waiting")).findByTestId("home-block-waiting-empty")).textContent).toContain("Nothing is waiting on a client");
  });
});

describe("My handoffs", () => {
  it("lists only the handoffs addressed to the signed-in person, with the role and due date", async () => {
    h.tables.handoff_packets = {
      data: [
        { id: "h1", client_slug: "glow", receiving_role: "editor", receiver_id: "u1", due_date: day(2), status: "ready" },
        { id: "h2", client_slug: "bloom", receiving_role: "strategist", receiver_id: "someone-else", due_date: day(1), status: "ready" },
      ],
    };
    renderBlocks();
    const handoffs = await block("handoffs");
    const rows = await within(handoffs).findAllByTestId("home-block-handoffs-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Handoff for Glow Drip");
    expect(rows[0].textContent).toContain("as editor");
    expect(rows[0].getAttribute("href")).toBe("/builder/clients/glow/scope/handoffs");
  });

  it("marks a handoff past its due date as late", async () => {
    h.tables.handoff_packets = { data: [{ id: "h1", client_slug: "glow", receiving_role: "editor", receiver_id: "u1", due_date: day(-2), status: "ready" }] };
    renderBlocks();
    expect((await within(await block("handoffs")).findByTestId("home-block-handoffs-row")).getAttribute("data-late")).toBe("true");
  });

  it("is friendly when empty, and its own error state when the read fails", async () => {
    h.tables.handoff_packets = { data: [] };
    const { unmount } = renderBlocks();
    expect((await within(await block("handoffs")).findByTestId("home-block-handoffs-empty")).textContent).toBe("Nothing is waiting for you.");
    unmount();
    h.tables.handoff_packets = { error: { message: "denied" } };
    renderBlocks();
    expect(await within(await block("handoffs")).findByTestId("home-block-handoffs-error")).toBeTruthy();
    // The other blocks are not dragged into it.
    expect(within(await block("support")).queryByTestId("home-block-support-error")).toBeNull();
  });

  it("shows a loading state", async () => {
    h.tables.handoff_packets = { pending: true };
    renderBlocks();
    expect(within(await block("handoffs")).getByTestId("home-block-handoffs-loading")).toBeTruthy();
  });
});

describe("My support requests", () => {
  const req = (over: Record<string, unknown>) => ({ id: "r", client_slug: "glow", subject: "Pixel question", status: "open", next_update_target: day(3), accountable_user_id: "u1", backup_user_id: null, ...over });

  it("lists open requests where the person is the owner or the backup, soonest update first, late in red", async () => {
    h.tables.support_requests = {
      data: [
        req({ id: "a", subject: "Mine", next_update_target: day(4) }),
        req({ id: "b", subject: "Backup", accountable_user_id: "x", backup_user_id: "u1", next_update_target: day(-1) }),
        req({ id: "c", subject: "Not mine", accountable_user_id: "x" }),
      ],
    };
    renderBlocks();
    const rows = await within(await block("support")).findAllByTestId("home-block-support-row");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Backup"), expect.stringContaining("Mine")]);
    expect(rows[0].getAttribute("data-late")).toBe("true");
    expect(rows[1].getAttribute("data-late")).toBeNull();
    expect(rows[1].getAttribute("href")).toBe("/builder/admin/support?client=glow");
  });

  it("is friendly when empty, and distinct when loading or failing", async () => {
    h.tables.support_requests = { data: [] };
    const a = renderBlocks();
    expect((await within(await block("support")).findByTestId("home-block-support-empty")).textContent).toBe("You have no open support requests.");
    a.unmount();
    h.tables.support_requests = { error: { message: "x" } };
    const b = renderBlocks();
    expect(await within(await block("support")).findByTestId("home-block-support-error")).toBeTruthy();
    b.unmount();
    h.tables.support_requests = { pending: true };
    renderBlocks();
    expect(within(await block("support")).getByTestId("home-block-support-loading")).toBeTruthy();
  });
});

describe("Clients needing attention (builder)", () => {
  it("combines late work, an overdue support update and a budget alert in one list, late first", async () => {
    h.tables.pipeline_tasks = { data: [card({ client_slug: "glow", stage: "Editing", due_date: day(-3) })] };
    h.tables.support_requests = { data: [{ id: "r", client_slug: "bloom", subject: "s", status: "open", next_update_target: day(-1), accountable_user_id: "x", backup_user_id: null }] };
    h.tables.operating_budget_alerts = { data: [{ id: "a", level: "warning", period_month: monthStartIso() }] };
    renderBlocks();
    const attention = await block("attention");
    const rows = await within(attention).findAllByTestId("home-block-attention-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Bloom"),
      expect.stringContaining("Glow Drip"),
      expect.stringContaining("Operating costs"),
    ]);
    expect(rows[0].getAttribute("href")).toBe("/builder/admin/support?client=bloom");
    expect(rows[1].getAttribute("href")).toBe("/builder/clients/glow/work");
    expect(rows[1].getAttribute("data-late")).toBe("true");
    expect(rows[2].getAttribute("href")).toBe("/builder/admin/operating-costs");
    expect(rows[2].getAttribute("data-late")).toBeNull();
  });

  it("is friendly when every client is fine", async () => {
    renderBlocks();
    expect((await within(await block("attention")).findByTestId("home-block-attention-empty")).textContent).toBe("Every client looks fine right now.");
  });

  it("shows an error, not an empty list, when one of its sources fails", async () => {
    h.tables.operating_budget_alerts = { error: { message: "nope" } };
    renderBlocks();
    const attention = await block("attention");
    expect(await within(attention).findByTestId("home-block-attention-error")).toBeTruthy();
    expect(within(attention).queryByTestId("home-block-attention-empty")).toBeNull();
  });

  it("shows a loading state while its sources load", async () => {
    h.tables.support_requests = { pending: true };
    renderBlocks();
    expect(within(await block("attention")).getByTestId("home-block-attention-loading")).toBeTruthy();
  });
});

describe("role gating", () => {
  it("an employee sees the four blocks but not Clients needing attention, and never reads the builder-only budget table", async () => {
    setRole("employee");
    renderBlocks();
    await block("due");
    expect(screen.queryByTestId("home-block-attention")).toBeNull();
    for (const id of ["due", "waiting", "handoffs", "support"]) expect(screen.getByTestId(`home-block-${id}`)).toBeTruthy();
    expect(h.calls.map((c) => c.table)).not.toContain("operating_budget_alerts");
  });

  it.each([
    ["a client login", "client", {}],
    ["a builder previewing the client view", "builder", { clientPreview: true }],
  ] as const)("%s sends no query from the Home blocks", async (_label, role, opts) => {
    setRole(role, opts);
    renderBlocks();
    // Let any query that was going to start, start.
    await new Promise((r) => setTimeout(r, 20));
    expect(h.calls).toEqual([]);
  });
});

describe("what is sent to the database", () => {
  it("sends exactly the listed selects and filters", async () => {
    renderBlocks();
    await block("attention");
    await within(await block("due")).findByTestId("home-block-due-empty");
    await within(await block("attention")).findByTestId("home-block-attention-empty");
    const sent = (table: string) => h.calls.filter((c) => c.table === table);
    expect(sent("pipeline_tasks").every((c) => c.select === HOME_TASK_COLUMNS && c.filters.length === 0)).toBe(true);
    expect(sent("handoff_packets")[0]).toMatchObject({ select: HOME_HANDOFF_COLUMNS, filters: [["status", "ready"]] });
    expect(sent("support_requests")[0]).toMatchObject({ select: HOME_SUPPORT_COLUMNS, filters: [["status", "open"]] });
    expect(sent("operating_budget_alerts")[0]).toMatchObject({ select: HOME_BUDGET_ALERT_COLUMNS, filters: [["period_month", monthStartIso()]] });
  });
});
