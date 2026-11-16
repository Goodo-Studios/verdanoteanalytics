/**
 * Old shared ad board links (/shared/ad-board/:shareToken). The shared board read the deprecated
 * ad_library_* tables with no login and was retired (audit plan item 3.3). The route stays so old
 * links get a clear message instead of a "not found" page; it reads nothing.
 */
export default function SharedAdBoardPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="font-heading text-2xl text-forest">This board is no longer available</h1>
        <p className="font-body text-sm text-muted-foreground">
          Shared ad boards have been retired. If someone sent you this link, ask them for an updated one.
        </p>
      </div>
    </main>
  );
}
