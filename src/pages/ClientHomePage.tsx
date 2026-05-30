import { useAccountContext } from "@/contexts/AccountContext";
import { ClientOutcomesContainer } from "@/components/client/ClientOutcomesContainer";
import { ClientWinnersContainer } from "@/components/client/ClientWinnersContainer";
import { ClientHighlightsContainer } from "@/components/client/ClientHighlightsContainer";
import { ContentPipeline } from "@/components/client/ContentPipeline";

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

  const isSingleAccount = selectedAccountId && selectedAccountId !== "all";
  const outcomeAccountId = isSingleAccount ? selectedAccountId : undefined;

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
      {/*
        US-005: AI-drafted, strategist-published narrative. The container gates
        authoring (draft/edit/publish) on builder/employee; clients read only
        the published narrative via the published view. Degrades to a friendly
        onboarding line when nothing is published yet.
      */}
      <section data-section="this-periods-highlights" aria-label="This Period's Highlights">
        <ClientHighlightsContainer accountId={outcomeAccountId} />
      </section>
      <section data-section="performance-snapshot" aria-label="Performance snapshot">
        <ClientOutcomesContainer accountId={outcomeAccountId} />
      </section>
      <section data-section="whats-working" aria-label="What's working">
        <ClientWinnersContainer accountId={outcomeAccountId} />
      </section>
      {/*
        US-007: read-only "what we're making next" transparency. Reuses the
        ContentPipeline component (self-fetches via useCodaTasks). Read-only —
        no comment / approve / request-changes / upload affordances. Degrades
        to an empty/onboarding state when no account is selected or no pipeline
        data exists for the account.
      */}
      <section data-section="content-pipeline-summary" aria-label="Content pipeline">
        {outcomeAccountId ? (
          <ContentPipeline accountId={outcomeAccountId} />
        ) : (
          <div className="glass-panel p-7">
            <h2 className="font-heading text-[20px] text-foreground mb-4">Content Pipeline</h2>
            <p className="font-body text-[14px] text-muted-foreground italic">
              Nothing in production yet — new creative will show up here as we plan and build it.
            </p>
          </div>
        )}
      </section>
      <section data-section="library-preview" aria-label="Creative library" />
      <section data-section="reports-summary" aria-label="Reports" />
    </div>
  );
};

export default ClientHomePage;
