import { useLocation } from "react-router-dom";
import { useAccountContext } from "@/contexts/AccountContext";
import { useClientSelection } from "@/contexts/ClientSelectionContext";

/**
 * False for the moment between picking a client and the analytics pages pointing at that client's
 * ad account, so a page that reads the ad account never flashes another client's numbers.
 * True when no client is picked, when the client has no ad account (the page says so), when the
 * selected ad account is one of the client's, and when the address names an account on purpose.
 */
export function useAccountReady(): boolean {
  const { selectedSlug, linkedAccounts } = useClientSelection();
  const { selectedAccountId } = useAccountContext();
  const { search } = useLocation();
  if (!selectedSlug || linkedAccounts.length === 0) return true;
  if (new URLSearchParams(search).has("account")) return true;
  return linkedAccounts.some((a) => a.id === selectedAccountId);
}
