// Top of the Settings Account tab: says which client these settings belong to, and lets staff switch.
// The settings are stored per ad account, and an ad account belongs to a client, so the client name
// leads and the ad account sits under it. Switching goes through the one client selection (the same
// one the client switcher uses), so the page and the rest of the app stay on the same client.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SwitcherClient } from "@/contexts/ClientSelectionContext";

interface AccountScopeHeaderProps {
  /** Name of the ad account the settings below apply to. */
  accountName: string;
  accountId: string;
  /** The selected client, or null when none is picked or the account is not linked to it. */
  clientName: string | null;
  clients: SwitcherClient[];
  selectedSlug: string;
  onPickClient: (slug: string) => void;
  /** The selected client's ad accounts. A chooser shows when there is more than one. */
  linkedAccounts: { id: string; name: string }[];
  onPickAccount: (id: string) => void;
}

export function AccountScopeHeader({
  accountName, accountId, clientName, clients, selectedSlug, onPickClient, linkedAccounts, onPickAccount,
}: AccountScopeHeaderProps) {
  return (
    <header className="glass-panel space-y-3 p-5" data-testid="settings-account-scope">
      <div>
        <p className="font-label text-[11px] uppercase tracking-wide text-slate">Settings for</p>
        <h2 className="font-heading text-[26px] leading-tight text-forest" data-testid="settings-account-client-name">
          {clientName ?? accountName}
        </h2>
        <p className="font-body text-[13px] text-slate" data-testid="settings-account-ad-account">
          {clientName ? `Ad account: ${accountName}` : "This ad account is not linked to a client."}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {clients.length > 0 && (
          <div className="space-y-1">
            <label className="font-body text-[12px] text-slate" id="settings-client-label">Client</label>
            <Select value={selectedSlug || undefined} onValueChange={onPickClient}>
              <SelectTrigger className="w-64" aria-labelledby="settings-client-label" data-testid="settings-client-select">
                <SelectValue placeholder="Choose a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {linkedAccounts.length > 1 && (
          <div className="space-y-1">
            <label className="font-body text-[12px] text-slate" id="settings-account-label">Ad account</label>
            <Select value={accountId} onValueChange={onPickAccount}>
              <SelectTrigger className="w-64" aria-labelledby="settings-account-label" data-testid="settings-account-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {linkedAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </header>
  );
}
