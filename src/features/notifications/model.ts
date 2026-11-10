// Notifications (phase 4, PR 4): pure helpers for the Admin page that manages Slack destinations,
// the Slack send switch and reminders. Tables: slack_destinations, outbound_switches and reminders
// (migrations 20261109000005 and 20261109000006), plus reminders.for_member_id (20261112000004).
// Nothing here talks to the network, and nothing on the page sends anything: sending is done by
// run-slack-jobs, only from production, only with the send switch on and the Slack key set.

export const DESTINATION_COLUMNS = "id, label, channel_id, purpose, client_slug, owner_confirmed, active";
export const SWITCH_COLUMNS = "name, enabled, note, updated_at";
export const REMINDER_COLUMNS = "id, kind, body, due_at, state, destination_id, client_slug, for_member_id, created_by, created_at";
export const SEND_SWITCH = "slack_sends";

export type Purpose = "internal" | "owner_alerts" | "client_reminders";

export const PURPOSE_OPTIONS: { value: Purpose; label: string }[] = [
  { value: "internal", label: "Internal team reminders" },
  { value: "owner_alerts", label: "Owner alerts" },
  { value: "client_reminders", label: "Client reminders (one client's channel)" },
];

export interface Destination {
  id: string;
  label: string;
  channel_id: string;
  purpose: Purpose;
  client_slug: string | null;
  owner_confirmed: boolean;
  active: boolean;
}

export interface SendSwitch {
  name: string;
  enabled: boolean;
  note: string | null;
  updated_at: string;
}

export type ReminderState = "scheduled" | "queued" | "sent" | "canceled" | "failed";

export interface Reminder {
  id: string;
  kind: string;
  body: string;
  due_at: string;
  state: ReminderState;
  destination_id: string;
  client_slug: string | null;
  for_member_id: string | null;
  created_by: string | null;
  created_at: string;
}

export const REMINDER_STATE_LABEL: Record<ReminderState, string> = {
  scheduled: "Scheduled",
  queued: "Queued to send",
  sent: "Sent",
  canceled: "Canceled",
  failed: "Did not send",
};

const CHANNEL_ID = /^[CGD][A-Z0-9]{2,20}$/;

export const CHANNEL_ID_HELP = "In Slack, open the channel, choose View channel details, and copy the Channel ID at the bottom. It looks like C0123ABCD.";

export interface DestinationForm {
  label: string;
  channelId: string;
  purpose: Purpose;
  clientSlug: string;
}

export const EMPTY_DESTINATION: DestinationForm = { label: "", channelId: "", purpose: "internal", clientSlug: "" };

export function normalizeChannelId(value: string): string {
  return value.trim().toUpperCase();
}

/** The first thing wrong with a new destination, in plain words, or null. */
export function destinationProblem(form: DestinationForm, existing: Destination[]): string | null {
  const label = form.label.trim();
  if (!label) return "Enter the channel name, for example #team-reminders.";
  if (label.length > 120) return "The channel name is longer than 120 characters.";
  const id = normalizeChannelId(form.channelId);
  if (!id) return "Enter the Slack channel id. " + CHANNEL_ID_HELP;
  if (!CHANNEL_ID.test(id)) return "That does not look like a Slack channel id. " + CHANNEL_ID_HELP;
  if (form.purpose === "client_reminders" && !form.clientSlug) return "Choose which client this channel is for.";
  if (existing.some((d) => d.channel_id === id && d.purpose === form.purpose)) return "That channel is already added for this purpose.";
  return null;
}

export interface ReminderForm {
  what: string;
  when: string;
  who: string;
  destinationId: string;
}

export const MAX_WHAT = 2800;

/** The first thing wrong with a new reminder, in plain words, or null. `when` is a datetime-local value. */
export function reminderProblem(form: ReminderForm, now: Date): string | null {
  if (!form.what.trim()) return "Say what the reminder is about.";
  if (form.what.trim().length > MAX_WHAT) return `Keep the reminder under ${MAX_WHAT} characters.`;
  if (!form.when) return "Pick when it should go out.";
  const at = new Date(form.when);
  if (Number.isNaN(at.getTime())) return "Pick when it should go out.";
  if (at.getTime() < now.getTime() - 60_000) return "Pick a time in the future.";
  if (!form.destinationId) return "Choose where it should go.";
  return null;
}

/** The Slack message. Slack cannot @-mention without a Slack id, so the name leads the text. */
export function reminderBody(whoName: string, what: string): string {
  return `Reminder for ${whoName}: ${what.trim()}`;
}

export type SlackKeyState = "connected" | "not_connected" | "needs_attention" | "unknown";

/** Reads the Slack connector out of the integration-health answer. */
export function slackKeyState(overview: unknown): SlackKeyState {
  const connectors = (overview as { connectors?: { key?: string; state?: string }[] } | null)?.connectors;
  const slack = Array.isArray(connectors) ? connectors.find((c) => c.key === "slack") : undefined;
  if (!slack) return "unknown";
  if (slack.state === "not_connected") return "not_connected";
  if (slack.state === "needs_attention") return "needs_attention";
  return "connected";
}

export function slackKeyText(state: SlackKeyState): string {
  switch (state) {
    case "connected":
      return "The Slack key is set.";
    case "needs_attention":
      return "The Slack key is set, but Integration health shows something to fix.";
    case "not_connected":
      return "The Slack key is not set here, so nothing can be posted. Integration health shows the same.";
    default:
      return "The Slack key status could not be read. Check Integration health.";
  }
}

export function sendingText(enabled: boolean): string {
  return enabled
    ? "Slack sending is on. Confirmed channels get reminders and owner alerts, from production only."
    : "Slack sending is off. Reminders wait and nothing is posted to Slack.";
}

export const SENDING_EXPLANATION =
  "Sending needs three things: this switch on, the Slack key set (its status shows below) and a confirmed channel. It posts from production only, never from staging.";

export function destinationState(d: Destination): string {
  if (!d.active) return "Paused";
  if (!d.owner_confirmed) return "Not confirmed yet";
  return "Confirmed";
}

export function purposeLabel(p: string): string {
  return PURPOSE_OPTIONS.find((o) => o.value === p)?.label ?? p;
}

export function errorText(error: { code?: string; message: string } | null | undefined): string {
  if (!error) return "Something went wrong. Try again.";
  if (error.code === "42501") return "Only a builder can change that.";
  if (error.code === "23505") return "That channel is already added for this purpose.";
  if (error.code === "23514" || error.code === "22023") return "That value is not allowed. Check the fields and try again.";
  return "The change could not be saved. Try again, and tell a builder if it keeps happening.";
}
