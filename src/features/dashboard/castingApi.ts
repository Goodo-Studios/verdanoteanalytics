// Reads and writes for the Casting page (step 5c). Castings and casting links
// are read and written directly under the staff-only row rules, as the old
// dashboard did. Applying the client's votes goes through the checked
// apply_actor_approval_votes function, which refuses non-staff callers and only
// moves castings that belong to the brand.
import { DashboardError, db, unwrap, unwrapOne } from "./api";
import { generateBoardToken, type ApprovalBoard } from "./approvalBoardsModel";
import { ACTOR_BOARD_TYPE, type ActorOption, type ActorVote, type CastingRow } from "./castingModel";

const CASTING_COLUMNS = "id, actor_id, client_slug, stage, owner_id, next_follow_up_at, notes, scheduled_shoot_date, shoot_id, actors(name, gender, age_range, do_not_use_again)";
const BOARD_COLUMNS = "id, client_slug, board_type, token, expires_at, revoked, created_at";

export interface CastingData {
  castings: CastingRow[];
  boards: ApprovalBoard[];
  votes: ActorVote[];
}

export async function loadCasting(slug: string): Promise<CastingData> {
  const [castings, boards] = await Promise.all([
    unwrap(db.from("actor_assignments").select<CastingRow[]>(CASTING_COLUMNS).eq("client_slug", slug)),
    unwrap(db.from("approval_boards").select<ApprovalBoard[]>(BOARD_COLUMNS).eq("client_slug", slug).eq("board_type", ACTOR_BOARD_TYPE).order("created_at", { ascending: false })),
  ]);
  const ids = boards.map((b) => b.id);
  const votes = ids.length ? await unwrap(db.from("actor_approval_votes").select<ActorVote[]>("id, board_id, assignment_id, vote, voted_at, voted_by").in("board_id", ids)) : [];
  return { castings, boards, votes };
}

export function loadActorOptions(): Promise<ActorOption[]> {
  return unwrap(db.from("actors").select<ActorOption[]>("id, name, do_not_use_again").order("name"));
}

export interface CastingPatch {
  stage?: string;
  owner_id?: string | null;
  next_follow_up_at?: string | null;
  notes?: string | null;
}

/** Sets updated_at and selects the row back, so a write that matched nothing is an error. */
export async function updateCasting(id: string, patch: CastingPatch): Promise<void> {
  const row = await unwrapOne(db.from("actor_assignments").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("id").maybeSingle());
  if (!row) throw new DashboardError({ message: "That casting no longer exists or cannot be changed." });
}

export async function addActors(slug: string, actorIds: string[]): Promise<void> {
  if (!actorIds.length) return;
  await unwrap(db.from("actor_assignments").insert(actorIds.map((actor_id) => ({ actor_id, client_slug: slug, stage: "sourced" }))).select("id"));
}

export async function removeCasting(id: string): Promise<void> {
  const rows = await unwrap(db.from("actor_assignments").delete<{ id: string }[]>().eq("id", id).select("id"));
  if (!rows.length) throw new DashboardError({ message: "That casting no longer exists or cannot be removed." });
}

export async function createCastingLink(slug: string, expiresAt: Date): Promise<ApprovalBoard> {
  const row = await unwrapOne(
    db.from("approval_boards").insert<ApprovalBoard[]>({ client_slug: slug, board_type: ACTOR_BOARD_TYPE, token: generateBoardToken(), expires_at: expiresAt.toISOString() }).select(BOARD_COLUMNS).maybeSingle(),
  );
  if (!row) throw new DashboardError({ message: "The link was not created." });
  return row;
}

export async function revokeCastingLink(id: string): Promise<void> {
  const row = await unwrapOne(db.from("approval_boards").update({ revoked: true }).eq("id", id).select("id").maybeSingle());
  if (!row) throw new DashboardError({ message: "The link was not revoked. It may still be live." });
}

/** Returns how many castings moved: up to Client Approved, down to Declined, all or nothing. */
export async function applyActorVotes(slug: string, votes: { assignment_id: string; vote: "up" | "down" }[]): Promise<number> {
  const n = await unwrapOne(db.rpc<number>("apply_actor_approval_votes", { p_client_slug: slug, p_votes: votes }));
  return n ?? 0;
}
