// Call sheets: staff page model (consolidation step 5c). One call sheet,
// merged from two: the old dashboard's per-shoot call sheet (call time, wrap
// estimate, general notes, crew, a secret link for crew and the client) and
// Goodo OS's per-talent lines (call time, wardrobe, notes for the talent, and
// staff-only rate and internal notes). The per-talent lines live in
// call_sheet_talent_entries (migration 20261110220001), one line per talent
// confirmed onto the sheet's shoot. Pure helpers only.
import { OLD_DASHBOARD_URL } from "./applicationsModel";

export interface TalentEntry {
  actor_assignment_id: string;
  call_time: string | null;
  wardrobe: string | null;
  talent_notes: string | null;
  rate_note: string | null;
  internal_note: string | null;
  updated_at: string;
}

export interface CallSheet {
  id: string;
  shoot_id: string;
  token: string;
  call_time: string | null;
  wrap_time_estimate: string | null;
  general_notes: string | null;
  revoked: boolean;
  created_at: string;
  updated_at: string;
  call_sheet_crew: { crew_member_id: string }[];
  call_sheet_talent_entries: TalentEntry[];
}

export interface SheetShoot {
  id: string;
  client_slug: string;
  shoot_date: string;
  location: string | null;
  location_id: string | null;
  notes: string | null;
  call_sheets: CallSheet[];
}

export interface ShootCasting {
  id: string;
  actor_id: string;
  shoot_id: string | null;
  stage: string;
  actors: { name: string } | null;
}

export interface CrewOption {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

/** The public call sheet page. It stays on the old dashboard until the release. */
export function callSheetUrl(token: string): string {
  return `${OLD_DASHBOARD_URL}/call-sheet/${token}`;
}

/** The sheet shown for a shoot: the live one, else the newest revoked one. */
export function currentSheet(s: SheetShoot): CallSheet | null {
  const sorted = [...s.call_sheets].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sorted.find((c) => !c.revoked) ?? sorted[0] ?? null;
}

/** Shoots on or after today ascending, and earlier shoots newest first. */
export function splitShoots(shoots: SheetShoot[], today: string): { upcoming: SheetShoot[]; past: SheetShoot[] } {
  const asc = [...shoots].sort((a, b) => a.shoot_date.localeCompare(b.shoot_date) || a.client_slug.localeCompare(b.client_slug));
  return { upcoming: asc.filter((s) => s.shoot_date >= today), past: asc.filter((s) => s.shoot_date < today).reverse() };
}

export interface TalentLine {
  assignmentId: string;
  name: string;
  entry: TalentEntry | null;
  /** The line's talent is no longer confirmed onto this shoot. */
  stale: boolean;
}

/**
 * One line per talent confirmed onto the shoot (with its saved entry, if any),
 * then any saved entry whose talent was since removed from the shoot, flagged
 * stale so staff can remove it.
 */
export function talentLines(sheet: CallSheet | null, shootId: string, castings: ShootCasting[]): TalentLine[] {
  const entries = new Map((sheet?.call_sheet_talent_entries ?? []).map((e) => [e.actor_assignment_id, e]));
  const confirmed = castings.filter((c) => c.shoot_id === shootId);
  const names = new Map(castings.map((c) => [c.id, c.actors?.name ?? "Unnamed actor"]));
  const lines: TalentLine[] = confirmed
    .map((c) => ({ assignmentId: c.id, name: names.get(c.id) ?? "Unnamed actor", entry: entries.get(c.id) ?? null, stale: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const confirmedIds = new Set(confirmed.map((c) => c.id));
  for (const e of entries.values()) {
    if (!confirmedIds.has(e.actor_assignment_id)) {
      lines.push({ assignmentId: e.actor_assignment_id, name: names.get(e.actor_assignment_id) ?? "Talent no longer on this shoot", entry: e, stale: true });
    }
  }
  return lines;
}

export interface SheetForm {
  call_time: string;
  wrap_time_estimate: string;
  general_notes: string;
  crew: string[];
}

export const EMPTY_SHEET_FORM: SheetForm = { call_time: "", wrap_time_estimate: "", general_notes: "", crew: [] };

export function sheetToForm(c: CallSheet): SheetForm {
  return {
    call_time: c.call_time ? c.call_time.slice(0, 5) : "",
    wrap_time_estimate: c.wrap_time_estimate ?? "",
    general_notes: c.general_notes ?? "",
    crew: c.call_sheet_crew.map((x) => x.crew_member_id),
  };
}

export interface SheetArgs {
  p_call_time: string | null;
  p_wrap_time_estimate: string | null;
  p_general_notes: string | null;
  p_crew_member_ids: string[];
}

export function formToSheetArgs(f: SheetForm): SheetArgs {
  if (f.call_time && !/^\d{2}:\d{2}$/.test(f.call_time)) throw new Error("Enter the call time as hours and minutes.");
  const wrap = f.wrap_time_estimate.trim();
  const notes = f.general_notes.trim();
  return { p_call_time: f.call_time || null, p_wrap_time_estimate: wrap || null, p_general_notes: notes || null, p_crew_member_ids: [...new Set(f.crew)] };
}

export interface TalentForm {
  call_time: string;
  wardrobe: string;
  talent_notes: string;
  rate_note: string;
  internal_note: string;
}

export const EMPTY_TALENT_FORM: TalentForm = { call_time: "", wardrobe: "", talent_notes: "", rate_note: "", internal_note: "" };

export function entryToForm(e: TalentEntry | null): TalentForm {
  if (!e) return EMPTY_TALENT_FORM;
  return {
    call_time: e.call_time ? e.call_time.slice(0, 5) : "",
    wardrobe: e.wardrobe ?? "",
    talent_notes: e.talent_notes ?? "",
    rate_note: e.rate_note ?? "",
    internal_note: e.internal_note ?? "",
  };
}

export interface TalentArgs {
  p_call_time: string | null;
  p_wardrobe: string | null;
  p_talent_notes: string | null;
  p_rate_note: string | null;
  p_internal_note: string | null;
}

/** Checks a talent line the way save_call_sheet_talent_entry will. */
export function formToTalentArgs(f: TalentForm): TalentArgs {
  if (f.call_time && !/^\d{2}:\d{2}$/.test(f.call_time)) throw new Error("Enter the talent call time as hours and minutes.");
  const wardrobe = f.wardrobe.trim();
  const talentNotes = f.talent_notes.trim();
  const rate = f.rate_note.trim();
  const internal = f.internal_note.trim();
  if (wardrobe.length > 500 || rate.length > 500) throw new Error("Wardrobe and rate note must be 500 characters or fewer.");
  if (talentNotes.length > 1000 || internal.length > 1000) throw new Error("Notes must be 1000 characters or fewer.");
  return { p_call_time: f.call_time || null, p_wardrobe: wardrobe || null, p_talent_notes: talentNotes || null, p_rate_note: rate || null, p_internal_note: internal || null };
}
