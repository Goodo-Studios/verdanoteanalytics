// Reads and writes for the Shipments page (step 5c). Studio shipments are
// written through the checked functions of migration 20261101000002 (signed-in
// users hold only a read grant on studio_shipments). Creator deliveries go
// through set_creator_assignment_delivery, which also sets the footage
// follow-up date. Nothing here calls a carrier; the tracking links only open
// the carrier's public page.
import { DashboardError, db, unwrap, unwrapOne } from "./api";
import type { CreatorShipmentSource, StudioArgs, StudioShipment } from "./shipmentsModel";

const CREATOR_COLUMNS =
  "id, creator_id, client_slug, stage, tracking_number, product_delivered_at, delivery_notes, next_follow_up_at, next_follow_up_source, dashboard_creators(name)";
const STUDIO_COLUMNS =
  "id, client_slug, actor_assignment_id, description, carrier, tracking_number, shipped_at, expected_delivery_at, delivered_at, delivery_notes, actor_assignments(scheduled_shoot_date, actors(name))";

export interface ShootOption {
  id: string;
  client_slug: string;
  scheduled_shoot_date: string;
  actors: { name: string } | null;
}

export interface ShipmentsData {
  creators: CreatorShipmentSource[];
  studio: StudioShipment[];
  shoots: ShootOption[];
}

export async function loadShipments(): Promise<ShipmentsData> {
  const [creators, studio, shoots] = await Promise.all([
    unwrap(db.from("creator_assignments").select<CreatorShipmentSource[]>(CREATOR_COLUMNS).or("tracking_number.not.is.null,product_delivered_at.not.is.null,delivery_notes.not.is.null")),
    unwrap(db.from("studio_shipments").select<StudioShipment[]>(STUDIO_COLUMNS).order("created_at", { ascending: false })),
    unwrap(db.from("actor_assignments").select<ShootOption[]>("id, client_slug, scheduled_shoot_date, actors(name)").not("scheduled_shoot_date", "is", null).order("scheduled_shoot_date")),
  ]);
  return { creators, studio, shoots };
}

/** Tracking, delivered date and notes together: the function replaces all three, so the current notes are always sent. */
export async function saveCreatorDelivery(id: string, tracking: string | null, deliveredAt: string | null, notes: string | null): Promise<void> {
  await unwrap(db.rpc("set_creator_assignment_delivery", { p_assignment_id: id, p_tracking_number: tracking, p_product_delivered_at: deliveredAt, p_delivery_notes: notes }));
}

export async function createStudioShipment(a: StudioArgs): Promise<string> {
  const row = await unwrapOne(db.rpc<{ id: string }>("create_studio_shipment", { ...a }));
  if (!row?.id) throw new DashboardError({ message: "The shipment was not added." });
  return row.id;
}

export async function updateStudioShipment(id: string, a: StudioArgs): Promise<void> {
  await unwrap(db.rpc("update_studio_shipment", { p_id: id, ...a }));
}

export async function setStudioDelivered(id: string, deliveredAt: string | null): Promise<void> {
  await unwrap(db.rpc("set_studio_shipment_delivered", { p_id: id, p_delivered_at: deliveredAt }));
}

export async function setStudioNotes(id: string, notes: string | null): Promise<void> {
  await unwrap(db.rpc("set_studio_shipment_notes", { p_id: id, p_delivery_notes: notes }));
}

export async function deleteStudioShipment(id: string): Promise<void> {
  await unwrap(db.rpc("delete_studio_shipment", { p_id: id }));
}
