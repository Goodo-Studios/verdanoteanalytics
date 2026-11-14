// Reads and writes for the Production calendar (step 5c). Every write goes
// through a checked function from migration 20261101000002; signed-in users
// hold only a read grant on shoots and schedule blocks. Confirming talent sets
// the casting's shoot (and its date and location) through
// confirm_actor_for_shoot, which refuses a casting of another client.
import { DashboardError, db, unwrap, unwrapOne } from "./api";
import type { BlockArgs, Casting, Option, Shoot, ShootArgs } from "./productionModel";

const SHOOT_COLUMNS =
  "id, client_slug, shoot_date, location, location_id, notes, shoot_schedule_blocks(id, label, start_time, end_time, location, notes, shoot_schedule_block_talent(actor_assignment_id), shoot_schedule_block_crew(crew_member_id)), call_sheets(id, revoked)";

export interface CalendarData {
  shoots: Shoot[];
  /** Every casting of the clients shooting this month, confirmed or not. */
  castings: Casting[];
  locations: Option[];
  crew: Option[];
}

export async function loadCalendar(from: string, to: string): Promise<CalendarData> {
  const [shoots, locations, crew] = await Promise.all([
    unwrap(db.from("shoots").select<Shoot[]>(SHOOT_COLUMNS).gte("shoot_date", from).lte("shoot_date", to).order("shoot_date")),
    unwrap(db.from("locations").select<Option[]>("id, name").order("name")),
    unwrap(db.from("crew_members").select<Option[]>("id, name, role").eq("active", true).order("name")),
  ]);
  const clients = [...new Set(shoots.map((s) => s.client_slug))];
  const castings = clients.length
    ? await unwrap(db.from("actor_assignments").select<Casting[]>("id, actor_id, client_slug, stage, shoot_id, actors(name)").in("client_slug", clients))
    : [];
  return { shoots, castings, locations, crew };
}

export async function createShoot(a: ShootArgs): Promise<string> {
  const row = await unwrapOne(db.rpc<{ id: string }>("create_shoot", { ...a }));
  if (!row?.id) throw new DashboardError({ message: "The shoot was not added." });
  return row.id;
}

/** update_shoot cannot move a shoot to another client. */
export async function updateShoot(id: string, a: ShootArgs): Promise<void> {
  await unwrap(db.rpc("update_shoot", { p_id: id, p_shoot_date: a.p_shoot_date, p_location: a.p_location, p_notes: a.p_notes, p_location_id: a.p_location_id }));
}

export async function deleteShoot(id: string): Promise<void> {
  await unwrap(db.rpc("delete_shoot", { p_id: id }));
}

export async function confirmTalent(assignmentId: string, shootId: string): Promise<void> {
  await unwrap(db.rpc("confirm_actor_for_shoot", { p_assignment_id: assignmentId, p_shoot_id: shootId }));
}

export async function unconfirmTalent(assignmentId: string): Promise<void> {
  await unwrap(db.rpc("unconfirm_actor_from_shoot", { p_assignment_id: assignmentId }));
}

export async function createBlock(shootId: string, a: BlockArgs): Promise<void> {
  await unwrap(db.rpc("create_shoot_schedule_block", { p_shoot_id: shootId, ...a }));
}

export async function updateBlock(id: string, a: BlockArgs): Promise<void> {
  await unwrap(db.rpc("update_shoot_schedule_block", { p_id: id, ...a }));
}

export async function deleteBlock(id: string): Promise<void> {
  await unwrap(db.rpc("delete_shoot_schedule_block", { p_id: id }));
}
