// /capture/share-target — where an Android share sheet lands (US-003).
//
// Reached two ways, both of which arrive here as a GET:
//   • the service worker's 303 after Chrome POSTs the share (src/sw.ts)
//   • directly, e.g. /capture/share-target?url=… (handy for testing)
//
// The job is deliberately small: work out WHAT was shared, hand it to the one
// shared capture service (US-002), and narrate the result. No scraping, no
// analysis, no persistence lives here — useVaultCapture owns all of that, and
// with it the role gate and the session-authed edge-function path required by
// policy verdanote-in-app-ui-uses-session-authed-edge-function-not-api.
//
// It saves on arrival with no confirm tap. That is the whole point of a share
// target: the user already expressed intent in the OS share sheet, and asking
// again would make this slower than opening the app.
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Leaf, Loader2, ShieldOff, XCircle } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { CLIENT_ROLE_MESSAGE, useVaultCapture } from "@/features/vault/hooks/useVaultCapture";
import {
  SHARE_ERROR_PARAM,
  SHARE_TARGET_PATH,
  SHARED_FILE_PARAM,
  extractSharedUrl,
  markShareConsumed,
  takeSharedFile,
  wasShareConsumed,
} from "@/pwa/shareTarget";

/** What the OS handed us, once resolved out of the URL / the worker's stash. */
type SharedPayload = { type: "url"; url: string } | { type: "file"; file: File };

/** Chrome could not deliver a readable share (worker caught a malformed POST). */
const SHARE_UNREADABLE_MESSAGE =
  "That share did not come through. Try sharing it again.";

/** Landed here with nothing attached — usually a stale reload of a consumed share. */
const NOTHING_SHARED_MESSAGE =
  "Nothing to save here. Share a link or a photo from another app to add it to the Vault.";

/** This exact share already went in — a reload, not a second thing to save. */
const ALREADY_SAVED_MESSAGE =
  "You already saved this one. It is in the Creative Vault.";

function ShareTargetShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-8">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
        <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Leaf className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        {children}
      </div>
    </div>
  );
}

