import { ContentPipeline } from "@/components/client/ContentPipeline";
import { useAccountContext } from "@/contexts/AccountContext";

export default function ContentPipelinePage() {
  const { selectedAccountId, isLoading } = useAccountContext();

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
        ) : selectedAccountId && selectedAccountId !== "all" ? (
          <ContentPipeline accountId={selectedAccountId} />
        ) : (
          <p className="text-muted-foreground">Select an account to view the content pipeline.</p>
        )}
      </div>
    </>
  );
}
