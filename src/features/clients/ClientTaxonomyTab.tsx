// Taxonomy tab of the client hub: the themes and personas of one client, edited with the same editor
// that used to sit in Settings. The client is in the address, so the editor only offers this client's
// ad accounts (a client with several gets the editor's own account chooser). Builder only: the
// account-taxonomy function refuses anyone else, and this tab says so instead of showing an editor
// that would fail.
import { EmptyState, PageShell } from "@/components/page-kit";
import { useClientSelection } from "@/contexts/ClientSelectionContext";
import { useRealBuilder } from "@/hooks/useRealBuilder";
import TaxonomyConfigSection from "@/features/matrix/config/TaxonomyConfigSection";

export default function ClientTaxonomyTab({ clientName }: { clientName: string }) {
  const isBuilder = useRealBuilder();
  const { linkedAccounts } = useClientSelection();

  if (!isBuilder) {
    return (
      <PageShell data-testid="client-taxonomy-builders-only">
        <EmptyState title="Only a builder can change taxonomy" description={`Ask a builder to update the themes and personas for ${clientName}.`} />
      </PageShell>
    );
  }

  return (
    <PageShell data-testid="client-taxonomy-tab">
      <p className="text-sm text-muted-foreground">
        The themes and personas used to tag {clientName}&rsquo;s creatives. Changes here apply to {clientName} only.
      </p>
      <TaxonomyConfigSection accounts={linkedAccounts} />
    </PageShell>
  );
}
