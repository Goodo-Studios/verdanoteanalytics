// Locations: staff page model (consolidation step 5c, port of the old
// dashboard's /locations page and its shared location links). Rows come from
// locations, location_photos, location_boards and location_board_items
// (migration 20261101000001, staff-only row rules). Locations are written
// through the checked functions create_location, update_location,
// set_location_capacity, set_location_entry_instructions and delete_location;
// links are written directly under the staff rules, as the old dashboard did.
//
// The page a client opens (/locations-board/<token>) stays on the old
// is served by Verdanote.
// Pure helpers only.

import { publicLinkUrl } from "@/features/public-links/publicLinkApi";

export const LOCATION_PHOTO_BUCKET = "location-photos";

export interface Location {
  id: string;
  name: string;
  neighborhood: string | null;
  rental_type: string | null;
  notes: string | null;
  cost: number | null;
  cost_period: "hourly" | "daily" | null;
  listing_url: string | null;
  rooms: string[];
  attributes: string[];
  have_rented: boolean;
  dont_rent_again: boolean;
  contact_name: string | null;
  contact_email: string | null;
  parking_instructions: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  entry_instructions: string | null;
  updated_at: string;
}

export interface LocationPhoto {
  id: string;
  location_id: string;
  storage_path: string;
  caption: string | null;
  sort_order: number;
}

export interface LocationBoard {
  id: string;
  client_slug: string | null;
  label: string | null;
  token: string;
  revoked: boolean;
  created_at: string;
  location_board_items: { location_id: string }[];
}

/** The public link a client opens. It opens on this site. */
export function locationBoardUrl(token: string): string {
  return publicLinkUrl("location", token);
}

export interface LocationFilters {
  search: string;
  neighborhood: string;
  minBedrooms: number | null;
  minBathrooms: number | null;
  hideDontRent: boolean;
}

export const DEFAULT_LOCATION_FILTERS: LocationFilters = { search: "", neighborhood: "", minBedrooms: null, minBathrooms: null, hideDontRent: false };

export interface FilteredLocations {
  /** Locations that pass every filter. */
  shown: Location[];
  /** Locations that pass the other filters but have no count recorded for an active minimum. Counted, never dropped (old dashboard rule). */
  unrecorded: Location[];
}

function matchesSearch(l: Location, q: string): boolean {
  if (!q) return true;
  const hay = [l.name, l.neighborhood, l.rental_type, l.notes, ...l.rooms, ...l.attributes].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

/** Search, neighborhood and an at-least floor on bedrooms and bathrooms, sorted by name. */
export function filterLocations(list: Location[], f: LocationFilters): FilteredLocations {
  const q = f.search.trim().toLowerCase();
  const shown: Location[] = [];
  const unrecorded: Location[] = [];
  for (const l of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!matchesSearch(l, q)) continue;
    if (f.neighborhood && l.neighborhood !== f.neighborhood) continue;
    if (f.hideDontRent && l.dont_rent_again) continue;
    const missing = (f.minBedrooms !== null && l.bedrooms === null) || (f.minBathrooms !== null && l.bathrooms === null);
    if (missing) {
      unrecorded.push(l);
      continue;
    }
    if (f.minBedrooms !== null && (l.bedrooms ?? 0) < f.minBedrooms) continue;
    if (f.minBathrooms !== null && (l.bathrooms ?? 0) < f.minBathrooms) continue;
    shown.push(l);
  }
  return { shown, unrecorded };
}

export function neighborhoodOptions(list: Location[]): string[] {
  return [...new Set(list.map((l) => l.neighborhood).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b));
}

export function formatCost(cost: number | null, period: string | null): string {
  if (cost === null || cost === undefined) return "";
  const amount = Number(cost).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number.isInteger(Number(cost)) ? 0 : 2 });
  return period === "hourly" ? `${amount} / hour` : period === "daily" ? `${amount} / day` : amount;
}

export function formatCapacity(l: Pick<Location, "bedrooms" | "bathrooms" | "max_guests">): string {
  const parts: string[] = [];
  if (l.bedrooms !== null) parts.push(`${l.bedrooms} bd`);
  if (l.bathrooms !== null) parts.push(`${Number(l.bathrooms)} ba`);
  if (l.max_guests !== null) parts.push(`${l.max_guests} guests`);
  return parts.join(" · ");
}

