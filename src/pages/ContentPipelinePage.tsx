import { ContentPipeline } from "@/components/client/ContentPipeline";
import { useAccountContext } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";

export default function ContentPipelinePage() {
  const { selectedAccountId, isLoading } = useAccountContext();
  // A real client login sees the board of all its own clients, whatever account
  // is selected (or none). Staff, including a builder previewing as a client,
  // still pick an account: they have no row limit.
  const { isClient } = useAuth();

  return (
    <>
      <div className="space-y-6 p-6 md:p-10">
        {isLoading ? (
          // While accounts (and, for clients, their linked-account filter) are
          // still resolving, do NOT prematurely show the "Select an account"
          // prompt — that empty state is only meaningful once loading settles
          // with no account auto-selected.
          <p className="text-muted-foreground" data-testid="pipeline-loading">
            Loading content pipeline…
          </p>
        ) : isClient ? (
          <ContentPipeline own />
        ) : selectedAccountId && selectedAccountId !== "all" ? (
          <ContentPipeline accountId={selectedAccountId} />
        ) : (
          <p className="text-muted-foreground">Select an account to view the content pipeline.</p>
        )}
      </div>
    </>
  );
}
