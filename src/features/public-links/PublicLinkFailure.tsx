// The page shown when a link cannot open: one plain sentence per reason, and a retry for the
// reasons that can pass.
import { Button } from "@/components/ui/button";
import { FAILURE_COPY, type LinkFailure } from "./publicLinkApi";
import { PublicShell } from "./PublicShell";

export function PublicLinkFailure({ failure, onRetry }: { failure: LinkFailure; onRetry: () => void }) {
  const copy = FAILURE_COPY[failure];
  return (
    <PublicShell title={copy.title}>
      <p role="alert" className="text-muted-foreground">{copy.body}</p>
      {(failure === "error" || failure === "rate_limited") && <Button type="button" className="mt-4" onClick={onRetry}>Try again</Button>}
    </PublicShell>
  );
}
