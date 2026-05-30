import { useAccountContext } from "@/contexts/AccountContext";

/**
 * Client Home — the purpose-built landing page for brand-owner clients.
 *
 * This is the structural backbone for Phase A. It is intentionally a THIN
 * SHELL composing placeholder sections; the real content for each section is
 * filled in by later stories:
 *   - US-003: Highlights / wins
 *   - US-004: Performance snapshot (client-safe metrics)
 *   - US-005: Content pipeline summary
 *   - US-006: Creative library preview
 *   - US-007: Reports summary
 *
 * IMPORTANT: nothing on this surface may expose internal strategist controls
 * (kill/scale, Hook Rate, CPA/CTR tables, tagging). Keep that invariant as
 * sections are added.
 */
const ClientHomePage = () => {
  const { accounts, selectedAccountId } = useAccountContext();

  const accountName =
    accounts.find((a) => a.id === selectedAccountId)?.name ??
    (accounts.length === 1 ? accounts[0]?.name : undefined);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-[32px] text-forest">
          {accountName ? `Welcome, ${accountName}` : "Welcome"}
        </h1>
        <p className="font-body text-[13px] text-slate font-light mt-1">
          Your creative performance at a glance
        </p>
      </div>

      {/* Placeholder sections — filled by US-003..US-007 */}
      <section data-section="highlights" aria-label="Highlights" />
      <section data-section="performance-snapshot" aria-label="Performance snapshot" />
      <section data-section="content-pipeline-summary" aria-label="Content pipeline" />
      <section data-section="library-preview" aria-label="Creative library" />
      <section data-section="reports-summary" aria-label="Reports" />
    </div>
  );
};

export default ClientHomePage;
