// Reads and writes for the approval boards page (step 5b). Boards and votes
// are read and written directly under the staff-only row rules, as the old
// dashboard did. Applying the client's votes goes through the checked
// apply_approval_votes function, which refuses non-staff callers and only
// moves assignments that belong to the brand.
import { DashboardError, db, unwrap, unwrapOne } from "./api";
import { CREATOR_BOARD_TYPE, generateBoardToken, type ApprovalBoard, type ApprovalVote } from "./approvalBoardsModel";

const BOARD_COLUMNS = "id, client_slug, board_type, token, expires_at, revoked, created_at";

export function loadBoards(slug: string): Promise<ApprovalBoard[]> {
  return unwrap(
    db.from("approval_boards").select<ApprovalBoard[]>(BOARD_COLUMNS).eq("client_slug", slug).eq("board_type", CREATOR_BOARD_TYPE).order("created_at", { ascending: false }),
  );
}

export function loadVotes(boardId: string): Promise<ApprovalVote[]> {
  return unwrap(
    db.from("approval_votes")
      .select<ApprovalVote[]>("id, board_id, assignment_id, vote, voted_at, voted_by, creator_assignments(creator_id, stage, dashboard_creators(name))")
      .eq("board_id", boardId)
      .order("voted_at", { ascending: false }),
  );
}

export async function createBoard(slug: string, expiresAt: Date): Promise<ApprovalBoard> {
  const row = await unwrapOne(
    db.from("approval_boards")
      .insert<ApprovalBoard[]>({ client_slug: slug, board_type: CREATOR_BOARD_TYPE, token: generateBoardToken(), expires_at: expiresAt.toISOString() })
      .select(BOARD_COLUMNS)
      .maybeSingle(),
  );
  if (!row) throw new DashboardError({ message: "The link was not created." });
  return row;
}

/** A revoke that matched no row is an error: the link would still be live. */
export async function revokeBoard(id: string): Promise<void> {
  const row = await unwrapOne(db.from("approval_boards").update({ revoked: true }).eq("id", id).select("id").maybeSingle());
  if (!row) throw new DashboardError({ message: "The link was not revoked. It may still be live." });
}

/** Returns how many assignments moved. */
export async function applyVotes(slug: string, votes: { assignment_id: string; vote: "up" | "down" }[]): Promise<number> {
  const n = await unwrapOne(db.rpc<number>("apply_approval_votes", { p_client_slug: slug, p_votes: votes }));
  return n ?? 0;
}
