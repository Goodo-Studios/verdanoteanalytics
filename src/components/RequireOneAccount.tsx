import type { ReactNode } from "react";
import { useAccountContext } from "@/contexts/AccountContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Wraps a page that works on one ad account at a time. On the Agency View
 * (every account selected) it asks staff to pick an account instead of loading
 * the page with no single account. With one account selected it renders the page.
 */
export function RequireOneAccount({ pageName, children }: { pageName: string; children: ReactNode }) {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccountContext();
  if (selectedAccountId !== "all") return <>{children}</>;

  return (
    <div className="mx-auto max-w-md py-16 text-center space-y-4" data-testid="pick-one-account">
      <h1 className="font-heading text-[20px] text-forest">Pick an account</h1>
      <p className="font-body text-[14px] text-slate">
        {pageName} shows one account at a time. Choose an account to see it here.
      </p>
      {accounts.length > 0 ? (
        <Select onValueChange={(v) => setSelectedAccountId(v)}>
          <SelectTrigger aria-label="Account" className="mx-auto w-64">
            <SelectValue placeholder="Choose an account" />
          </SelectTrigger>
          <SelectContent>
            {[...accounts].sort((a, b) => a.name.localeCompare(b.name)).map((acc) => (
              <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
