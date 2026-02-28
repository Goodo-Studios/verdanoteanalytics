import { AppLayout } from "@/components/AppLayout";
import { ContentPipeline } from "@/components/client/ContentPipeline";
import { useAccountContext } from "@/contexts/AccountContext";

export default function ContentPipelinePage() {
  const { selectedAccountId } = useAccountContext();

  return (
    <AppLayout>
      <div className="space-y-6 p-6 md:p-10 max-w-4xl">
        {selectedAccountId && selectedAccountId !== "all" ? (
          <ContentPipeline accountId={selectedAccountId} />
        ) : (
          <p className="text-muted-foreground">Select an account to view the content pipeline.</p>
        )}
      </div>
    </AppLayout>
  );
}
