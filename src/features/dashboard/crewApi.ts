// Reads and writes for the Crew page (step 5c). Every write goes through a
// checked function from migration 20261101000002, which refuses anyone who is
// not builder or employee; signed-in users hold only a read grant on
// crew_members. The call sheet count reads call_sheet_crew (staff only).
import { DashboardError, db, unwrap, unwrapOne } from "./api";
import type { CrewArgs, CrewMember } from "./crewModel";

const CREW_COLUMNS = "id, name, role, rate_notes, phone, email, notes, active, updated_at";

export interface CrewData {
  crew: CrewMember[];
  /** crew member id -> number of call sheets they are on. */
  sheets: Map<string, number>;
}

export async function loadCrew(): Promise<CrewData> {
  const [crew, links] = await Promise.all([
    unwrap(db.from("crew_members").select<CrewMember[]>(CREW_COLUMNS).order("name")),
    unwrap(db.from("call_sheet_crew").select<{ crew_member_id: string }[]>("crew_member_id")),
  ]);
  const sheets = new Map<string, number>();
  for (const l of links) sheets.set(l.crew_member_id, (sheets.get(l.crew_member_id) ?? 0) + 1);
  return { crew, sheets };
}

export async function createCrewMember(a: CrewArgs): Promise<string> {
  const row = await unwrapOne(db.rpc<{ id: string }>("create_crew_member", { ...a }));
  if (!row?.id) throw new DashboardError({ message: "The crew member was not added." });
  return row.id;
}

export async function updateCrewMember(id: string, a: CrewArgs): Promise<void> {
  await unwrap(db.rpc("update_crew_member", { p_id: id, ...a }));
}

/** Archived crew stay on past call sheets but are not offered for new ones. */
export async function setCrewActive(id: string, active: boolean): Promise<void> {
  await unwrap(db.rpc("archive_crew_member", { p_id: id, p_active: active }));
}
