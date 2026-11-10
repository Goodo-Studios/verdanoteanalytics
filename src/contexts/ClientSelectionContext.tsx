// The one client selection for staff. It replaces the sidebar account switcher, the "Brand"
// dropdown on the old dashboard pages and the "Client" dropdown on the Goodo OS pages.
//
// Where the selection lives:
//   1. The URL, when the page is per client: /clients/:slug/...
//   2. An old ?client= or ?brand= link (kept so bookmarks keep working).
//   3. Local storage, per person, for every other page.
// The selection also sets the ad account the analytics pages read (AccountContext): the
// client's first linked ad account, or the all-accounts view when no client is chosen. A
// client with several ad accounts gets a small account chooser; a client with none is told so.
import { createContext, useContext } from "react";

export interface SwitcherClient {
  slug: string;
  name: string;
  active: boolean;
}
export interface ClientAccountLink {
  account_id: string;
  client_slug: string;
}

export interface ClientSelection {
  /** Every client, by name. Empty until loaded, and for client logins. */
  clients: SwitcherClient[];
  isLoading: boolean;
  loadError: string | null;
  /** "" means all clients. */
  selectedSlug: string;
  selectedClient: SwitcherClient | null;
  setSelectedSlug: (slug: string) => void;
  /** Ad accounts linked to the selected client, as { id, name }. */
  linkedAccounts: { id: string; name: string }[];
  /** A client is selected and it has no ad account linked. */
  noAccount: boolean;
}

const EMPTY: ClientSelection = {
  clients: [],
  isLoading: false,
  loadError: null,
  selectedSlug: "",
  selectedClient: null,
  setSelectedSlug: () => {},
  linkedAccounts: [],
  noAccount: false,
};

export const ClientSelectionContext = createContext<ClientSelection>(EMPTY);

export const HUB_PATH = /^\/(?:builder|employee|client)\/clients\/([^/]+)(\/.*)?$/;
const ALL = "all";

/** Slug named by the address: the client hub path, or an old ?client= / ?brand= link. */
export function slugFromLocation(pathname: string, search: string): { slug: string | null; fromPath: boolean; hasParam: boolean } {
  const hub = HUB_PATH.exec(pathname);
  const params = new URLSearchParams(search);
  const hasParam = params.has("client") || params.has("brand");
  if (hub) {
    let decoded = hub[1];
    try {
      decoded = decodeURIComponent(hub[1]);
    } catch {
      /* keep the raw segment */
    }
    return { slug: decoded, fromPath: true, hasParam };
  }
  const raw = params.get("client") ?? params.get("brand");
  // The old Creator pipeline used brand=all for every brand: that is "all clients" now.
  return { slug: raw === null ? null : raw === ALL ? "" : raw, fromPath: false, hasParam };
}

export function useClientSelection(): ClientSelection {
  return useContext(ClientSelectionContext);
}

/** The selected client slug, or "" for all clients. Pages read this instead of keeping their own picker. */
export function useSelectedClientSlug(): string {
  return useContext(ClientSelectionContext).selectedSlug;
}
