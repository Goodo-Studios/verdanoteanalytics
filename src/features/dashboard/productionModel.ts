// Production calendar: staff page model (consolidation step 5c, port of the
// old dashboard's /production/calendar and its shoot and schedule block
// dialogs). A shoot is one client's day of filming (shoots), split into
// schedule blocks with the talent and crew called for each. Talent is the
// client's castings (actor_assignments) confirmed onto the shoot. Rows come
// from the tables of migration 20261101000001 (staff-only row rules) and are
// written through the checked shoot, block and confirm functions.
// Pure helpers only.

export interface ShootBlock {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  location: string | null;
  notes: string | null;
  shoot_schedule_block_talent: { actor_assignment_id: string }[];
  shoot_schedule_block_crew: { crew_member_id: string }[];
}

export interface Shoot {
  id: string;
  client_slug: string;
  shoot_date: string;
  location: string | null;
  location_id: string | null;
  notes: string | null;
  shoot_schedule_blocks: ShootBlock[];
  call_sheets: { id: string; revoked: boolean }[];
}

export interface Casting {
  id: string;
  actor_id: string;
  client_slug: string;
  stage: string;
  shoot_id: string | null;
  actors: { name: string } | null;
}

export interface Option {
  id: string;
  name: string;
  role?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM" of a date, in UTC. */
export function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function parseMonth(value: string | null, now: Date): string {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : monthOf(now);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthOf(new Date(Date.UTC(y, m - 1 + by, 1)));
}

/** First and last day of a month, as YYYY-MM-DD. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Shoots grouped by date, dates ascending. */
export function groupByDate(shoots: Shoot[]): [string, Shoot[]][] {
  const m = new Map<string, Shoot[]>();
  for (const s of [...shoots].sort((a, b) => a.shoot_date.localeCompare(b.shoot_date) || a.client_slug.localeCompare(b.client_slug))) {
    m.set(s.shoot_date, [...(m.get(s.shoot_date) ?? []), s]);
  }
  return [...m.entries()];
}

/** "09:00:00" -> "9:00 AM". */
export function formatTime(t: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

export function sortBlocks(blocks: ShootBlock[]): ShootBlock[] {
  return [...blocks].sort((a, b) => a.start_time.localeCompare(b.start_time) || a.label.localeCompare(b.label));
}

export function callSheetState(s: Shoot): "none" | "live" | "revoked" {
  if (!s.call_sheets.length) return "none";
  return s.call_sheets.some((c) => !c.revoked) ? "live" : "revoked";
}

export interface ShootForm {
  client_slug: string;
  shoot_date: string;
  location_id: string;
  location: string;
  notes: string;
}

export const EMPTY_SHOOT_FORM: ShootForm = { client_slug: "", shoot_date: "", location_id: "", location: "", notes: "" };

export function shootToForm(s: Shoot): ShootForm {
  return { client_slug: s.client_slug, shoot_date: s.shoot_date, location_id: s.location_id ?? "", location: s.location_id ? "" : s.location ?? "", notes: s.notes ?? "" };
}

export interface ShootArgs {
  p_client_slug: string;
  p_shoot_date: string;
  p_location: string | null;
  p_notes: string | null;
  p_location_id: string | null;
}

/** A linked location wins over typed text (the database applies the same rule). */
export function formToShootArgs(f: ShootForm): ShootArgs {
  if (!f.client_slug) throw new Error("Pick the client the shoot is for.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.shoot_date)) throw new Error("Pick the shoot date.");
  return {
    p_client_slug: f.client_slug, p_shoot_date: f.shoot_date, p_location_id: f.location_id || null,
    p_location: f.location_id ? null : f.location.trim() || null, p_notes: f.notes.trim() || null,
  };
}

export interface BlockForm {
  label: string;
  start_time: string;
  end_time: string;
  location: string;
  notes: string;
  talent: string[];
  crew: string[];
}

export const EMPTY_BLOCK_FORM: BlockForm = { label: "", start_time: "", end_time: "", location: "", notes: "", talent: [], crew: [] };

export function blockToForm(b: ShootBlock): BlockForm {
  return {
    label: b.label, start_time: b.start_time.slice(0, 5), end_time: b.end_time.slice(0, 5), location: b.location ?? "", notes: b.notes ?? "",
    talent: b.shoot_schedule_block_talent.map((t) => t.actor_assignment_id), crew: b.shoot_schedule_block_crew.map((c) => c.crew_member_id),
  };
}

export interface BlockArgs {
  p_label: string;
  p_start_time: string;
  p_end_time: string;
  p_location: string | null;
  p_notes: string | null;
  p_actor_assignment_ids: string[];
  p_crew_member_ids: string[];
}

/** Checks a block the way the database will: a label, both times, and an end after the start. */
export function formToBlockArgs(f: BlockForm): BlockArgs {
  const label = f.label.trim();
  if (!label) throw new Error("A block label is required.");
  if (label.length > 120) throw new Error("A block label must be 120 characters or fewer.");
  if (!/^\d{2}:\d{2}$/.test(f.start_time) || !/^\d{2}:\d{2}$/.test(f.end_time)) throw new Error("A block needs both a start time and an end time.");
  if (f.end_time <= f.start_time) throw new Error("A block must end after it starts. A block that runs past midnight is entered as two blocks.");
  return { p_label: label, p_start_time: f.start_time, p_end_time: f.end_time, p_location: f.location.trim() || null, p_notes: f.notes.trim() || null, p_actor_assignment_ids: f.talent, p_crew_member_ids: f.crew };
}
