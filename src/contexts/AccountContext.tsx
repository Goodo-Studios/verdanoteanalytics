import { createContext, useCallback, useContext, useState, useMemo, ReactNode, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccounts } from "@/hooks/useAccountsApi";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Account } from "@/types/account";
import { AccountAccessDeniedState } from "@/components/AccountAccessDeniedState";
import { Button } from "@/components/ui/button";

interface AccountContextType {
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  accounts: Account[];
  isLoading: boolean;
  selectedAccount: Account | null;
  /** True when the URL's ?account= id doesn't exist or isn't accessible (US-008). */
  accountAccessError: boolean;
  /** True when a client's linked accounts could not be loaded. The provider shows a retry screen. */
  linkedAccountsError: boolean;
  retryLinkedAccounts: () => void;
  /**
   * The account a ?account= link selected, until the user picks another one. The link is removed
   * from the address once applied (audit 3.4), so other code (the client switcher) reads this to
   * know the current account came from a link and must be left alone.
   */
  accountFromLink: string | null;
}

const AccountContext = createContext<AccountContextType>({
  accountFromLink: null,
  selectedAccountId: null,
  setSelectedAccountId: () => {},
  accounts: [],
  isLoading: false,
  selectedAccount: null,
  accountAccessError: false,
  linkedAccountsError: false,
  retryLinkedAccounts: () => {},
});

