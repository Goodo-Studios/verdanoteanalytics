/**
 * Notifications (phase 4 PR 4), the Admin page for Slack destinations, the send switch and reminders.
 *
 * - Slack sending shows off by default in plain words, the Slack key status from Integration health
 *   (set, not set, could not be read), and only a builder gets the switch, after a confirm.
 * - Destinations: empty state, a form that says what is wrong with a channel id, new channels start
 *   unconfirmed, confirm and pause are builder-only and confirm first.
 * - Reminders: what, when, who (me or a teammate), where (confirmed internal channels only); the
 *   saved row names the person; empty, error and no-channel states; cancel after a confirm.
 * The database rules are in supabase/tests/reminder_recipient_test.sql. Nothing is sent: every
 * write here is a mock of a row write, and the page has no call that posts to Slack.
 */
import { acceptConfirm, confirmDialogText, declineConfirm } from "./adminConfirm";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Err = null | { code?: string; message: string };
const h = vi.hoisted(() => ({
  auth: { isBuilder: true, user: { email: "bea@example.test" } as { email: string } | null },
  preview: { isClientPreview: false, isEmployeePreview: false },
  tables: {} as Record<string, { data: unknown; error: Err }>,
  writes: [] as { table: string; op: string; row: Record<string, unknown>; id?: unknown }[],
  writeError: null as Err,
  health: { data: { connectors: [{ key: "slack", state: "connected" }] } as unknown, error: null as unknown },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const q = {
          order: () => q,
          limit: () => q,
          eq: () => q,
          then: (r: (v: unknown) => unknown) => Promise.resolve(h.tables[table] ?? { data: [], error: null }).then(r),
        };
        return q;
      },
      insert: (row: Record<string, unknown>) => {
        h.writes.push({ table, op: "insert", row });
        return Promise.resolve({ data: null, error: h.writeError });
      },
      upsert: (row: Record<string, unknown>) => {
        h.writes.push({ table, op: "upsert", row });
        return Promise.resolve({ data: null, error: h.writeError });
      },
      update: (row: Record<string, unknown>) => ({
        eq: (_c: string, id: unknown) => {
          h.writes.push({ table, op: "update", row, id });
          return Promise.resolve({ data: null, error: h.writeError });
        },
      }),
    }),
    functions: { invoke: () => Promise.resolve(h.health) },
  },
}));

import NotificationsPage from "@/features/notifications/NotificationsPage";
import {
  destinationProblem,
  destinationState,
  errorText,
  reminderBody,
  reminderProblem,
  sendingText,
  slackKeyState,
  slackKeyText,
  type Destination,
} from "@/features/notifications/model";

const dest = (over: Partial<Destination> = {}): Destination => ({
  id: "d1", label: "#team-reminders", channel_id: "C0TEAM001", purpose: "internal", client_slug: null, owner_confirmed: true, active: true, ...over,
});
const team = [
  { id: "m1", name: "Bea Builder", email: "bea@example.test", role: "builder", active: true },
  { id: "m2", name: "Pat Lee", email: "pat@example.test", role: "producer", active: true },
  { id: "m3", name: "Gone Person", email: "gone@example.test", role: "producer", active: false },
];