export default function CaptureShareTarget() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { user, role, isLoading: authLoading, isClient } = useAuth();

  // Pass the resolved role straight through so the service skips its own role
  // lookup — one less round-trip on a phone connection, same gate either way.
  const { captureUrl, captureFile, status, error, needsLogin, reset } = useVaultCapture({
    role: role ?? undefined,
  });

  const [payload, setPayload] = useState<SharedPayload | null>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [resolvingPayload, setResolvingPayload] = useState(true);
  const [alreadySaved, setAlreadySaved] = useState(false);

  const sharedFileKey = searchParams.get(SHARED_FILE_PARAM);
  const workerReportedError = searchParams.get(SHARE_ERROR_PARAM) === "1";
  // The whole share payload lives in the query string, so it identifies the
  // share for dedupe purposes.
  const shareKey = location.search;

  // Resolve the share exactly once. Reading the stashed file CONSUMES it, so a
  // re-run would find nothing and wrongly report an empty share.
  const resolvedRef = useRef(false);
  useEffect(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    let cancelled = false;
    (async () => {
      // A link share is fully replayable from the URL, so Chrome Android's
      // pull-to-refresh (a one-finger gesture on exactly this screen) would
      // otherwise remount and save a second copy.
      if (wasShareConsumed(shareKey)) {
        if (!cancelled) {
          setAlreadySaved(true);
          setResolvingPayload(false);
        }
        return;
      }

      if (workerReportedError) {
        if (!cancelled) {
          setPayloadError(SHARE_UNREADABLE_MESSAGE);
          setResolvingPayload(false);
        }
        return;
      }

      // A photo share carries a key; a link share carries url/text/title.
      const file = await takeSharedFile(sharedFileKey);
      if (cancelled) return;

      if (file) {
        setPayload({ type: "file", file });
      } else {
        const url = extractSharedUrl(searchParams);
        if (url) setPayload({ type: "url", url });
        else setPayloadError(sharedFileKey ? SHARE_UNREADABLE_MESSAGE : NOTHING_SHARED_MESSAGE);
      }
      setResolvingPayload(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, sharedFileKey, workerReportedError, shareKey]);

  // Record the save as soon as it lands, so a reload shows "already saved"
  // instead of creating a duplicate vault item.
  useEffect(() => {
    if (status === "saved") markShareConsumed(shareKey);
  }, [status, shareKey]);

  const save = useCallback(
    (shared: SharedPayload) => {
      void (shared.type === "url" ? captureUrl(shared.url) : captureFile(shared.file));
    },
    [captureUrl, captureFile],
  );

  // Auto-save as soon as we know what was shared and who is signed in.
  const savedRef = useRef(false);
  useEffect(() => {
    if (savedRef.current) return;
    if (authLoading || !user || isClient) return;
    if (!payload) return;
    savedRef.current = true;
    save(payload);
  }, [authLoading, user, isClient, payload, save]);

  const retry = useCallback(() => {
    if (!payload) return;
    reset();
    save(payload);
  }, [payload, reset, save]);

  // --- Gates ---------------------------------------------------------------

  if (authLoading) {
    return (
      <ShareTargetShell>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </ShareTargetShell>
    );
  }

  // No session (or it expired mid-save). Carry the full share URL through the
  // login round-trip in router state so LoginPage returns here and the save is
  // retried automatically, rather than stranding the user on the dashboard.
  if (!user || needsLogin) {
    const returnTo = `${SHARE_TARGET_PATH}${location.search}`;
    return <Navigate to="/login" replace state={{ from: returnTo }} />;
  }

  // Client accounts never reach a save attempt — the service would reject it
  // anyway, but stopping here keeps the message immediate and honest.
  if (isClient) {
    return (
      <ShareTargetShell>
        <ShieldOff className="mb-3 h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-base font-semibold">Not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">{CLIENT_ROLE_MESSAGE}</p>
      </ShareTargetShell>
    );
  }

  if (resolvingPayload) {
    return (
      <ShareTargetShell>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Reading what you shared…</p>
      </ShareTargetShell>
    );
  }

  // Reload of a share that already went in. Confirm rather than re-saving.
  if (alreadySaved) {
    return (
      <ShareTargetShell>
        <CheckCircle2 className="mb-3 h-6 w-6 text-primary" aria-hidden="true" />
        <h1 className="text-base font-semibold">Saved ✓</h1>
        <p className="mt-2 text-sm text-muted-foreground">{ALREADY_SAVED_MESSAGE}</p>
      </ShareTargetShell>
    );
  }

  if (payloadError) {
    return (
      <ShareTargetShell>
        <XCircle className="mb-3 h-6 w-6 text-destructive" aria-hidden="true" />
        <h1 className="text-base font-semibold">Nothing saved</h1>
        <p className="mt-2 text-sm text-muted-foreground">{payloadError}</p>
      </ShareTargetShell>
    );
  }

  // --- Capture states ------------------------------------------------------

  const sharedLabel =
    payload?.type === "url" ? payload.url : (payload?.file.name ?? "Shared photo");

  if (status === "error") {
    return (
      <ShareTargetShell>
        <XCircle className="mb-3 h-6 w-6 text-destructive" aria-hidden="true" />
        <h1 className="text-base font-semibold">Could not save</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message ?? "Something went wrong."}
        </p>
        <p className="mt-1 w-full truncate text-xs text-muted-foreground">{sharedLabel}</p>
        <Button className="mt-5 w-full" onClick={retry}>
          Try again
        </Button>
      </ShareTargetShell>
    );
  }

  if (status === "saved") {
    return (
      <ShareTargetShell>
        <CheckCircle2 className="mb-3 h-6 w-6 text-primary" aria-hidden="true" />
        <h1 className="text-base font-semibold">Saved ✓</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It is in the Creative Vault. Analysis finishes in the background — you can close
          this.
        </p>
        <p className="mt-1 w-full truncate text-xs text-muted-foreground">{sharedLabel}</p>
      </ShareTargetShell>
    );
  }

  return (
    <ShareTargetShell>
      <Loader2 className="mb-3 h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      <h1 className="text-base font-semibold">Saving…</h1>
      <p className="mt-1 w-full truncate text-xs text-muted-foreground">{sharedLabel}</p>
    </ShareTargetShell>
  );
}
