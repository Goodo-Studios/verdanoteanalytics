// Reads and writes for the Locations page (step 5c). Locations go through the
// checked functions from migration 20261101000002, which refuse anyone who is
// not builder or employee. Shared links (location_boards and their items) are
// written directly under the staff-only row rules, as the old dashboard did.
import { DashboardError, db, unwrap, unwrapOne } from "./api";
import { generateBoardToken } from "./approvalBoardsModel";
import { LOCATION_PHOTO_BUCKET, type Location, type LocationArgs, type LocationBoard, type LocationPhoto } from "./locationsModel";
import { signedUrls } from "./rosterApi";

const LOCATION_COLUMNS =
  "id, name, neighborhood, rental_type, notes, cost, cost_period, listing_url, rooms, attributes, have_rented, dont_rent_again, contact_name, contact_email, parking_instructions, wifi_name, wifi_password, bedrooms, bathrooms, max_guests, entry_instructions, updated_at";
const BOARD_COLUMNS = "id, client_slug, label, token, revoked, created_at, location_board_items(location_id)";

export interface LocationsData {
  locations: Location[];
  photos: LocationPhoto[];
  boards: LocationBoard[];
  /** storage path -> signed link, for the photos that exist in storage. */
  links: Map<string, string>;
}

export async function loadLocations(): Promise<LocationsData> {
  const [locations, photos, boards] = await Promise.all([
    unwrap(db.from("locations").select<Location[]>(LOCATION_COLUMNS).order("name")),
    unwrap(db.from("location_photos").select<LocationPhoto[]>("id, location_id, storage_path, caption, sort_order").order("sort_order")),
    unwrap(db.from("location_boards").select<LocationBoard[]>(BOARD_COLUMNS).order("created_at", { ascending: false })),
  ]);
  const links = await signedUrls(LOCATION_PHOTO_BUCKET, photos.map((p) => p.storage_path));
  return { locations, photos, boards, links };
}

async function saveDetails(id: string, a: LocationArgs): Promise<void> {
  await unwrap(db.rpc("update_location", {
    p_id: id, p_name: a.p_name, p_listing_url: a.p_listing_url, p_rental_type: a.p_rental_type, p_neighborhood: a.p_neighborhood,
    p_cost: a.p_cost, p_cost_period: a.p_cost_period, p_rooms: a.p_rooms, p_attributes: a.p_attributes, p_notes: a.p_notes,
    p_have_rented: a.p_have_rented, p_dont_rent_again: a.p_dont_rent_again, p_contact_name: a.p_contact_name, p_contact_email: a.p_contact_email,
    p_parking_instructions: a.p_parking_instructions, p_wifi_name: a.p_wifi_name, p_wifi_password: a.p_wifi_password,
  }));
  await unwrap(db.rpc("set_location_capacity", { p_id: id, ...a.capacity }));
  await unwrap(db.rpc("set_location_entry_instructions", { p_id: id, p_entry_instructions: a.p_entry_instructions }));
}

/** Adds a location, then saves the fields create_location does not take. Returns the new id. */
export async function createLocation(a: LocationArgs): Promise<string> {
  const row = await unwrapOne(db.rpc<{ id: string }>("create_location", {
    p_name: a.p_name, p_listing_url: a.p_listing_url, p_rental_type: a.p_rental_type, p_neighborhood: a.p_neighborhood,
    p_cost: a.p_cost, p_cost_period: a.p_cost_period, p_rooms: a.p_rooms, p_attributes: a.p_attributes, p_notes: a.p_notes,
  }));
  if (!row?.id) throw new DashboardError({ message: "The location was not added." });
  await saveDetails(row.id, a);
  return row.id;
}

export function updateLocation(id: string, a: LocationArgs): Promise<void> {
  return saveDetails(id, a);
}

/** delete_location removes the photo files first; a failed file delete leaves the location in place. */
export async function deleteLocation(id: string): Promise<void> {
  await unwrap(db.rpc("delete_location", { p_id: id }));
}

/** A link with its locations. If the locations cannot be added, the empty link is removed again. */
export async function createLocationBoard(clientSlug: string | null, label: string | null, locationIds: string[]): Promise<LocationBoard> {
  if (!locationIds.length) throw new DashboardError({ message: "Pick at least one location to share." });
  const board = await unwrapOne(
    db.from("location_boards").insert<LocationBoard[]>({ client_slug: clientSlug, label, token: generateBoardToken() }).select("id, client_slug, label, token, revoked, created_at").maybeSingle(),
  );
  if (!board) throw new DashboardError({ message: "The link was not created." });
  const items = await db.from("location_board_items").insert(locationIds.map((location_id) => ({ board_id: board.id, location_id })));
  if (items.error) {
    await db.from("location_boards").delete().eq("id", board.id);
    throw new DashboardError(items.error);
  }
  return { ...board, location_board_items: locationIds.map((location_id) => ({ location_id })) };
}

/** A revoke that matched no row is an error: the link would still be live. */
export async function revokeLocationBoard(id: string): Promise<void> {
  const row = await unwrapOne(db.from("location_boards").update({ revoked: true }).eq("id", id).select("id").maybeSingle());
  if (!row) throw new DashboardError({ message: "The link was not revoked. It may still be live." });
}
