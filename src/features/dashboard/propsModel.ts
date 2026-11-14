// Props: staff page model (consolidation step 5c, port of the old dashboard's
// /props page). Everything bought or borrowed for a shoot: what it cost, the
// client it was for (free text, as the old dashboard kept it), where it is now
// and what happened to it after. Rows come from props (migration
// 20261101000001, staff-only row rules) and are written through the checked
// functions create_prop, update_prop, set_prop_at_studio,
// set_prop_client_supplied, set_prop_return_status and delete_prop.
// Pure helpers only.

export const RETURN_STATUSES = ["Returned", "Thrown away", "Kept"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export interface Prop {
  id: string;
  name: string;
  store: string | null;
  price: number | null;
  return_status: ReturnStatus | null;
  client: string | null;
  at_studio: boolean;
  client_supplied: boolean;
  bin_number: string | null;
  notes: string | null;
  updated_at: string;
}

export interface PropFilters {
  search: string;
  store: string;
  client: string;
  /** "" any, "open" no outcome yet, or one outcome. */
  status: "" | "open" | ReturnStatus;
  /** "" anywhere, "studio" at the studio, "away" not at the studio. */
  where: "" | "studio" | "away";
}

export const DEFAULT_PROP_FILTERS: PropFilters = { search: "", store: "", client: "", status: "", where: "" };

export function filterProps(list: Prop[], f: PropFilters): Prop[] {
  const q = f.search.trim().toLowerCase();
  return [...list]
    .filter((p) => !q || [p.name, p.store, p.client, p.bin_number, p.notes].filter(Boolean).join(" ").toLowerCase().includes(q))
    .filter((p) => !f.store || p.store === f.store)
    .filter((p) => !f.client || p.client === f.client)
    .filter((p) => !f.status || (f.status === "open" ? p.return_status === null : p.return_status === f.status))
    .filter((p) => !f.where || (f.where === "studio" ? p.at_studio : !p.at_studio))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
export const storeOptions = (list: Prop[]) => distinct(list.map((p) => p.store));
export const clientOptions = (list: Prop[]) => distinct(list.map((p) => p.client));

export function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return "";
  return Number(price).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Sum of the prices shown, leaving out props the client supplied (nothing was spent on them). */
export function spentTotal(list: Prop[]): number {
  return list.reduce((sum, p) => sum + (p.client_supplied || p.price === null ? 0 : Number(p.price)), 0);
}

export interface PropForm {
  name: string;
  store: string;
  price: string;
  return_status: "" | ReturnStatus;
  client: string;
  bin_number: string;
  notes: string;
  at_studio: boolean;
  client_supplied: boolean;
}

export const EMPTY_PROP_FORM: PropForm = { name: "", store: "", price: "", return_status: "", client: "", bin_number: "", notes: "", at_studio: true, client_supplied: false };

export function propToForm(p: Prop): PropForm {
  return {
    name: p.name, store: p.store ?? "", price: p.price === null ? "" : String(p.price), return_status: p.return_status ?? "",
    client: p.client ?? "", bin_number: p.bin_number ?? "", notes: p.notes ?? "", at_studio: p.at_studio, client_supplied: p.client_supplied,
  };
}

export interface PropArgs {
  p_name: string;
  p_store: string | null;
  p_price: number | null;
  p_return_status: ReturnStatus | null;
  p_client: string | null;
  p_bin_number: string | null;
  p_notes: string | null;
  p_at_studio: boolean;
  p_client_supplied: boolean;
}

const blank = (v: string) => (v.trim() ? v.trim() : null);

/** Checks the form the way the database will, so a bad value is caught before any call. */
export function formToPropArgs(f: PropForm): PropArgs {
  const name = f.name.trim();
  if (!name) throw new Error("A prop name is required.");
  let price: number | null = null;
  if (f.price.trim()) {
    price = Number(f.price.trim().replace(/^\$/, ""));
    if (!Number.isFinite(price) || price < 0) throw new Error("Price must be a number, zero or more.");
  }
  return {
    p_name: name, p_store: blank(f.store), p_price: price, p_return_status: f.return_status || null, p_client: blank(f.client),
    p_bin_number: blank(f.bin_number), p_notes: blank(f.notes), p_at_studio: f.at_studio, p_client_supplied: f.client_supplied,
  };
}
