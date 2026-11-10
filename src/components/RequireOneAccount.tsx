import type { ReactNode } from "react";
import { useAccountContext } from "@/contexts/AccountContext";
import { useClientSelection } from "@/contexts/ClientSelectionContext";

/**
 * Wraps a page that works on one client at a time. While the switcher is on "All clients"
 * it asks staff to pick a client instead of loading the page with no single ad account.
 * With one client's ad account selected it renders the page.
 */
export function RequireOneAccount({ pageName, children }: { pageName: string; children: ReactNode }) {
  const { selectedAccountId } = useAccountContext();
  const { clients, selectedSlug, setSelectedSlug, noAccount } = useClientSelection();
  if (selectedAccountId !== "all") return <>{children}</>;

  return (
    <div className="mx-auto max-w-md py-16 text-center space-y-4" data-testid="pick-one-account">
      <h1 className="font-heading text-[20px] text-forest">Pick a client</h1>
      <p className="font-body text-[14px] text-slate">
        {pageName} shows one client at a time. Choose a client to see it here.
      </p>
      {noAccount ? (
        <p className="font-body text-[13px] text-muted-foreground" role="status">
          This client has no ad account linked yet, so there is nothing to show.
        </p>
      ) : null}
      {clients.length > 0 ? (
        <select
          aria-label="Choose a client"
          className="mx-auto block h-9 w-64 rounded-md border border-input bg-background px-2 text-sm"
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
        >
          <option value="">Choose a client</option>
          {clients.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
