// /capture/quick-add — the iPhone entry point into the Creative Vault (US-004).
//
// Why this page exists at all: Apple has never implemented the Web Share Target
// API, so Safari ignores the manifest's `share_target` outright. The Android
// path from US-003 (share sheet → /capture/share-target) simply does not exist
// on iOS. The iPhone equivalent is a home-screen icon added through Safari's
// Share ▸ Add to Home Screen, which opens THIS path standalone (index.html's
// apple-mobile-web-app-capable is what drops the browser chrome).
//
// So where the share-target route receives intent from the OS and saves on
// arrival, this one has to ASK for the intent: a big paste box and a photo
// button, one Save tap.
//
// Everything below the intent is identical to its Android sibling: the one
// shared capture service (US-002) owns scraping, upload, persistence, the
// client-role gate, and the session-authed edge-function path required by
// policy verdanote-in-app-ui-uses-session-authed-edge-function-not-api. This
// file only collects input and narrates the result.
import { useCallback, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { CheckCircle2, ImagePlus, Leaf, Loader2, ShieldOff, X } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CLIENT_ROLE_MESSAGE,
  useVaultCapture,
  type VaultCaptureInput,
} from "@/features/vault/hooks/useVaultCapture";
import {
  ADD_TO_HOME_SCREEN_TIP,
  CAPTURE_FILE_ACCEPT,
  QUICK_ADD_PATH,
  rememberTipDismissed,
  shouldShowHomeScreenTip,
} from "@/pwa/quickAdd";

function QuickAddShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-8">
      <div className="mx-auto flex w-full max-w-sm flex-col">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Leaf className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <span className="text-sm font-semibold">Verdanote Vault</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function CaptureQuickAdd() {
  const { user, role, isLoading: authLoading, isClient } = useAuth();

  // Hand the resolved role to the service so it skips its own role lookup —
  // one less round-trip on a phone connection, same gate either way.
  const { captureUrl, captureFile, status, error, needsLogin, reset } = useVaultCapture({
    role: role ?? undefined,
  });

  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  /** What the last successful save was, so the confirmation can name it. */
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [showTip, setShowTip] = useState(shouldShowHomeScreenTip);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isCapturing = status === "capturing";
  // A picked photo wins over a half-typed URL: it was the more deliberate act,
  // and the URL field is disabled while a file is staged so they cannot fight.
  const pending = useMemo<VaultCaptureInput | null>(
    () => (file ? { type: "file", file } : url.trim() ? { type: "url", url } : null),
    [file, url],
  );

  const clearFile = useCallback(() => {
    setFile(null);
    // Reset the input too, or picking the SAME photo again fires no change event.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      // Duplicate-save guard: a phone tap easily double-fires, and each save
      // creates a vault item. Nothing here is replayable-by-URL like the share
      // target, so guarding the in-flight capture is the whole of it.
      if (!pending || isCapturing) return;

      const label = pending.type === "url" ? pending.url : pending.file.name;
      const result =
        pending.type === "url" ? await captureUrl(pending.url) : await captureFile(pending.file);

      // Only clear on success — a failed save keeps the input so the user can
      // retry without re-pasting or re-picking.
      if (result) {
        setSavedLabel(label);
        setUrl("");
        clearFile();
      }
    },
    [pending, isCapturing, captureUrl, captureFile, clearFile],
  );

  const saveAnother = useCallback(() => {
    reset();
    setSavedLabel(null);
  }, [reset]);

  const dismissTip = useCallback(() => {
    setShowTip(false);
    rememberTipDismissed();
  }, []);

  // --- Gates ---------------------------------------------------------------

  if (authLoading) {
    return (
      <QuickAddShell>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </QuickAddShell>
    );
  }

  // No session, or it expired mid-save. Park this path in router state so
  // LoginPage returns here instead of dumping the user on the dashboard.
  if (!user || needsLogin) {
    return <Navigate to="/login" replace state={{ from: QUICK_ADD_PATH }} />;
  }

  // Client accounts never see the form. The service would reject the save
  // anyway; stopping here keeps the message immediate and honest.
  if (isClient) {
    return (
      <QuickAddShell>
        <div className="flex flex-col items-center text-center">
          <ShieldOff className="mb-3 h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-base font-semibold">Not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">{CLIENT_ROLE_MESSAGE}</p>
        </div>
      </QuickAddShell>
    );
  }

  // --- Saved ---------------------------------------------------------------

  if (status === "saved" && savedLabel) {
    return (
      <QuickAddShell>
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 className="mb-3 h-6 w-6 text-primary" aria-hidden="true" />
          <h1 className="text-base font-semibold">Saved ✓</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            It is in the Creative Vault. Analysis finishes in the background — you can close
            this.
          </p>
          <p className="mt-1 w-full truncate text-xs text-muted-foreground">{savedLabel}</p>
          <Button className="mt-6 h-12 w-full" onClick={saveAnother}>
            Save another
          </Button>
        </div>
      </QuickAddShell>
    );
  }

  // --- Capture form --------------------------------------------------------

  return (
    <QuickAddShell>
      <h1 className="text-lg font-semibold">Quick add</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste a link or add a photo to save it to the Creative Vault.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="quick-add-url">Paste a link</Label>
          {/* h-14 + text-base: a comfortable phone target, and 16px is the
              threshold below which iOS Safari zooms the page on focus. */}
          {/* type="text", not "url": a `url` input fails native constraint
              validation before submit runs, so a link pasted without a scheme
              would be blocked by a native tooltip instead of the capture
              service's plain-language message. inputMode still gets iOS to
              show the URL keyboard. */}
          <Input
            id="quick-add-url"
            type="text"
            inputMode="url"
            enterKeyHint="go"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://www.instagram.com/reel/…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={isCapturing || file !== null}
            className="h-14 text-base"
          />
        </div>

        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
          or
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
        </div>

        {/* The native picker is the whole feature on iOS: it offers Photo
            Library, Take Photo, and Choose File. No `capture` attribute — that
            would force the camera and remove the library option. */}
        <input
          ref={fileInputRef}
          id="quick-add-file"
          type="file"
          accept={CAPTURE_FILE_ACCEPT}
          className="sr-only"
          aria-label="Photo or video"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          className="h-14 w-full"
          disabled={isCapturing}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" />
          {file ? "Choose a different photo" : "Take or choose a photo"}
        </Button>

        {file && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
            <span className="flex-1 truncate text-sm">{file.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label="Remove photo"
              disabled={isCapturing}
              onClick={clearFile}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        {status === "error" && error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}

        <Button type="submit" className="h-14 w-full text-base" disabled={!pending || isCapturing}>
          {isCapturing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            "Save to Vault"
          )}
        </Button>
      </form>

      {showTip && (
        <div className="mt-8 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-3">
          <p className="flex-1 text-xs text-muted-foreground">{ADD_TO_HOME_SCREEN_TIP}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label="Dismiss tip"
            onClick={dismissTip}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </Button>
        </div>
      )}
    </QuickAddShell>
  );
}
