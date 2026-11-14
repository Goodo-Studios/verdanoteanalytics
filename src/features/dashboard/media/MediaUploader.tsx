// The upload panel for one list of media (phase 6b). Pick several files or drop them here;
// each is checked (type, size, how many fit), then sent straight to storage with a progress
// bar. A file that fails says why and can be tried again. Loaded on demand from MediaSection.
import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  acceptFor,
  formatBytes,
  limitsText,
  mediaErrorText,
  summarizeQueue,
  validateBatch,
  type Accepted,
  type MediaKindConfig,
  type QueueItem,
  type Rejected,
} from "./mediaModel";
import { uploadMediaFile, type UploadSteps } from "./mediaUpload";

const POOL = 2;

interface Props {
  cfg: MediaKindConfig;
  ownerId: string;
  /** How many the owner already has, for the limit. */
  existingCount: number;
  /** A headshot's current path, replaced by the new one. */
  currentHeadshot?: string | null;
  /** Called once a run of uploads has finished with at least one file saved. */
  onUploaded: () => void;
  onClose: () => void;
  /** Test seam: replaces the network steps. */
  steps?: UploadSteps;
}

let counter = 0;

export default function MediaUploader({ cfg, ownerId, existingCount, currentHeadshot, onUploaded, onClose, steps }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [category, setCategory] = useState<"family" | "pet">("family");
  const [dragging, setDragging] = useState(false);
  const files = useRef(new Map<string, Accepted>());
  const input = useRef<HTMLInputElement>(null);
  const savedInRun = useRef(0);
  const running = useRef(0);
  const headshot = cfg.maxCount === 1;

  const patch = (id: string, change: Partial<QueueItem>) => setQueue((q) => q.map((i) => (i.id === id ? { ...i, ...change } : i)));

  const runOne = async (id: string) => {
    const entry = files.current.get(id);
    if (!entry) return;
    patch(id, { status: "uploading", progress: 0, error: undefined });
    try {
      await uploadMediaFile(
        {
          cfg, ownerId, file: entry.file, mime: entry.mime, category, currentHeadshot,
          onProgress: (p) => patch(id, { progress: p }),
          onSaving: () => patch(id, { status: "saving", progress: 100 }),
        },
        steps,
      );
      savedInRun.current += 1;
      patch(id, { status: "done", progress: 100 });
    } catch (e) {
      patch(id, { status: "failed", error: mediaErrorText(e, cfg) });
    }
  };

  /** Runs the given items, POOL at a time, then tells the page to reload if anything was saved. */
  const runAll = async (ids: string[]) => {
    running.current += ids.length;
    const todo = [...ids];
    await Promise.all(
      Array.from({ length: Math.min(POOL, todo.length) }, async () => {
        for (let id = todo.shift(); id; id = todo.shift()) {
          await runOne(id);
          running.current -= 1;
        }
      }),
    );
    if (running.current === 0 && savedInRun.current > 0) {
      savedInRun.current = 0;
      onUploaded();
    }
  };

  const take = (picked: File[]) => {
    if (!picked.length) return;
    const inFlight = queue.filter((i) => i.status === "queued" || i.status === "uploading" || i.status === "saving").length;
    const batch = headshot ? picked.slice(0, 1) : picked;
    const { accepted, rejected: refused } = validateBatch(cfg, batch, headshot ? 0 : existingCount + inFlight);
    setRejected(refused);
    if (!accepted.length) return;
    const items: QueueItem[] = accepted.map((a) => {
      const id = `up-${++counter}`;
      files.current.set(id, a);
      return { id, name: a.file.name, size: a.file.size, status: "queued", progress: 0 };
    });
    setQueue((q) => [...q, ...items]);
    void runAll(items.map((i) => i.id));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    take(Array.from(e.dataTransfer.files));
  };

  const retry = (id: string) => void runAll([id]);
  const finished = queue.length > 0 && queue.every((i) => i.status === "done" || i.status === "failed");

  return (
    <section aria-label={`Add ${cfg.plural}`} className="mt-2 space-y-2 rounded-md border border-dashed p-3 text-sm">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-wrap items-center gap-3 rounded-md p-3 ${dragging ? "bg-muted" : ""}`}
      >
        <input
          ref={input}
          type="file"
          className="sr-only"
          aria-label={`Choose ${cfg.plural} to upload`}
          accept={acceptFor(cfg)}
          multiple={!headshot}
          onChange={(e) => {
            take(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          {headshot ? "Choose a photo" : `Choose ${cfg.plural}`}
        </Button>
        <span className="text-xs text-muted-foreground">or drop {headshot ? "one here" : "them here"}. {limitsText(cfg)}</span>
        {cfg.kind === "creator-photo" && (
          <label className="text-xs">
            These are{" "}
            <select className="rounded border bg-background px-1 py-0.5" value={category} onChange={(e) => setCategory(e.target.value as "family" | "pet")}>
              <option value="family">family photos</option>
              <option value="pet">pet photos</option>
            </select>
          </label>
        )}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onClose}>{finished ? "Done" : "Close"}</Button>
      </div>

      {rejected.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-xs text-destructive">
          {rejected.map((r, i) => <li key={`${r.name}-${i}`}>{r.reason}</li>)}
        </ul>
      )}

      {queue.length > 0 && (
        <div>
          <p role="status" className="text-xs text-muted-foreground">{summarizeQueue(queue)}</p>
          <ul className="mt-1 space-y-1.5">
            {queue.map((i) => (
              <li key={i.id} className="text-xs" data-status={i.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="max-w-[16rem] truncate font-medium">{i.name}</span>
                  <span className="text-muted-foreground">{formatBytes(i.size)}</span>
                  <span>
                    {i.status === "queued" && "Waiting"}
                    {i.status === "uploading" && `Uploading ${i.progress}%`}
                    {i.status === "saving" && "Saving"}
                    {i.status === "done" && "Uploaded"}
                    {i.status === "failed" && "Failed"}
                  </span>
                  {i.status === "failed" && <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => retry(i.id)}>Try again</Button>}
                </div>
                {(i.status === "uploading" || i.status === "saving") && (
                  <div role="progressbar" aria-label={`Upload progress for ${i.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={i.progress} className="mt-0.5 h-1.5 w-full max-w-xs overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${i.progress}%` }} />
                  </div>
                )}
                {i.error && <p role="alert" className="text-destructive">{i.error}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
