import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { useAccounts } from "@/hooks/useAccountsApi";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Account } from "@/types/account";

interface AccountContextType {
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  accounts: Account[];
  isLoading: boolean;
  selectedAccount: Account | null;
}

const AccountContext = createContext<AccountContextType>({
  selectedAccountId: null,
  setSelectedAccountId: () => {},
  accounts: [],
  isLoading: false,
  selectedAccount: null,
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const { data: allAccounts, isLoading: accountsLoading } = useAccounts();
  const { isClient, user } = useAuth();
  const needsAccountFilter = isClient;
  const [linkedAccountIds, setLinkedAccountIds] = useState<string[] | null>(null);
  // Initialize to null — load from namespaced key once user is known (see effect below)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Load namespaced account selection when user changes; clear when user logs out
  useEffect(() => {
    if (user) {
      const stored = localStorage.getItem(`selectedAccountId_${user.id}`);
      setSelectedAccountId(stored ?? null);
    } else {
      setSelectedAccountId(null);
    }
  }, [user?.id]);

  // Fetch linked accounts for clients
  useEffect(() => {
    if (needsAccountFilter && user) {
      supabase
        .from("user_accounts")
        .select("account_id")
        .eq("user_id", user.id)
        .then(({ data }) => {
          setLinkedAccountIds((data || []).map((d) => d.account_id));
        });
    } else {
      setLinkedAccountIds(null);
    }
  }, [needsAccountFilter, user]);

  // Filter accounts for clients
  const accounts = needsAccountFilter && linkedAccountIds
    ? (allAccounts || []).filter((a) => linkedAccountIds.includes(a.id))
    : (allAccounts || []);

  const isLoading = accountsLoading || (needsAccountFilter && linkedAccountIds === null);

  // Auto-select first account if none selected, or clear stale selection
  useEffect(() => {
    if (isLoading || !accounts?.length) return;

    // Validate current selection exists in actual accounts (or is "all")
    if (selectedAccountId && selectedAccountId !== "all") {
      const exists = accounts.some((a) => a.id === selectedAccountId);
      if (!exists) {
        console.warn(`Stale account ID "${selectedAccountId}" not found — resetting`);
        setSelectedAccountId(accounts[0].id);
        return;
      }
    }

    if (!selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
    // For clients with single account, lock to it
    if (isClient && accounts?.length === 1) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, isLoading, selectedAccountId, isClient]);

  // Persist selection under namespaced key (no-op when user is not yet known)
  useEffect(() => {
    if (!user) return;
    if (selectedAccountId) {
      localStorage.setItem(`selectedAccountId_${user.id}`, selectedAccountId);
    } else {
      localStorage.removeItem(`selectedAccountId_${user.id}`);
    }
  }, [selectedAccountId, user?.id]);

  const selectedAccount = (accounts || []).find((a) => a.id === selectedAccountId) || null;

  return (
    <AccountContext.Provider value={{ selectedAccountId, setSelectedAccountId, accounts: accounts || [], isLoading, selectedAccount }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccountContext() {
  return useContext(AccountContext);
}
