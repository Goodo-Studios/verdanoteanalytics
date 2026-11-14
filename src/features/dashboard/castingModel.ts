// Casting: staff page model (consolidation step 5c, port of the old
// dashboard's /production/casting and its actor approval panel). This is the
// one talent and casting flow: Goodo OS's talent profiles pointed at these same
// production actors and its talent approvals read these same casting links,
// so the Goodo OS screens are not rebuilt separately.
//
// A casting is one actor on one production client (actor_assignments). A
// casting link is an approval board with board_type 'actors' that the client
// opens without a login (/cast/<token>) to give a thumbs up or down; votes are
// in actor_approval_votes. The public page is served by Verdanote (src/features/public-links).
// Pure helpers only.

import { publicLinkUrl } from "@/features/public-links/publicLinkApi";
import { ACTOR_STAGES } from "./rosterModel";

export const ACTOR_BOARD_TYPE = "actors";
export const ACTIVE_CASTING_STAGES: string[] = ACTOR_STAGES.map((s) => s.value as string).filter((v) => v !== "declined" && v !== "passed");

export interface CastingRow {
  id: string;
  actor_id: string;
  client_slug: string;
  stage: string;
  owner_id: string | null;
  next_follow_up_at: string | null;
  notes: string | null;
  scheduled_shoot_date: string | null;
  shoot_id: string | null;
  actors: { name: string; gender: string | null; age_range: string[]; do_not_use_again: boolean } | null;
}

export interface ActorVote {
  id: string;
  board_id: string;
  assignment_id: string;
  vote: "up" | "down";
  voted_at: string;
  voted_by: string | null;
}

export interface ActorOption {
  id: string;
  name: string;
  do_not_use_again: boolean;
}

/** The public casting link a client opens. It opens on this site. */
export function castingUrl(token: string): string {
  return publicLinkUrl("casting", token);
}

/** Castings in stage order, then by actor name; declined and passed only when asked for. */
export function sortCastings(rows: CastingRow[], showClosed: boolean): CastingRow[] {
  const order = new Map<string, number>(ACTOR_STAGES.map((s, i) => [s.value, i]));
  return rows
    .filter((r) => showClosed || ACTIVE_CASTING_STAGES.includes(r.stage))
    .sort((a, b) => (order.get(a.stage) ?? 99) - (order.get(b.stage) ?? 99) || (a.actors?.name ?? "").localeCompare(b.actors?.name ?? ""));
}

export function stageCounts(rows: CastingRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.stage, (m.get(r.stage) ?? 0) + 1);
  return m;
}

/** Roster actors that can still be added: not on the brand and not marked do not use. */
export function addableActors(all: ActorOption[], rows: CastingRow[]): ActorOption[] {
  const on = new Set(rows.map((r) => r.actor_id));
  return all.filter((a) => !on.has(a.id) && !a.do_not_use_again).sort((a, b) => a.name.localeCompare(b.name));
}

/** Votes on the live link, split, with the actor behind each vote when the casting still exists. */
export function splitActorVotes(votes: ActorVote[], rows: CastingRow[]): { approved: (ActorVote & { row?: CastingRow })[]; passed: (ActorVote & { row?: CastingRow })[] } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sorted = [...votes].sort((a, b) => b.voted_at.localeCompare(a.voted_at)).map((v) => ({ ...v, row: byId.get(v.assignment_id) }));
  return { approved: sorted.filter((v) => v.vote === "up"), passed: sorted.filter((v) => v.vote === "down") };
}
