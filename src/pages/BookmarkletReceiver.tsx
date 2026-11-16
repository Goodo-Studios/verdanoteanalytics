import { Link } from "react-router-dom";

/**
 * Old bookmarklet links (/bookmarklet-receiver). The bookmarklet and the Facebook saver saved to
 * the retired Ad Library table, so those saves never reached the Vault. Both were retired (audit
 * plan item 4.1). The route stays so a bookmark saved earlier gets a clear message; it saves
 * nothing.
 */
export default function BookmarkletReceiver() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="font-heading text-2xl text-forest">This tool has been retired</h1>
        <p className="font-body text-sm text-muted-foreground">
          Save ads to the Vault instead. Nothing was saved from this link.
        </p>
        <Link to="/" className="font-body text-sm text-forest underline">
          Open Verdanote
        </Link>
      </div>
    </main>
  );
}
