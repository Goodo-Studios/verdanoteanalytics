/** Shown on a page that works on one client when the switcher is on "All clients". */
export function PickClientPrompt({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" data-testid="pick-client-prompt">
      Pick a client in the switcher at the top of the page to see {what}.
    </p>
  );
}
