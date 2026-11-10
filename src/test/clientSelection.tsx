// Test helper: the one client switcher is a context (ClientSelectionContext). A page test
// that used to pick a client from the page's own dropdown now renders the page inside this
// provider with the client already selected, as the switcher or the client hub address would.
import type { ReactNode } from "react";
import { ClientSelectionContext, type ClientSelection, type SwitcherClient } from "@/contexts/ClientSelectionContext";

function clientSelection(slug: string, clients: SwitcherClient[] = [], extra: Partial<ClientSelection> = {}): ClientSelection {
  return {
    clients,
    isLoading: false,
    loadError: null,
    selectedSlug: slug,
    selectedClient: clients.find((c) => c.slug === slug) ?? null,
    setSelectedSlug: () => {},
    linkedAccounts: [],
    noAccount: false,
    ...extra,
  };
}

/** Renders children as if the switcher had `slug` selected. "" is "All clients". */
export function WithClient({ slug, clients = [], children, ...extra }: { slug: string; clients?: SwitcherClient[]; children: ReactNode } & Partial<ClientSelection>) {
  return <ClientSelectionContext.Provider value={clientSelection(slug, clients, extra)}>{children}</ClientSelectionContext.Provider>;
}
