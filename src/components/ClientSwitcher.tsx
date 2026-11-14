import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useAccountContext } from "@/contexts/AccountContext";

const SELECT =
  "h-9 max-w-[220px] rounded-md border border-input bg-background px-2 font-body text-[13px] font-medium text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The one client switcher at the top of the app, for staff. It is the only place a staff
 * member picks a client; every page reads the choice. A client with several ad accounts
 * gets a small account chooser next to it, and a client with none says so.
 */
export function ClientSwitcher() {
  const { clients, isLoading, selectedSlug, setSelectedSlug, linkedAccounts, noAccount } = useClientSelection();
  const { selectedAccountId, setSelectedAccountId } = useAccountContext();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="client-switcher">
      <label htmlFor="client-switcher-select" className="font-label text-[10px] uppercase tracking-[0.1em] text-sage">
        Client
      </label>
      <select
        id="client-switcher-select"
        aria-label="Client"
        className={SELECT}
        value={selectedSlug}
        disabled={isLoading && clients.length === 0}
        onChange={(e) => setSelectedSlug(e.target.value)}
      >
        <option value="">{isLoading && clients.length === 0 ? "Loading clients..." : "All clients"}</option>
        {clients.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
            {c.active ? "" : " (inactive)"}
          </option>
        ))}
        {selectedSlug && !clients.some((c) => c.slug === selectedSlug) && clients.length > 0 ? (
          <option value={selectedSlug}>{selectedSlug}</option>
        ) : null}
      </select>
      {linkedAccounts.length > 1 ? (
        <select
          aria-label="Ad account"
          className={SELECT}
          value={linkedAccounts.some((a) => a.id === selectedAccountId) ? selectedAccountId ?? "" : linkedAccounts[0].id}
          onChange={(e) => setSelectedAccountId(e.target.value)}
        >
          {linkedAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      ) : null}
      {noAccount ? (
        <span className="text-[12px] text-muted-foreground" data-testid="client-switcher-no-account">
          No ad account linked yet
        </span>
      ) : null}
    </div>
  );
}
