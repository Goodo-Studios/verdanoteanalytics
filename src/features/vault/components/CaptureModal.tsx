import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Link as LinkIcon, Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  captureFileToVault,
  captureUrlToVault,
  isSupportedCaptureFile,
  type VaultCaptureMetadata,
} from "../hooks/useVaultCapture";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onItemCreated: (itemId: string) => void;
}

/** Modal for capturing a new inspiration item by URL or file upload.
 *
 * Diverges from the Creative Vault source in two ways:
 *   • No workspace_id — vault-save in Verdanote scopes items by user_id.
 *   • No "Meta Ads" tab — that flow ports separately (US-008).
 *
 * The actual capture work (session auth, role gate, vault-save call, storage
 * upload, thumbnail, tags/notes) lives in useVaultCapture — the same module the
 * mobile share-target and quick-add surfaces call, so all three stay in sync.
 */
export function CaptureModal({ open, onOpenChange, onItemCreated }: Props) {
  // The role gate is enforced inside the capture service; passing the already
  // resolved role just avoids a redundant get_user_role round-trip per save.
  const { role } = useAuth();
  const [tab, setTab] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [brandName, setBrandName] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileQueue, setFileQueue] = useState<Array<{
    name: string;
    status: "pending" | "uploading" | "done" | "error";
    error?: string;
  }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Brand / tags / notes typed into the form, in the shape the service wants. */
  const buildMetadata = (): VaultCaptureMetadata => ({
    brandName: brandName.trim() || null,
    tags: tags.split(","),
    notes,
  });

  const reset = () => {
    setUrl("");
    setBrandName("");
    setTags("");
    setNotes("");
    setFileQueue([]);
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    try {
      const { itemId } = await captureUrlToVault(url, buildMetadata(), { role });
      onItemCreated(itemId);
      toast.success("Saved! Processing in the background…");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  /** Upload a single file to storage and register it in the vault. */
  const uploadSingleFile = async (file: File) => {
    const { itemId } = await captureFileToVault(file, buildMetadata(), { role });
    onItemCreated(itemId);
  };

  /** Handle one or more files — validates, shows per-file progress, uploads sequentially. */
  const handleFiles = async (rawFiles: File[]) => {
    const files = rawFiles.filter(isSupportedCaptureFile);
    if (!files.length) {
      toast.error("Only video and image files are supported");
      return;
    }
    if (files.length < rawFiles.length) {
      toast.warning(
        `${rawFiles.length - files.length} file(s) skipped — only video and image files are supported`,
      );
    }

    setLoading(true);
    setFileQueue(files.map((f) => ({ name: f.name, status: "pending" })));

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      setFileQueue((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: "uploading" } : item)),
      );
      try {
        await uploadSingleFile(files[i]);
        successCount++;
        setFileQueue((prev) =>
          prev.map((item, idx) => (idx === i ? { ...item, status: "done" } : item)),
        );
      } catch (err) {
        errorCount++;
        const msg = err instanceof Error ? err.message : "Upload failed";
        setFileQueue((prev) =>
          prev.map((item, idx) => (idx === i ? { ...item, status: "error", error: msg } : item)),
        );
      }
    }

    setLoading(false);

    if (successCount > 0)
      toast.success(
        successCount === 1
          ? "Uploaded! Processing in the background…"
          : `${successCount} files uploaded! Processing in the background…`,
      );
    if (errorCount > 0)
      toast.error(
        errorCount === 1 ? "1 file failed to upload" : `${errorCount} files failed to upload`,
      );

    reset();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40 animate-in fade-in" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-background rounded-xl shadow-2xl p-6 animate-in zoom-in-95",
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">Add Inspiration</Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-muted transition-colors" aria-label="Close">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as "url" | "upload")}>
            <Tabs.List className="flex border-b border-border mb-4">
              <Tabs.Trigger
                value="url"
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                  tab === "url"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <LinkIcon className="w-3.5 h-3.5" /> Paste URL
              </Tabs.Trigger>
              <Tabs.Trigger
                value="upload"
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                  tab === "upload"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Upload className="w-3.5 h-3.5" /> Upload File
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="url">
              <form onSubmit={handleUrlSubmit} className="space-y-3">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.tiktok.com/@creator/video/..."
                  className="w-full border border-input rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={loading}
                  autoFocus
                />
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="Brand name (optional — AI will detect if left blank)"
                  className="w-full border border-input rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={loading}
                />
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Tags (comma separated, optional)"
                  className="w-full border border-input rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={loading}
                />
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  rows={2}
                  className="w-full border border-input rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  Supports TikTok, Instagram Reels, YouTube Shorts, and Twitter/X. If extraction fails,
                  download the video and use the Upload tab.
                </p>
                <button
                  type="submit"
                  disabled={loading || !url.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save & Analyze
                </button>
              </form>
            </Tabs.Content>

            <Tabs.Content value="upload">
              {fileQueue.length > 0 ? (
                <div className="space-y-2 py-1">
                  <p className="text-xs text-muted-foreground mb-3">
                    {loading
                      ? `Uploading ${fileQueue.filter((q) => q.status === "done").length + 1} of ${fileQueue.length}…`
                      : "Upload complete"}
                  </p>
                  {fileQueue.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {item.status === "pending" && (
                        <div className="w-4 h-4 rounded-full border-2 border-border flex-shrink-0" />
                      )}
                      {item.status === "uploading" && (
                        <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                      )}
                      {item.status === "done" && (
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                      )}
                      {item.status === "error" && (
                        <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                      )}
                      <span
                        className={cn(
                          "truncate flex-1 text-sm",
                          item.status === "error" && "text-destructive",
                          item.status === "done" && "text-muted-foreground",
                        )}
                        title={item.error ?? item.name}
                      >
                        {item.name}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length) handleFiles(files);
                  }}
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                    dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                  )}
                >
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Drop files or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Video or image files · select multiple
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="video/*,image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length) handleFiles(files);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
