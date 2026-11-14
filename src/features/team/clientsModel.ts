// Client settings (consolidation step 5d, the old dashboard Settings "Active clients" half).
// Pure helpers. The database functions are the old dashboard's, already in Verdanote since
// PR 133: create_client (staff), update_client and set_client_active (builder). Dropped from
// the old page because they only made sense for Coda or are replaced: the "synced from Coda"
// wording (a synced client is "Updated by the HQ sync", origin 'coda' is the legacy value) and
// the single Verdanote account id field (client_ad_accounts replaces it, see the client page).

export const CLIENT_SELECT = "slug, name, active, status, origin, does_creators, does_production";
export const CLIENT_SLUG_MAX_LENGTH = 64;
const CLIENT_SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface ClientRow {
  slug: string;
  name: string;
  active: boolean;
  status: string | null;
  origin: string | null;
  does_creators: boolean;
  does_production: boolean;
}

/** A client the HQ sync keeps in step with its knowledge file is read only here. */
export const isSynced = (c: Pick<ClientRow, "origin">): boolean => c.origin === "coda";

export const originLabel = (c: Pick<ClientRow, "origin">): string => (isSynced(c) ? "Updated by the HQ sync" : "Added by hand");

export function serviceLinesLabel(c: Pick<ClientRow, "does_creators" | "does_production">): string {
  if (c.does_creators && c.does_production) return "Creators and production";
  if (c.does_creators) return "Creators";
  if (c.does_production) return "Production";
  return "No service line";
}

/** Lowercase letters, digits and single hyphens, from a name. */
export function suggestClientSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CLIENT_SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

export interface NewClientForm {
  name: string;
  slug: string;
  doesCreators: boolean;
  doesProduction: boolean;
}

/** The same checks create_client makes, so Save can say why it is off. */
export function newClientProblem(form: NewClientForm, existing: readonly string[]): string | null {
  if (!form.name.trim()) return "A client name is required.";
  const slug = form.slug.trim().toLowerCase();
  if (!slug) return "A slug is required.";
  if (slug.length > CLIENT_SLUG_MAX_LENGTH) return `The slug must be ${CLIENT_SLUG_MAX_LENGTH} characters or fewer.`;
  if (!CLIENT_SLUG_SHAPE.test(slug)) return 'Use lowercase letters, numbers and single hyphens, for example "acme-foods".';
  if (existing.includes(slug)) return `A client with the slug "${slug}" already exists.`;
  if (!form.doesCreators && !form.doesProduction) return "Pick at least one service line: creators, production or both.";
  return null;
}

export interface EditClientForm {
  name: string;
  doesCreators: boolean;
  doesProduction: boolean;
}

export function editClientProblem(form: EditClientForm): string | null {
  if (!form.name.trim()) return "A client name is required.";
  if (!form.doesCreators && !form.doesProduction) return "Pick at least one service line: creators, production or both.";
  return null;
}

export type ClientFilter = "active" | "inactive" | "all";

/** Active first, then by name; filtered by active state. */
export function filterClients(clients: ClientRow[], filter: ClientFilter, query: string): ClientRow[] {
  const q = query.trim().toLowerCase();
  return clients
    .filter((c) => (filter === "all" ? true : filter === "active" ? c.active : !c.active))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.slug.includes(q))
    .sort((a, b) => (a.active !== b.active ? (a.active ? -1 : 1) : a.name.localeCompare(b.name)));
}
