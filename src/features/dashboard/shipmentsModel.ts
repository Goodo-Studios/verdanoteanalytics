// Shipments: staff page model (consolidation step 5c, port of the old
// dashboard's /shipments package tracker). Two lanes shown apart, as the owner
// asked: product going out to creators (the tracking, delivered date and
// delivery notes on creator_assignments) and product coming in to the studio
// (studio_shipments). Creator footage is due FOOTAGE_DUE_DAYS after delivery;
// the database sets that follow-up date when the delivery is recorded
// (set_creator_assignment_delivery). Pure helpers only.

export const FOOTAGE_DUE_DAYS = 5;
export const CARRIER_SUGGESTIONS = ["UPS", "FedEx", "USPS", "DHL", "Amazon"] as const;

export type ShipmentLane = "creators" | "studio";

export interface CreatorShipmentSource {
  id: string;
  creator_id: string;
  client_slug: string;
  stage: string;
  tracking_number: string | null;
  product_delivered_at: string | null;
  delivery_notes: string | null;
  next_follow_up_at: string | null;
  next_follow_up_source: string | null;
  dashboard_creators: { name: string } | null;
}

export interface StudioShipment {
  id: string;
  client_slug: string;
  actor_assignment_id: string | null;
  description: string;
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  expected_delivery_at: string | null;
  delivered_at: string | null;
  delivery_notes: string | null;
  actor_assignments: { scheduled_shoot_date: string | null; actors: { name: string } | null } | null;
}

export type ShipmentStatus = "not_shipped" | "in_transit" | "stuck" | "delivered" | "footage_due" | "footage_overdue";

export const STATUS_LABELS: Record<ShipmentStatus, string> = {
  not_shipped: "Not shipped",
  in_transit: "In transit",
  stuck: "Stuck",
  delivered: "Delivered",
  footage_due: "Footage due",
  footage_overdue: "Footage overdue",
};

/** One shipment from either lane, so one table can show both. */
export interface ShipmentRow {
  key: string;
  sourceId: string;
  lane: ShipmentLane;
  clientSlug: string;
  recipient: string;
  /** Creator page id, creators lane only. */
  creatorId: string | null;
  description: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  expectedDeliveryAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  footageDueAt: string | null;
  shootDate: string | null;
}

/** A creator assignment describes a shipment once it has tracking, a delivered date or delivery notes. */
export function isCreatorShipment(r: Pick<CreatorShipmentSource, "tracking_number" | "product_delivered_at" | "delivery_notes">): boolean {
  return r.tracking_number !== null || r.product_delivered_at !== null || r.delivery_notes !== null;
}

export function fromCreator(r: CreatorShipmentSource): ShipmentRow {
  return {
    key: `creators:${r.id}`, sourceId: r.id, lane: "creators", clientSlug: r.client_slug, recipient: r.dashboard_creators?.name ?? "Unknown creator",
    creatorId: r.creator_id, description: null, carrier: null, trackingNumber: r.tracking_number, shippedAt: null, expectedDeliveryAt: null,
    deliveredAt: r.product_delivered_at, notes: r.delivery_notes, footageDueAt: r.product_delivered_at === null ? null : r.next_follow_up_at, shootDate: null,
  };
}

export function fromStudio(r: StudioShipment): ShipmentRow {
  return {
    key: `studio:${r.id}`, sourceId: r.id, lane: "studio", clientSlug: r.client_slug, recipient: "Goodo studio", creatorId: null,
    description: r.description, carrier: r.carrier, trackingNumber: r.tracking_number, shippedAt: r.shipped_at, expectedDeliveryAt: r.expected_delivery_at,
    deliveredAt: r.delivered_at, notes: r.delivery_notes, footageDueAt: null, shootDate: r.actor_assignments?.scheduled_shoot_date ?? null,
  };
}

/** Old dashboard rule: delivered first, then late against the expected date, then in transit. Dates are YYYY-MM-DD. */
export function shipmentStatus(r: Pick<ShipmentRow, "deliveredAt" | "expectedDeliveryAt" | "shippedAt" | "trackingNumber" | "footageDueAt">, today: string): ShipmentStatus {
  if (r.deliveredAt !== null) {
    if (r.footageDueAt === null) return "delivered";
    return r.footageDueAt < today ? "footage_overdue" : "footage_due";
  }
  if (r.expectedDeliveryAt !== null && r.expectedDeliveryAt < today) return "stuck";
  if (r.shippedAt !== null || r.trackingNumber !== null) return "in_transit";
  return "not_shipped";
}

