// Reads and writes for the Props page (step 5c). Every write goes through a
// checked function from migration 20261101000002, which refuses anyone who is
// not builder or employee; signed-in users hold only a read grant on props.
import { DashboardError, db, unwrap, unwrapOne } from "./api";
import type { Prop, PropArgs, ReturnStatus } from "./propsModel";

const PROP_COLUMNS = "id, name, store, price, return_status, client, at_studio, client_supplied, bin_number, notes, updated_at";

export function loadProps(): Promise<Prop[]> {
  return unwrap(db.from("props").select<Prop[]>(PROP_COLUMNS).order("name"));
}

export async function createProp(a: PropArgs): Promise<string> {
  const row = await unwrapOne(db.rpc<{ id: string }>("create_prop", { ...a }));
  if (!row?.id) throw new DashboardError({ message: "The prop was not added." });
  return row.id;
}

/** update_prop saves the details; where it is and who supplied it have their own checked functions. */
export async function updateProp(id: string, a: PropArgs, before: Pick<Prop, "at_studio" | "client_supplied">): Promise<void> {
  await unwrap(db.rpc("update_prop", {
    p_id: id, p_name: a.p_name, p_store: a.p_store, p_price: a.p_price, p_return_status: a.p_return_status,
    p_client: a.p_client, p_bin_number: a.p_bin_number, p_notes: a.p_notes,
  }));
  if (a.p_at_studio !== before.at_studio) await setAtStudio(id, a.p_at_studio);
  if (a.p_client_supplied !== before.client_supplied) await setClientSupplied(id, a.p_client_supplied);
}

export async function setAtStudio(id: string, atStudio: boolean): Promise<void> {
  await unwrap(db.rpc("set_prop_at_studio", { p_id: id, p_at_studio: atStudio }));
}

export async function setClientSupplied(id: string, supplied: boolean): Promise<void> {
  await unwrap(db.rpc("set_prop_client_supplied", { p_id: id, p_client_supplied: supplied }));
}

export async function setReturnStatus(id: string, status: ReturnStatus | null): Promise<void> {
  await unwrap(db.rpc("set_prop_return_status", { p_id: id, p_return_status: status }));
}

export async function deleteProp(id: string): Promise<void> {
  await unwrap(db.rpc("delete_prop", { p_id: id }));
}
