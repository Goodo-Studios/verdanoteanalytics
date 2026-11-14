// The provider behind the one client switcher. See ClientSelectionContext.tsx for what the selection is.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAccountContext } from "@/contexts/AccountContext";
import {
  ClientSelectionContext,
  HUB_PATH,
  slugFromLocation,
  type ClientAccountLink,
  type ClientSelection,
  type SwitcherClient,
} from "@/contexts/ClientSelectionContext";
import { useClientPreview } from "@/hooks/useClientPreviewMode";
import { CLIENT_SWITCHER_COLUMNS, CLIENT_SWITCHER_LINK_COLUMNS } from "@/lib/pageQueries";

const storageKey = (userId: string) => `verdanote.selectedClient.${userId}`;
function readStored(userId: string | undefined): string {
  if (!userId || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(storageKey(userId)) ?? "";
  } catch {
    return "";
  }
}
function writeStored(userId: string | undefined, slug: string) {
  if (!userId || typeof window === "undefined") return;
  try {
    if (slug) window.localStorage.setItem(storageKey(userId), slug);
    else window.localStorage.removeItem(storageKey(userId));
  } catch {
    /* private mode or full storage: the selection just is not remembered */
  }
}

type Untyped = {
  from(table: string): { select(columns: string): PromiseLike<{ data: unknown; error: { message: string } | null }> };
};
const untyped = supabase as unknown as Untyped;

export function ClientSelectionProvider({ children }: { children: ReactNode }) {
  const { user, isClient } = useAuth();
  const { isClientPreview } = useClientPreview();
  const { accounts, selectedAccountId, setSelectedAccountId, isLoading: accountsLoading } = useAccountContext();
  const location = useLocation();
  const navigate = useNavigate();
  // A client login, and a builder previewing the client view, keep the client menu and have no switcher.
  const enabled = !!user && !isClient && !isClientPreview;
  const userId = user?.id;

  const clientsQuery = useQuery({
    queryKey: ["client-selection", "clients"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SwitcherClient[]> => {
      const { data, error } = await untyped.from("clients").select(CLIENT_SWITCHER_COLUMNS);
      if (error) throw new Error(error.message);
      return ((data ?? []) as SwitcherClient[]).slice().sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const linksQuery = useQuery({
    queryKey: ["client-selection", "links"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ClientAccountLink[]> => {
      const { data, error } = await untyped.from("client_ad_accounts").select(CLIENT_SWITCHER_LINK_COLUMNS);
      if (error) throw new Error(error.message);
      return (data ?? []) as ClientAccountLink[];
    },
  });

  const [stored, setStored] = useState(() => readStored(userId));
  useEffect(() => {
    setStored(readStored(userId));
  }, [userId]);

  const fromUrl = useMemo(() => slugFromLocation(location.pathname, location.search), [location.pathname, location.search]);
  const rawSlug = fromUrl.slug ?? stored;
  // A remembered or linked client that no longer exists counts as "all clients". The client
  // hub path keeps its slug so the hub can say it could not find that client.
  const slugKnown = !clientsQuery.isSuccess || (clientsQuery.data ?? []).some((c) => c.slug === rawSlug);
  const selectedSlug = rawSlug && !slugKnown && !fromUrl.fromPath ? "" : rawSlug;

  // An address that names a client becomes the remembered client.
  // Only when the address itself changes: a pick from the switcher must not be undone by the
  // address it is about to replace.
  const lastUrlSlug = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const previous = lastUrlSlug.current;
    lastUrlSlug.current = fromUrl.slug;
    if (fromUrl.slug === null || fromUrl.slug === previous) return;
    setStored(fromUrl.slug);
    writeStored(userId, fromUrl.slug);
  }, [enabled, fromUrl.slug, userId]);

  const clients = useMemo(() => (enabled ? clientsQuery.data ?? [] : []), [enabled, clientsQuery.data]);
  const selectedClient = useMemo(() => clients.find((c) => c.slug === selectedSlug) ?? null, [clients, selectedSlug]);

  const linkedAccounts = useMemo(() => {
    if (!enabled || !selectedSlug) return [];
    const ids = (linksQuery.data ?? []).filter((l) => l.client_slug === selectedSlug).map((l) => l.account_id);
    return ids
      .map((id) => accounts.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => ({ id: a.id, name: a.name }));
  }, [enabled, selectedSlug, linksQuery.data, accounts]);

  const linksReady = linksQuery.isSuccess && clientsQuery.isSuccess;
  const noAccount = enabled && !!selectedSlug && linksReady && !accountsLoading && linkedAccounts.length === 0;

  // Point the analytics pages at the selected client's ad account. An explicit ?account=
  // link (AccountContext's deep-link contract) is left alone.
  const accountRef = useRef(selectedAccountId);
  accountRef.current = selectedAccountId;
  const linkedKey = linkedAccounts.map((a) => a.id).join(",");
  const hasAccountParam = new URLSearchParams(location.search).has("account");
  useEffect(() => {
    if (!enabled || !linksReady || accountsLoading || hasAccountParam) return;
    const current = accountRef.current;
    if (!current) return; // AccountContext has not settled on an account yet
    if (!selectedSlug) {
      if (current !== "all") setSelectedAccountId("all");
      return;
    }
    if (linkedAccounts.length > 0 && !linkedAccounts.some((a) => a.id === current)) {
      setSelectedAccountId(linkedAccounts[0].id);
    }
    // linkedAccounts is covered by linkedKey; selectedAccountId is read through the ref so
    // a manual choice from the account chooser is not overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, linksReady, accountsLoading, selectedSlug, linkedKey, hasAccountParam, selectedAccountId === null]);

  const setSelectedSlug = useCallback(
    (slug: string) => {
      setStored(slug);
      writeStored(userId, slug);
      const hub = HUB_PATH.exec(location.pathname);
      if (hub) {
        const role = location.pathname.split("/")[1];
        const rest = hub[2] ?? "";
        navigate(slug ? `/${role}/clients/${encodeURIComponent(slug)}${rest}${location.search}` : `/${role}/clients`);
        return;
      }
      const params = new URLSearchParams(location.search);
      if (params.has("client") || params.has("brand")) {
        params.delete("client");
        params.delete("brand");
        const qs = params.toString();
        navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
      }
    },
    [userId, location.pathname, location.search, navigate],
  );

  const value = useMemo<ClientSelection>(
    () => ({
      clients,
      isLoading: enabled && (clientsQuery.isLoading || linksQuery.isLoading),
      loadError: clientsQuery.error instanceof Error ? clientsQuery.error.message : null,
      selectedSlug,
      selectedClient,
      setSelectedSlug,
      linkedAccounts,
      noAccount,
    }),
    [clients, enabled, clientsQuery.isLoading, linksQuery.isLoading, clientsQuery.error, selectedSlug, selectedClient, setSelectedSlug, linkedAccounts, noAccount],
  );

  return <ClientSelectionContext.Provider value={value}>{children}</ClientSelectionContext.Provider>;
}

