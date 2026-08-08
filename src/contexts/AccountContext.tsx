import { createContext, useContext, useState, useMemo, ReactNode, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccounts } from "@/hooks/useAccountsApi";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Account } from "@/types/account";
import { AccountAccessDeniedState } from "@/components/AccountAccessDeniedState";

interface AccountContextType {
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  accounts: Account[];
  isLoading: boolean;
  selectedAccount: Account | null;
  /** True when the URL's ?account= id doesn't exist or isn't accessible (US-008). */
  accountAccessError: boolean;
}

const AccountContext = createContext<AccountContextType>({
  selectedAccountId: null,
  setSelectedAccountId: () => {},
  accounts: [],
  isLoading: false,
  selectedAccount: null,
  accountAccessError: false,
});

function storageKey(userId: string) {
  return `selectedAccountId_${userId}`;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { isClient, user } = useAuth();
  const { data: allAccounts, isLoading: accountsLoading } = useAccounts(user?.id);
  const needsAccountFilter = isClient;
  const [linkedAccountIds, setLinkedAccountIds] = useState<string[] | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountAccessError, setAccountAccessError] = useState(false);
  // ?account= on the URL is the deep-link contract (US-008): a client-scoped
  // link carries the account explicitly instead of relying on whatever this
  // browser last had selected, which previously made every such link a
  // potential wrong-client data leak.
  const [searchParams] = useSearchParams();
  const urlAccountId = searchParams.get("account");

  // Fetch linked accounts for clients
  useEffect(() => {
    if (needsAccountFilter && user) {
      supabase
        .from("user_accounts")
        .select("account_id")
        .eq("user_id", user.id)
        .then(({ data, error }) => {
          if (error) { console.error('Failed to fetch linked accounts:', error); return; }
          setLinkedAccountIds((data || []).map((d) => d.account_id));
        });
    } else {
      setLinkedAccountIds(null);
    }
  }, [needsAccountFilter, user]);

  // Clear selection on logout. The selection-resolution effect below already
  // bails on !user?.id, so it can never re-apply a stale selection after
  // logout — this explicit clear is redundant with that guard, intentionally,
  // so neither effect silently depends on the other for logout safety.
  useEffect(() => {
    if (!user) setSelectedAccountId(null);
  }, [user]);

  // Filter accounts for clients
  const accounts = useMemo(() =>
    needsAccountFilter && linkedAccountIds
      ? (allAccounts || []).filter((a) => linkedAccountIds.includes(a.id))
      : (allAccounts || []),
    [needsAccountFilter, linkedAccountIds, allAccounts]
  );

  const isLoading = accountsLoading || (needsAccountFilter && linkedAccountIds === null);

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
      if (urlAccountId === "all" || accounts.some(a => a.id === urlAccountId)) {
        setAccountAccessError(false);
        if (selectedAccountId !== urlAccountId) setSelectedAccountId(urlAccountId);
      } else {
        setAccountAccessError(true);
      }
      return;
    }
    setAccountAccessError(false);

    // Current selection is valid — keep it (only lock single-account clients)
    if (selectedAccountId && (selectedAccountId === "all" || accounts.some(a => a.id === selectedAccountId))) {
      if (isClient && accounts.length === 1 && selectedAccountId !== accounts[0].id) {
        setSelectedAccountId(accounts[0].id);
      }
      return;
    }

    // Restore from localStorage
    const stored = localStorage.getItem(storageKey(user.id));
    if (stored && (stored === "all" || accounts.some(a => a.id === stored))) {
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

  const value = { selectedAccountId, setSelectedAccountId, accounts, isLoading, selectedAccount, accountAccessError };

  // A bad ?account= id renders the denial state INSTEAD of children — never
  // alongside them. Downstream pages read selectedAccount without checking
  // accountAccessError themselves, so this is the only place that can
  // guarantee no other account's data ever renders under an invalid link.
  if (accountAccessError) {
    return (
      <AccountContext.Provider value={value}>
        <AccountAccessDeniedState />
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
