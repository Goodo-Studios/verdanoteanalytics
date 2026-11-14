import { Button } from "@/components/ui/button";

interface NoAccessScreenProps {
  onRetry: () => void;
  onSignOut: () => void;
}

/**
 * Shown to a signed-in user whose role could not be found (the lookup failed after retries, or the
 * account has no role). It stands in for the app so nobody is dropped into pages meant for another
 * role.
 */
export function NoAccessScreen({ onRetry, onSignOut }: NoAccessScreenProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div role="alert" className="max-w-sm text-center space-y-4">
        <h1 className="text-lg font-semibold">We could not load your access</h1>
        <p className="text-sm text-muted-foreground">
          Your account is signed in, but we could not confirm what it can open. Try again. If this keeps
          happening, ask your Goodo contact to check your account.
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={onRetry}>Try again</Button>
          <Button variant="outline" onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
