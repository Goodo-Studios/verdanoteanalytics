import { useMemo } from "react";
import { useAccountContext } from "@/contexts/AccountContext";
import { useWinnerCreatives } from "@/hooks/useWinnerCreatives";
import { resolveWinnerConfig, selectWinners } from "@/lib/winnerSelection";
import {
  ClientWinnersSection,
  type ClientWinner,
} from "@/components/client/ClientWinnersSection";

/** Cap the client surface to a manageable number of winners. */
const MAX_WINNERS = 6;

/**
 * Data wrapper for the client "What's working" section (US-004).
 *
 * Selects winners with the SAME scale-threshold logic that
 * `useOverviewPageState` uses for its `winRate` (via the shared
 * `selectWinners`), resolving thresholds from the selected account — so the
 * client and strategist agree on who is winning.
 */
export function ClientWinnersContainer({ accountId }: { accountId?: string }) {
  const { selectedAccount } = useAccountContext();

  const { data: creatives = [], isLoading } = useWinnerCreatives(accountId);

  const winners = useMemo<ClientWinner[]>(() => {
    const config = resolveWinnerConfig(selectedAccount);
    return selectWinners(creatives, config)
      .slice(0, MAX_WINNERS)
      .map((c: any) => ({
        id: String(c.ad_id ?? c.id),
        ad_name: c.ad_name ?? null,
        video_url: c.video_url ?? null,
        thumbnail_url: c.thumbnail_url ?? null,
        full_res_url: c.full_res_url ?? null,
        spend: c.spend ?? null,
        roas: c.roas ?? null,
        purchase_value: c.purchase_value ?? null,
      }));
  }, [creatives, selectedAccount]);

  return <ClientWinnersSection winners={winners} isLoading={isLoading} />;
}

export default ClientWinnersContainer;