/** Only http(s) links are rendered as links. */
export function safeListingUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface LocationForm {
  name: string;
  neighborhood: string;
  rental_type: string;
  listing_url: string;
  cost: string;
  cost_period: "" | "hourly" | "daily";
  rooms: string;
  attributes: string;
  notes: string;
  have_rented: boolean;
  dont_rent_again: boolean;
  contact_name: string;
  contact_email: string;
  parking_instructions: string;
  wifi_name: string;
  wifi_password: string;
  bedrooms: string;
  bathrooms: string;
  max_guests: string;
  entry_instructions: string;
}

export const EMPTY_LOCATION_FORM: LocationForm = {
  name: "", neighborhood: "", rental_type: "", listing_url: "", cost: "", cost_period: "", rooms: "", attributes: "", notes: "",
  have_rented: false, dont_rent_again: false, contact_name: "", contact_email: "", parking_instructions: "", wifi_name: "", wifi_password: "",
  bedrooms: "", bathrooms: "", max_guests: "", entry_instructions: "",
};

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function locationToForm(l: Location): LocationForm {
  return {
    name: l.name, neighborhood: s(l.neighborhood), rental_type: s(l.rental_type), listing_url: s(l.listing_url), cost: s(l.cost),
    cost_period: l.cost_period ?? "", rooms: l.rooms.join(", "), attributes: l.attributes.join(", "), notes: s(l.notes),
    have_rented: l.have_rented, dont_rent_again: l.dont_rent_again, contact_name: s(l.contact_name), contact_email: s(l.contact_email),
    parking_instructions: s(l.parking_instructions), wifi_name: s(l.wifi_name), wifi_password: s(l.wifi_password),
    bedrooms: s(l.bedrooms), bathrooms: l.bathrooms === null ? "" : String(Number(l.bathrooms)), max_guests: s(l.max_guests),
    entry_instructions: s(l.entry_instructions),
  };
}

export function splitList(value: string): string[] {
  return [...new Set(value.split(",").map((x) => x.trim()).filter(Boolean))];
}

const blank = (v: string) => (v.trim() ? v.trim() : null);

/** The arguments of create_location, update_location, set_location_capacity and set_location_entry_instructions. */
export interface LocationArgs {
  p_name: string;
  p_listing_url: string | null;
  p_rental_type: string | null;
  p_neighborhood: string | null;
  p_cost: number | null;
  p_cost_period: string | null;
  p_rooms: string[];
  p_attributes: string[];
  p_notes: string | null;
  p_have_rented: boolean;
  p_dont_rent_again: boolean;
  p_contact_name: string | null;
  p_contact_email: string | null;
  p_parking_instructions: string | null;
  p_wifi_name: string | null;
  p_wifi_password: string | null;
  capacity: { p_bedrooms: number | null; p_bathrooms: number | null; p_max_guests: number | null };
  p_entry_instructions: string | null;
}

function count(value: string, label: string, half = false): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (half ? !Number.isInteger(n * 2) : !Number.isInteger(n))) {
    throw new Error(half ? `${label} must be zero or more, in steps of 0.5.` : `${label} must be a whole number, zero or more.`);
  }
  return n;
}

/** Checks the form the way the database will, so a bad value is caught before any call. */
export function formToArgs(f: LocationForm): LocationArgs {
  const name = f.name.trim();
  if (!name) throw new Error("A location name is required.");
  let cost: number | null = null;
  if (f.cost.trim()) {
    cost = Number(f.cost.trim());
    if (!Number.isFinite(cost) || cost < 0) throw new Error("Cost must be a number, zero or more.");
  }
  const email = blank(f.contact_email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("The contact email does not look like an email address.");
  return {
    p_name: name, p_listing_url: blank(f.listing_url), p_rental_type: blank(f.rental_type), p_neighborhood: blank(f.neighborhood),
    p_cost: cost, p_cost_period: f.cost_period || null, p_rooms: splitList(f.rooms), p_attributes: splitList(f.attributes), p_notes: blank(f.notes),
    p_have_rented: f.have_rented, p_dont_rent_again: f.dont_rent_again, p_contact_name: blank(f.contact_name), p_contact_email: email,
    p_parking_instructions: blank(f.parking_instructions), p_wifi_name: blank(f.wifi_name), p_wifi_password: blank(f.wifi_password),
    capacity: { p_bedrooms: count(f.bedrooms, "Bedrooms"), p_bathrooms: count(f.bathrooms, "Bathrooms", true), p_max_guests: count(f.max_guests, "Guests") },
    p_entry_instructions: blank(f.entry_instructions),
  };
}

/** Live links first (newest first), then revoked ones. */
export function sortBoards(boards: LocationBoard[]): LocationBoard[] {
  return [...boards].sort((a, b) => Number(a.revoked) - Number(b.revoked) || b.created_at.localeCompare(a.created_at));
}