function storageKey(userId: string) {
  return `selectedAccountId_${userId}`;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { isClient, user } = useAuth();
  const { data: allAccounts, isLoading: accountsLoading } = useAccounts(user?.id);
  const needsAccountFilter = isClient;
  // A client's linked account ids, tagged with the user they were loaded for. Reading them back
  // through the current user id means ids loaded for a previous user are never used for the next.
  const [linked, setLinked] = useState<{ userId: string; ids: string[] | null; failed: boolean } | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const userId = user?.id;
  const linkedForUser = linked && linked.userId === userId ? linked : null;
  const linkedAccountIds = linkedForUser && !linkedForUser.failed ? linkedForUser.ids : null;
  const linkedAccountsError = needsAccountFilter && !!linkedForUser?.failed;
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountAccessError, setAccountAccessError] = useState(false);
  const [accountFromLink, setAccountFromLink] = useState<string | null>(null);
  // ?account= on the URL is the deep-link contract (US-008): a client-scoped
  // link carries the account explicitly instead of relying on whatever this
  // browser last had selected, which previously made every such link a
  // potential wrong-client data leak.
  const [searchParams, setSearchParams] = useSearchParams();
  // Remove ?account= from the address, keeping every other parameter (audit 3.4).
  const clearAccountParam = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("account");
      return next;
    }, { replace: true });
  const urlAccountId = searchParams.get("account");

  // Fetch linked accounts for clients
  useEffect(() => {
    if (!needsAccountFilter || !userId) {
      setLinked(null);
      return;
    }
    let cancelled = false;
    setLinked(null);
    supabase
      .from("user_accounts")
      .select("account_id")
      .eq("user_id", userId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch linked accounts:", error);
          setLinked({ userId, ids: null, failed: true });
          return;
        }
        setLinked({ userId, ids: (data || []).map((d) => d.account_id), failed: false });
      });
    return () => {
      cancelled = true;
    };
  }, [needsAccountFilter, userId, retryTick]);

  const retryLinkedAccounts = () => setRetryTick((n) => n + 1);

  // Clear selection on logout. The selection-resolution effect below already
  // bails on !user?.id, so it can never re-apply a stale selection after
  // logout — this explicit clear is redundant with that guard, intentionally,
  // so neither effect silently depends on the other for logout safety.
  useEffect(() => {
    if (!user) {
      setSelectedAccountId(null);
      setAccountFromLink(null);
    }
  }, [user]);

  // Filter accounts for clients. Until the linked ids are known a client sees no accounts at all,
  // never the unfiltered list.
  const accounts = useMemo(() => {
    if (!needsAccountFilter) return allAccounts || [];
    if (!linkedAccountIds) return [];
    return (allAccounts || []).filter((a) => linkedAccountIds.includes(a.id));
  }, [needsAccountFilter, linkedAccountIds, allAccounts]);

  // A failed lookup is not "loading": the retry screen below takes over instead of a spinner.
  const isLoading = accountsLoading || (needsAccountFilter && linkedAccountIds === null && !linkedAccountsError);

  // The agency-wide "all" bucket is for staff. A client is only ever scoped to their own accounts.
  const allowAll = !isClient;

  // Resolve account selection once user + accounts are ready.
  // Reads localStorage inline here so there's no race with a separate "load from
  // storage" effect — previously two effects ran in the same batch, the auto-select
  // effect saw selectedAccountId=null and stomped the stored value every mount.
  useEffect(() => {
    if (!user?.id || isLoading || !accounts.length) return;

    // URL account param takes precedence over everything below (US-008).
    // `accounts` is already role-filtered (a client only ever sees their linked
    // accounts), so "not in accounts" covers both "doesn't exist" and
    // "exists but isn't accessible to this user" in one check. Deliberately
    // NOT falling back to the stored/default account here — silently doing so
    // is exactly the bug this exists to close, where a client-scoped link could
    // render a different client's data with no visible sign anything was wrong.
    if (urlAccountId) {
      if ((urlAccountId === "all" && allowAll) || accounts.some(a => a.id === urlAccountId)) {
        setAccountAccessError(false);
        if (selectedAccountId !== urlAccountId) setSelectedAccountId(urlAccountId);
        setAccountFromLink(urlAccountId);
        // Apply the link once, then drop it from the address. Left in place it would win again on
        // every refresh of the account list and undo the user's own switch (audit 3.4).
        clearAccountParam();
      } else {
        setAccountAccessError(true);
      }
      return;
    }
    setAccountAccessError(false);

    // Current selection is valid — keep it (only lock single-account clients)
    if (selectedAccountId && ((selectedAccountId === "all" && allowAll) || accounts.some(a => a.id === selectedAccountId))) {
      if (isClient && accounts.length === 1 && selectedAccountId !== accounts[0].id) {
        setSelectedAccountId(accounts[0].id);
      }
      return;
    }

    // Restore from localStorage
    const stored = localStorage.getItem(storageKey(user.id));
    if (stored && ((stored === "all" && allowAll) || accounts.some(a => a.id === stored))) {
      setSelectedAccountId(stored);
      return;
    }

    // Default to first account
    setSelectedAccountId(accounts[0].id);
  // selectedAccountId intentionally omitted from deps — we only want this to fire
  // when user/accounts/urlAccountId change, not on every manual selection (that
  // would loop).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, accounts, isLoading, isClient, urlAccountId]);

  // Persist selection to localStorage
  useEffect(() => {
    if (!user?.id) return;
    if (selectedAccountId) {
      localStorage.setItem(storageKey(user.id), selectedAccountId);
    } else {
      localStorage.removeItem(storageKey(user.id));
    }
  }, [selectedAccountId, user?.id]);

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || null;

  // A choice made in the app (account picker, client switcher) ends the link's hold.
  // Stable identity, like the useState setter it wraps, so effects that list it do not re-run.
  const chooseAccount = useCallback((id: string | null) => {
    setAccountFromLink(null);
    setSelectedAccountId(id);
  }, []);
  const linkHold = accountFromLink !== null && accountFromLink === selectedAccountId ? accountFromLink : null;

  const value = { selectedAccountId, setSelectedAccountId: chooseAccount, accounts, isLoading, selectedAccount, accountAccessError, linkedAccountsError, retryLinkedAccounts, accountFromLink: linkHold };

  // A bad ?account= id renders the denial state INSTEAD of children — never
  // alongside them. Downstream pages read selectedAccount without checking
  // accountAccessError themselves, so this is the only place that can
  // guarantee no other account's data ever renders under an invalid link.
  if (accountAccessError) {
    return (
      <AccountContext.Provider value={value}>
        <AccountAccessDeniedState
          onGoToMyAccounts={() => {
            setAccountAccessError(false);
            clearAccountParam();
          }}
        />
      </AccountContext.Provider>
    );
  }

  // The client's accounts could not be loaded. Say so and offer a retry instead of a spinner that
  // never ends.
  if (linkedAccountsError) {
    return (
      <AccountContext.Provider value={value}>
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div role="alert" className="max-w-sm text-center space-y-4">
            <h1 className="text-lg font-semibold">We could not load your accounts</h1>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            <Button onClick={retryLinkedAccounts}>Try again</Button>
          </div>
        </div>
      </AccountContext.Provider>
    );
  }

  return (
    <AccountContext.Provider value={value}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccountContext() {
  return useContext(AccountContext);
}
