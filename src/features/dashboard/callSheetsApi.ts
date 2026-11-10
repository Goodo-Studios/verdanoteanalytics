// Reads and writes for the Call sheets page (step 5c). Signed-in users hold
// only a read grant on call_sheets, call_sheet_crew and
// call_sheet_talent_entries, and staff rows come through the staff policies.
// The sheet itself is written through create_call_sheet, update_call_sheet and
// revoke_call_sheet (migration 20261101000002); the per-talent lines through
// save_call_sheet_talent_entry and remove_call_sheet_talent_entry (migration
// 20261110220001), which refuse talent not confirmed onto the sheet's shoot.
import { DashboardError, db, unwrap, unwrapOne } from "./api";
import { generateBoardToken } from "./approvalBoardsModel";
import type { CrewOption, SheetArgs, SheetShoot, ShootCasting, TalentArgs } from "./callSheetsModel";

const SHOOT_COLUMNS =
  "id, client_slug, shoot_date, location, location_id, notes, call_sheets(id, shoot_id, token, call_time, wrap_time_estimate, general_notes, revoked, created_at, updated_at, call_sheet_crew(crew_member_id), call_sheet_talent_entries(actor_assignment_id, call_time, wardrobe, talent_notes, rate_note, internal_note, updated_at))";

export interface CallSheetsData {
  shoots: SheetShoot[];
  castings: ShootCasting[];
  crew: CrewOption[];
  locations: Map<string, string>;
}

/** Shoots from `from` onward with their call sheets, the castings confirmed onto them, crew and location names. */
export async function loadCallSheets(from: string): Promise<CallSheetsData> {
  const [shoots, crew, locations] = await Promise.all([
    unwrap(db.from("shoots").select<SheetShoot[]>(SHOOT_COLUMNS).gte("shoot_date", from).order("shoot_date")),
    unwrap(db.from("crew_members").select<CrewOption[]>("id, name, role, active").order("name")),
    unwrap(db.from("locations").select<{ id: string; name: string }[]>("id, name")),
  ]);
  const shootIds = shoots.map((s) => s.id);
  // Castings confirmed onto these shoots, plus any casting a saved talent line
  // still points at (a line goes stale when its talent is removed from the shoot).
  const lineIds = [...new Set(shoots.flatMap((s) => s.call_sheets.flatMap((c) => c.call_sheet_talent_entries.map((e) => e.actor_assignment_id))))];
  const cols = "id, actor_id, shoot_id, stage, actors(name)";
  const [confirmed, linked] = await Promise.all([
    shootIds.length ? unwrap(db.from("actor_assignments").select<ShootCasting[]>(cols).in("shoot_id", shootIds)) : Promise.resolve([] as ShootCasting[]),
    lineIds.length ? unwrap(db.from("actor_assignments").select<ShootCasting[]>(cols).in("id", lineIds)) : Promise.resolve([] as ShootCasting[]),
  ]);
  const castings = new Map<string, ShootCasting>();
  for (const c of [...confirmed, ...linked]) castings.set(c.id, c);
  return { shoots, castings: [...castings.values()], crew, locations: new Map(locations.map((l) => [l.id, l.name])) };
}

export async function createCallSheet(shootId: string, a: SheetArgs): Promise<string> {
  const row = await unwrapOne(db.rpc<{ id: string }>("create_call_sheet", { p_shoot_id: shootId, p_token: generateBoardToken(), ...a }));
  if (!row?.id) throw new DashboardError({ message: "The call sheet was not made." });
  return row.id;
}

/** Replaces the call time, wrap estimate, notes and the crew list. */
export async function updateCallSheet(id: string, a: SheetArgs): Promise<void> {
  await unwrap(db.rpc("update_call_sheet", { p_id: id, ...a }));
}

export async function setCallSheetRevoked(id: string, revoked: boolean): Promise<void> {
  await unwrap(db.rpc("revoke_call_sheet", { p_id: id, p_revoked: revoked }));
}

export async function saveTalentLine(sheetId: string, assignmentId: string, a: TalentArgs): Promise<void> {
  await unwrap(db.rpc("save_call_sheet_talent_entry", { p_call_sheet_id: sheetId, p_actor_assignment_id: assignmentId, ...a }));
}

export async function removeTalentLine(sheetId: string, assignmentId: string): Promise<void> {
  await unwrap(db.rpc("remove_call_sheet_talent_entry", { p_call_sheet_id: sheetId, p_actor_assignment_id: assignmentId }));
}
