// A list of photos or videos on a creator, actor or location page, with upload, delete and
// (for location photos) "set as main photo" (phase 6b). Thumbnails come from signed links
// the page already loaded; after any change the page reloads through onChanged. The upload
// panel is loaded only when "Add" is pressed.
import { Suspense, lazy, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmTrigger } from "@/components/page-kit";
import { deleteMediaItem, removeHeadshot, setMainLocationPhoto } from "./mediaApi";
import { mediaErrorText, type MediaKindConfig } from "./mediaModel";

const MediaUploader = lazy(() => import("./MediaUploader"));

export interface MediaTile {
  id: string;
  storage_path: string;
  thumbnail_path?: string | null;
  label: string;
  sort_order?: number;
  /** Shown beside the label in brackets, for example the video format. */
  extra?: string;
}

interface SectionProps {
  cfg: MediaKindConfig;
  ownerId: string;
  /** The section heading and its accessible name, for example "Videos". */
  title: string;
  items: MediaTile[];
  /** storage path -> signed link. */
  links: Map<string, string>;
  onChanged: () => void | Promise<void>;
  /** Offer "Set as main photo" (location photos). The first item is the main one. */
  allowSetMain?: boolean;
  /** Called with the plain message after a change, for the page's status line. */
  onNotice?: (message: string) => void;
}

const LINK = "h-auto p-0 text-xs";

export function MediaSection({ cfg, ownerId, title, items, links, onChanged, allowSetMain, onNotice }: SectionProps) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = cfg.type === "video";

  const run = async (id: string, fn: () => Promise<void>, done: string) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      onNotice?.(done);
      await onChanged();
    } catch (e) {
      setError(mediaErrorText(e, cfg));
    }
    setBusy(null);
  };

  const sorted = allowSetMain ? [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : items;

  return (
    <section aria-label={title} className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{title} ({items.length})</h2>
        <Button type="button" variant="outline" size="sm" className="ml-auto" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
          {adding ? "Hide uploader" : `Add ${cfg.plural}`}
        </Button>
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
      {adding && (
        <Suspense fallback={<p className="mt-2 text-xs text-muted-foreground">Loading the uploader...</p>}>
          <MediaUploader cfg={cfg} ownerId={ownerId} existingCount={items.length} onUploaded={() => void onChanged()} onClose={() => setAdding(false)} />
        </Suspense>
      )}
      {items.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">None yet.</p> : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {sorted.map((m, i) => {
            const url = links.get(m.storage_path);
            const thumb = video ? (m.thumbnail_path ? links.get(m.thumbnail_path) : undefined) : url;
            const extra = m.extra;
            const isMain = allowSetMain && i === 0;
            return (
              <li key={m.id} className="w-32 text-xs" data-testid="media-tile">
                {video ? (
                  thumb ? <img src={thumb} alt={m.label} className="h-24 w-32 rounded object-cover" />
                    : url ? <video src={url} preload="metadata" muted className="h-24 w-32 rounded bg-muted object-cover" aria-label={m.label} />
                    : <div className="h-24 w-32 rounded bg-muted" />
                ) : url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={m.label} className="h-24 w-32 rounded object-cover" /></a>
                ) : (
                  <div className="flex h-24 w-32 items-center justify-center rounded bg-muted text-muted-foreground">File not in storage</div>
                )}
                <div className="truncate">{m.label}{extra ? ` (${extra})` : ""}</div>
                {isMain && <div className="font-medium">Main photo</div>}
                <div className="flex flex-wrap items-center gap-x-2">
                  {video && (url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline">Play</a> : <span className="text-muted-foreground">File not in storage</span>)}
                  {allowSetMain && !isMain && (
                    <Button type="button" variant="link" size="sm" className={LINK} disabled={busy !== null}
                      aria-label={`Set ${m.label} as the main photo`}
                      onClick={() => void run(m.id, () => setMainLocationPhoto(items.map((x) => ({ id: x.id, sort_order: x.sort_order ?? 0 })), m.id), "Main photo changed.")}>
                      Set as main photo
                    </Button>
                  )}
                  <ConfirmTrigger
                    title={`Delete ${m.label}?`}
                    description={`The ${cfg.noun} is removed from ${cfg.type === "image" ? "the page" : "the list"} and its file is deleted from storage. This cannot be undone.`}
                    actionLabel="Delete"
                    onConfirm={() => void run(m.id, () => deleteMediaItem(cfg, m), `Deleted ${m.label}.`)}
                  >
                    <Button type="button" variant="link" size="sm" className={`${LINK} text-destructive`} disabled={busy !== null} aria-label={`Delete ${m.label}`}>
                      {busy === m.id ? "Deleting..." : "Delete"}
                    </Button>
                  </ConfirmTrigger>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface HeadshotProps {
  cfg: MediaKindConfig;
  ownerId: string;
  /** The headshot's current storage path, if any. */
  path: string | null;
  onChanged: () => void | Promise<void>;
  onNotice?: (message: string) => void;
}

/** Change or remove the main headshot of a creator or actor. */
export function HeadshotControl({ cfg, ownerId, path, onChanged, onNotice }: HeadshotProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      await removeHeadshot(cfg, ownerId, path);
      onNotice?.("Headshot removed.");
      await onChanged();
    } catch (e) {
      setError(mediaErrorText(e, cfg));
    }
    setBusy(false);
  };

  return (
    <div className="mt-1 text-xs">
      <div className="flex flex-wrap items-center gap-x-2">
        <Button type="button" variant="link" size="sm" className={LINK} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {path ? "Change main photo" : "Add main photo"}
        </Button>
        {path && (
          <ConfirmTrigger title="Remove the main photo?" description="The headshot file is deleted from storage and the profile shows no headshot. This cannot be undone." actionLabel="Remove" onConfirm={() => void remove()}>
            <Button type="button" variant="link" size="sm" className={`${LINK} text-destructive`} disabled={busy}>{busy ? "Removing..." : "Remove"}</Button>
          </ConfirmTrigger>
        )}
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {open && (
        <Suspense fallback={<p className="text-muted-foreground">Loading the uploader...</p>}>
          <MediaUploader cfg={cfg} ownerId={ownerId} existingCount={0} currentHeadshot={path} onUploaded={() => { setOpen(false); void onChanged(); }} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