export function needsAttention(r: ShipmentRow, today: string): boolean {
  const s = shipmentStatus(r, today);
  return s === "stuck" || s === "footage_overdue";
}

const TRACKING: Record<string, (n: string) => string> = {
  ups: (n) => `https://www.ups.com/track?loc=en_US&requester=ST&tracknum=${n}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  usps: (n) => `https://tools.usps.com/tracking/${n}`,
  dhl: (n) => `https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=${n}`,
  amazon: (n) => `https://track.amazon.com/tracking/${n}`,
};

/** The carrier's public tracking page. Opening it only reads; nothing is created at the carrier. */
export function trackingUrl(carrier: string | null, tracking: string | null): string | null {
  if (!carrier || !tracking?.trim()) return null;
  const build = TRACKING[carrier.toLowerCase().replace(/[^a-z0-9]/g, "")];
  return build ? build(encodeURIComponent(tracking.trim())) : null;
}

export interface ShipmentFilters {
  lane: ShipmentLane;
  search: string;
  client: string;
  /** "" all, "open" not delivered yet, "attention" stuck or footage overdue. */
  show: "" | "open" | "attention";
}

export const DEFAULT_SHIPMENT_FILTERS: ShipmentFilters = { lane: "creators", search: "", client: "", show: "" };

const rank: Record<ShipmentStatus, number> = { footage_overdue: 0, stuck: 1, footage_due: 2, in_transit: 3, not_shipped: 4, delivered: 5 };

/** Filter one lane; most urgent first, then by client and recipient. */
export function filterShipments(rows: ShipmentRow[], f: ShipmentFilters, today: string, clientName: (slug: string) => string): ShipmentRow[] {
  const q = f.search.trim().toLowerCase();
  return rows
    .filter((r) => r.lane === f.lane)
    .filter((r) => !f.client || r.clientSlug === f.client)
    .filter((r) => f.show !== "open" || r.deliveredAt === null)
    .filter((r) => f.show !== "attention" || needsAttention(r, today))
    .filter((r) => !q || [r.recipient, r.description, r.carrier, r.trackingNumber, r.notes, clientName(r.clientSlug)].filter(Boolean).join(" ").toLowerCase().includes(q))
    .sort((a, b) => rank[shipmentStatus(a, today)] - rank[shipmentStatus(b, today)] || clientName(a.clientSlug).localeCompare(clientName(b.clientSlug)) || a.recipient.localeCompare(b.recipient));
}

export interface StudioForm {
  client_slug: string;
  description: string;
  carrier: string;
  tracking_number: string;
  shipped_at: string;
  expected_delivery_at: string;
  actor_assignment_id: string;
}

export const EMPTY_STUDIO_FORM: StudioForm = { client_slug: "", description: "", carrier: "", tracking_number: "", shipped_at: "", expected_delivery_at: "", actor_assignment_id: "" };

export function studioToForm(s: StudioShipment): StudioForm {
  return {
    client_slug: s.client_slug, description: s.description, carrier: s.carrier ?? "", tracking_number: s.tracking_number ?? "",
    shipped_at: s.shipped_at ?? "", expected_delivery_at: s.expected_delivery_at ?? "", actor_assignment_id: s.actor_assignment_id ?? "",
  };
}

export interface StudioArgs {
  p_client_slug: string;
  p_description: string;
  p_carrier: string | null;
  p_tracking_number: string | null;
  p_shipped_at: string | null;
  p_expected_delivery_at: string | null;
  p_actor_assignment_id: string | null;
}

const blank = (v: string) => (v.trim() ? v.trim() : null);

/** Checks the form the way create_studio_shipment and update_studio_shipment will. */
export function formToStudioArgs(f: StudioForm): StudioArgs {
  if (!f.client_slug) throw new Error("Pick the client the shipment is for.");
  const d = f.description.trim();
  if (!d) throw new Error("Say what is in the shipment.");
  if (d.length > 300) throw new Error("The description must be 300 characters or fewer.");
  if (f.carrier.trim().length > 100 || f.tracking_number.trim().length > 100) throw new Error("Carrier and tracking number must be 100 characters or fewer.");
  return {
    p_client_slug: f.client_slug, p_description: d, p_carrier: blank(f.carrier), p_tracking_number: blank(f.tracking_number),
    p_shipped_at: f.shipped_at || null, p_expected_delivery_at: f.expected_delivery_at || null, p_actor_assignment_id: f.actor_assignment_id || null,
  };
}