function load(over: { destinations?: Destination[]; switchOn?: boolean | null; reminders?: unknown[] } = {}) {
  h.tables = {
    slack_destinations: { data: over.destinations ?? [], error: null },
    outbound_switches: { data: over.switchOn == null ? [] : [{ name: "slack_sends", enabled: over.switchOn, note: null, updated_at: "2026-11-01T00:00:00Z" }], error: null },
    reminders: { data: over.reminders ?? [], error: null },
    app_users: { data: team, error: null },
    clients: { data: [{ slug: "glow", name: "Glow Drip", active: true }], error: null },
  };
}
const future = () => {
  const d = new Date(Date.now() + 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`;
};

beforeEach(() => {
  h.auth = { isBuilder: true, user: { email: "bea@example.test" } };
  h.preview = { isClientPreview: false, isEmployeePreview: false };
  h.writes = [];
  h.writeError = null;
  h.health = { data: { connectors: [{ key: "slack", state: "connected" }] }, error: null };
  load();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Slack sending", () => {
  it("shows sending off by default with a plain explanation and the key status", async () => {
    render(<NotificationsPage />);
    expect(await screen.findByTestId("sending-state")).toHaveTextContent("Slack sending is off. Reminders wait and nothing is posted to Slack.");
    expect(screen.getByText(/Sending needs three things/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("slack-key-state")).toHaveTextContent("The Slack key is set."));
  });

  it("says plainly when the Slack key is missing or its status cannot be read", async () => {
    h.health = { data: { connectors: [{ key: "slack", state: "not_connected" }] }, error: null };
    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByTestId("slack-key-state")).toHaveTextContent("The Slack key is not set here, so nothing can be posted. Integration health shows the same."));
    cleanup();
    h.health = { data: null, error: new Error("down") };
    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByTestId("slack-key-state")).toHaveTextContent("The Slack key status could not be read. Check Integration health."));
  });

  it("lets a builder turn it on only after a confirm, and writes the switch row", async () => {
    render(<NotificationsPage />);
    const on = await screen.findByRole("button", { name: "Turn Slack sending on" });
    fireEvent.click(on);
    expect(await confirmDialogText()).toContain("Turn Slack sending on?");
    await declineConfirm();
    expect(h.writes).toHaveLength(0);
    fireEvent.click(on);
    await acceptConfirm();
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]).toMatchObject({ table: "outbound_switches", op: "upsert", row: { name: "slack_sends", enabled: true } });
  });

  it("offers the off button when it is on, and no switch to an employee", async () => {
    load({ switchOn: true });
    render(<NotificationsPage />);
    expect(await screen.findByRole("button", { name: "Turn Slack sending off" })).toBeTruthy();
    cleanup();
    h.auth = { isBuilder: false, user: { email: "pat@example.test" } };
    render(<NotificationsPage />);
    await screen.findByTestId("sending-state");
    expect(screen.queryByRole("button", { name: /Turn Slack sending/ })).toBeNull();
    expect(screen.getByText("Only a builder can turn sending on or off.")).toBeTruthy();
  });

  it("shows a refused switch change in plain words", async () => {
    h.writeError = { code: "42501", message: "denied" };
    render(<NotificationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn Slack sending on" }));
    await acceptConfirm();
    expect((await screen.findByRole("alert")).textContent).toBe("Only a builder can change that.");
  });
});

describe("Slack destinations", () => {
  it("shows the empty state and a form that explains what is wrong", async () => {
    render(<NotificationsPage />);
    expect(await screen.findByTestId("no-destinations")).toHaveTextContent("No Slack channel is added yet.");
    const add = screen.getByRole("button", { name: "Add channel" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "#team-reminders" } });
    fireEvent.change(screen.getByLabelText("Channel id"), { target: { value: "nope" } });
    expect(screen.getByText(/does not look like a Slack channel id/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What it is for"), { target: { value: "client_reminders" } });
    fireEvent.change(screen.getByLabelText("Channel id"), { target: { value: "c0abc123" } });
    expect(screen.getByText("Choose which client this channel is for.")).toBeTruthy();
    expect(add).toBeDisabled();
  });

  it("adds a channel with a tidy id and no client unless it is a client channel", async () => {
    render(<NotificationsPage />);
    await screen.findByTestId("no-destinations");
    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "  #team-reminders " } });
    fireEvent.change(screen.getByLabelText("Channel id"), { target: { value: " c0team001 " } });
    fireEvent.click(screen.getByRole("button", { name: "Add channel" }));
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]).toMatchObject({ table: "slack_destinations", op: "insert", row: { label: "#team-reminders", channel_id: "C0TEAM001", purpose: "internal", client_slug: null } });
  });

  it("starts unconfirmed, and a builder confirms after a confirm; pause and resume work", async () => {
    load({ destinations: [dest({ owner_confirmed: false }), dest({ id: "d2", label: "#alerts", channel_id: "C0ALERT01", purpose: "owner_alerts", active: false })] });
    render(<NotificationsPage />);
    const rows = await screen.findAllByTestId("destination-row");
    expect(within(rows[0]).getByTestId("destination-state")).toHaveTextContent("Not confirmed yet");
    expect(within(rows[1]).getByTestId("destination-state")).toHaveTextContent("Paused");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Confirm channel" }));
    expect(h.writes).toHaveLength(0);
    await acceptConfirm();
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]).toMatchObject({ table: "slack_destinations", op: "update", row: { owner_confirmed: true }, id: "d1" });
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Resume" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(h.writes).toHaveLength(2));
    expect(h.writes[1]).toMatchObject({ row: { active: true }, id: "d2" });
  });

  it("gives an employee a read-only list", async () => {
    load({ destinations: [dest()] });
    h.auth = { isBuilder: false, user: { email: "pat@example.test" } };
    render(<NotificationsPage />);
    await screen.findByTestId("destination-row");
    expect(screen.queryByRole("button", { name: "Add channel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.getByText("Only a builder adds or confirms channels.")).toBeTruthy();
  });

  it("does not let a client preview act as a builder", async () => {
    load({ destinations: [dest()] });
    h.preview = { isClientPreview: true, isEmployeePreview: false };
    render(<NotificationsPage />);
    await screen.findByTestId("destination-row");
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });
});

describe("Reminders", () => {
  it("explains there is nowhere to send when no internal channel is confirmed", async () => {
    load({ destinations: [dest({ owner_confirmed: false }), dest({ id: "d2", purpose: "owner_alerts" })] });
    render(<NotificationsPage />);
    expect(await screen.findByTestId("no-usable-destination")).toHaveTextContent("No confirmed internal Slack channel is available yet");
    expect(screen.queryByRole("button", { name: "Save reminder" })).toBeNull();
    expect(screen.getByTestId("no-reminders")).toHaveTextContent("No reminders yet.");
  });

  it("saves a reminder for a teammate with their name leading the message", async () => {
    load({ destinations: [dest()] });
    render(<NotificationsPage />);
    const save = await screen.findByRole("button", { name: "Save reminder" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("What"), { target: { value: " send the call sheet " } });
    fireEvent.change(screen.getByLabelText("When"), { target: { value: future() } });
    fireEvent.change(screen.getByLabelText("Who"), { target: { value: "m2" } });
    expect(within(screen.getByLabelText("Who")).queryByRole("option", { name: "Gone Person" })).toBeNull();
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]).toMatchObject({
      table: "reminders", op: "insert",
      row: { kind: "custom", destination_id: "d1", body: "Reminder for Pat Lee: send the call sheet", for_member_id: "m2" },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("only if Slack sending is on");
  });

  it("saves a reminder for yourself", async () => {
    load({ destinations: [dest()] });
    render(<NotificationsPage />);
    await screen.findByRole("button", { name: "Save reminder" });
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "check budgets" } });
    fireEvent.change(screen.getByLabelText("When"), { target: { value: future() } });
    fireEvent.click(screen.getByRole("button", { name: "Save reminder" }));
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0].row).toMatchObject({ body: "Reminder for Bea Builder: check budgets", for_member_id: "m1" });
  });

  it("says when a reminder is in the past and shows a save that was refused", async () => {
    load({ destinations: [dest()] });
    h.writeError = { code: "42501", message: "denied" };
    render(<NotificationsPage />);
    await screen.findByRole("button", { name: "Save reminder" });
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "old" } });
    fireEvent.change(screen.getByLabelText("When"), { target: { value: "2020-01-01T09:00" } });
    expect(screen.getByText("Pick a time in the future.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("When"), { target: { value: future() } });
    fireEvent.click(screen.getByRole("button", { name: "Save reminder" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Only a builder can change that.");
  });

  it("lists reminders with who they are for and cancels a scheduled one after a confirm", async () => {
    load({
      destinations: [dest()],
      reminders: [
        { id: "r1", kind: "custom", body: "Reminder for Pat Lee: send the call sheet", due_at: "2030-01-05T15:00:00Z", state: "scheduled", destination_id: "d1", client_slug: null, for_member_id: "m2", created_by: "u1", created_at: "2026-11-01T00:00:00Z" },
        { id: "r2", kind: "custom", body: "Reminder for Bea Builder: old", due_at: "2026-01-05T15:00:00Z", state: "failed", destination_id: "d1", client_slug: null, for_member_id: null, created_by: "u1", created_at: "2026-01-01T00:00:00Z" },
      ],
    });
    render(<NotificationsPage />);
    const rows = await screen.findAllByTestId("reminder-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("For Pat Lee")).toBeTruthy();
    expect(within(rows[0]).getByTestId("reminder-state")).toHaveTextContent("Scheduled");
    expect(within(rows[1]).getByTestId("reminder-state")).toHaveTextContent("Did not send");
    expect(within(rows[1]).queryByRole("button", { name: /Cancel/ })).toBeNull();
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Cancel the reminder due/ }));
    expect(await confirmDialogText()).toContain("It will not be sent.");
    await declineConfirm();
    expect(h.writes).toHaveLength(0);
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Cancel the reminder due/ }));
    await acceptConfirm();
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]).toMatchObject({ table: "reminders", op: "update", row: { state: "canceled" }, id: "r1" });
  });
});

describe("loading and errors", () => {
  it("says it could not load, rather than showing an empty page, and can retry", async () => {
    h.tables.slack_destinations = { data: null, error: { message: "boom" } };
    render(<NotificationsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Notifications could not load");
    load();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("no-destinations")).toBeTruthy();
  });
});

describe("model", () => {
  it("checks a destination", () => {
    expect(destinationProblem({ label: "", channelId: "C0ABC", purpose: "internal", clientSlug: "" }, [])).toMatch(/channel name/);
    expect(destinationProblem({ label: "#a", channelId: "", purpose: "internal", clientSlug: "" }, [])).toMatch(/channel id/);
    expect(destinationProblem({ label: "#a", channelId: "C0TEAM001", purpose: "internal", clientSlug: "" }, [dest()])).toBe("That channel is already added for this purpose.");
    expect(destinationProblem({ label: "#a", channelId: "C0TEAM001", purpose: "owner_alerts", clientSlug: "" }, [dest()])).toBeNull();
    expect(destinationProblem({ label: "x".repeat(121), channelId: "C0TEAM001", purpose: "internal", clientSlug: "" }, [])).toMatch(/120/);
  });

  it("checks a reminder", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const ok = { what: "x", when: "2026-11-11T09:00", who: "self", destinationId: "d1" };
    expect(reminderProblem(ok, now)).toBeNull();
    expect(reminderProblem({ ...ok, what: "  " }, now)).toBe("Say what the reminder is about.");
    expect(reminderProblem({ ...ok, what: "x".repeat(2801) }, now)).toMatch(/2800/);
    expect(reminderProblem({ ...ok, when: "" }, now)).toBe("Pick when it should go out.");
    expect(reminderProblem({ ...ok, when: "nonsense" }, now)).toBe("Pick when it should go out.");
    expect(reminderProblem({ ...ok, destinationId: "" }, now)).toBe("Choose where it should go.");
    expect(reminderBody("Pat", " hi ")).toBe("Reminder for Pat: hi");
  });

  it("words the states and errors plainly, with no dashes", () => {
    expect(destinationState(dest())).toBe("Confirmed");
    expect(slackKeyState(null)).toBe("unknown");
    expect(slackKeyState({ connectors: [{ key: "slack", state: "needs_attention" }] })).toBe("needs_attention");
    expect(slackKeyState({ connectors: [{ key: "clickup", state: "connected" }] })).toBe("unknown");
    expect(errorText({ code: "23505", message: "dup" })).toMatch(/already added/);
    expect(errorText({ code: "23514", message: "check" })).toMatch(/not allowed/);
    expect(errorText(null)).toMatch(/Something went wrong/);
    const all = [sendingText(true), sendingText(false), slackKeyText("connected"), slackKeyText("needs_attention"), slackKeyText("not_connected"), slackKeyText("unknown")];
    for (const t of all) expect(t).not.toMatch(new RegExp(String.fromCharCode(91, 8211, 8212, 93)));
  });
});
