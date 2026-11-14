// Approval boards, staff side (consolidation step 5b, port of the old
// dashboard's approval panel on its Pipeline page). A board is a secret link a
// client opens without a login to give a thumbs up or down on the creators
// shortlisted for their brand. Rows come from approval_boards and
// approval_votes (migration 20261101000001, staff-only row rules). The public
// board page is served by Verdanote (src/features/public-links). Only creator boards are handled here;
// actor boards are the casting links and move with step 5c. Pure helpers only,
// ported from the old dashboard's src/lib/approvalBoard.ts.

import { publicLinkUrl } from "@/features/public-links/publicLinkApi";

export const CREATOR_BOARD_TYPE = "creators";
export const DEFAULT_BOARD_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ApprovalBoard {
  id: string;
  client_slug: string;
  board_type: string;
  token: string;
  expires_at: string;
  revoked: boolean;
  created_at: string;
}

export interface ApprovalVote {
  id: string;
  board_id: string;
  assignment_id: string;
  vote: "up" | "down";
  voted_at: string;
  /** The first name the reviewer typed on the public page. Not verified; shown, never trusted. */
  voted_by: string | null;
  creator_assignments: { creator_id: string; stage: string; dashboard_creators: { name: string } | null } | null;
}

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export const BOARD_TOKEN_LENGTH = 48;

/** 48 characters from a 64-character alphabet, from the browser's secure random source (288 bits). */
export function generateBoardToken(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(BOARD_TOKEN_LENGTH);
  let token = "";
  for (const b of bytes) token += TOKEN_ALPHABET[b & 63];
  return token;
}

/** The public link a client opens. It opens on this site. */
export function approvalUrl(token: string): string {
  return publicLinkUrl("approval", token);
}

export function isBoardActive(b: Pick<ApprovalBoard, "revoked" | "expires_at">, now: Date): boolean {
  if (b.revoked) return false;
  const t = Date.parse(b.expires_at);
  return !Number.isNaN(t) && now.getTime() <= t;
}

export function boardState(b: Pick<ApprovalBoard, "revoked" | "expires_at">, now: Date): "live" | "revoked" | "expired" {
  if (b.revoked) return "revoked";
  return isBoardActive(b, now) ? "live" : "expired";
}

/** The brand's live board: the newest one not revoked and not expired. */
export function activeBoard(boards: ApprovalBoard[], now: Date): ApprovalBoard | null {
  return [...boards].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((b) => isBoardActive(b, now)) ?? null;
}

export function dateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function defaultExpiry(now: Date): string {
  return dateInputValue(new Date(now.getTime() + DEFAULT_BOARD_DAYS * DAY_MS));
}

/** A typed date means the end of that day in UTC. Null for anything that is not a real future date. */
export function parseExpiry(value: string, now: Date): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}T23:59:59.999Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== value) return null;
  return t > now.getTime() ? new Date(t) : null;
}

export interface Responses {
  approved: ApprovalVote[];
  passed: ApprovalVote[];
}

/** Votes split into thumbs up and down, newest first within each. */
export function splitVotes(votes: ApprovalVote[]): Responses {
  const sorted = [...votes].sort((a, b) => b.voted_at.localeCompare(a.voted_at));
  return { approved: sorted.filter((v) => v.vote === "up"), passed: sorted.filter((v) => v.vote === "down") };
}

/** What Apply sends to apply_approval_votes: up moves to client approved, down to declined. */
export function votesPayload(votes: ApprovalVote[]): { assignment_id: string; vote: "up" | "down" }[] {
  return votes.map((v) => ({ assignment_id: v.assignment_id, vote: v.vote }));
}

export function voteCreatorName(v: ApprovalVote): string {
  return v.creator_assignments?.dashboard_creators?.name ?? "Unknown creator";
}
