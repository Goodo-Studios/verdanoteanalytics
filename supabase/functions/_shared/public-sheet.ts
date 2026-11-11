// Public location boards and call sheets, behind the `public-link` function. Both are read only
// (the old dashboard pages had no pick, confirm or acknowledge action). The database functions
// scope to the token; this file shapes each answer from an explicit key list, signs location
// photos with the service role, and never lets a storage path out.
import { jsonResponse, statusResponse } from "./public-link.ts";
import { signMany } from "./public-board.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

export async function getLocationBoard(db: Db, tokenHash: string, countOpen: boolean): Promise<Response> {
  const { data, error } = await db.rpc("public_location_board_get", { p_token_hash: tokenHash, p_count_open: countOpen });
  if (error || !data || typeof data !== "object") return jsonResponse({ error: "server_error" }, 500);
  if (data.status !== "ok") return statusResponse(String(data.status));
  const locations = arr(data.locations);
  const paths = locations.flatMap((l) => arr(l.photos).map((p) => str(p.path) ?? ""));
  const urls = await signMany(db, "location-photos", paths);
  return jsonResponse({
    label: str(data.label),
    client_name: str(data.client_name) ?? "",
    locations: locations.map((l) => ({
      location_id: str(l.location_id),
      name: str(l.name),
      neighborhood: str(l.neighborhood),
      rental_type: str(l.rental_type),
      rooms: strs(l.rooms),
      attributes: strs(l.attributes),
      photos: arr(l.photos).map((p) => ({ id: str(p.id), caption: str(p.caption), url: urls.get(str(p.path) ?? "") ?? null })),
    })),
  });
}

export async function getCallSheet(db: Db, tokenHash: string, countOpen: boolean): Promise<Response> {
  const { data, error } = await db.rpc("public_call_sheet_get", { p_token_hash: tokenHash, p_count_open: countOpen });
  if (error || !data || typeof data !== "object") return jsonResponse({ error: "server_error" }, 500);
  if (data.status !== "ok") return statusResponse(String(data.status));
  const loc = data.location && typeof data.location === "object" ? (data.location as Record<string, unknown>) : null;
  return jsonResponse({
    call_time: str(data.call_time),
    wrap_time_estimate: str(data.wrap_time_estimate),
    general_notes: str(data.general_notes),
    shoot_date: str(data.shoot_date),
    shoot_location: str(data.shoot_location),
    client_name: str(data.client_name) ?? "",
    talent: arr(data.talent).map((t) => ({ name: str(t.name), phone: str(t.phone), email: str(t.email) })),
    location: loc
      ? {
          name: str(loc.name),
          neighborhood: str(loc.neighborhood),
          parking_instructions: str(loc.parking_instructions),
          wifi_name: str(loc.wifi_name),
          wifi_password: str(loc.wifi_password),
          entry_instructions: str(loc.entry_instructions),
          contact_name: str(loc.contact_name),
          contact_email: str(loc.contact_email),
        }
      : null,
    schedule: arr(data.schedule).map((b) => ({
      id: str(b.id),
      label: str(b.label),
      start_time: str(b.start_time),
      end_time: str(b.end_time),
      location: str(b.location),
      notes: str(b.notes),
      talent: arr(b.talent).map((t) => ({ name: str(t.name) })),
      crew: arr(b.crew).map((c) => ({ id: str(c.id), name: str(c.name) })),
    })),
    crew: arr(data.crew).map((c) => ({ id: str(c.id), name: str(c.name), role: str(c.role), phone: str(c.phone), email: str(c.email) })),
  });
}
