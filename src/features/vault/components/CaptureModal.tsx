import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Link as LinkIcon, Loader2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

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
 */
export function CaptureModal({ open, onOpenChange, onItemCreated }: Props) {
  const [tab, setTab] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [brandName, setBrandName] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const callFunction = async (name: string, body: Record<string, unknown>) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not authenticated");

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Request failed");
    return data;
  };

  const attachTagsAndNotes = async (itemId: string) => {
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    if (parsedTags.length === 0 && !notes.trim()) return;

    if (parsedTags.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("inspiration_tags")
        .upsert(parsedTags.map((tag) => ({ item_id: itemId, tag })), {
          onConflict: "item_id,tag",
        });
      if (error) console.error("Tag insert failed:", error);
    }

    if (notes.trim()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("inspiration_items")
        .update({ ad_body_text: notes.trim() })
        .eq("id", itemId);
    }
  };

  const reset = () => {
    setUrl("");
    setBrandName("");
    setTags("");
    setNotes("");
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    try {
      const result = await callFunction("vault-save", {
        url: url.trim(),
        brand_name: brandName.trim() || null,
      });
      await attachTagsAndNotes(result.item_id);
      onItemCreated(result.item_id);
      toast.success("Saved! Processing in the background…");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  const generateVideoThumbnail = (file: File): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      const objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;
      video.muted = true;
      video.preload = "metadata";

      const cleanup = () => URL.revokeObjectURL(objectUrl);
      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 10_000);

      video.addEventListener(
        "loadeddata",
        () => {
          video.currentTime = Math.min(1, video.duration * 0.1);
        },
        { once: true },
      );

      video.addEventListener(
        "seeked",
        () => {
          clearTimeout(timeout);
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 320;
          canvas.height = video.videoHeight || 568;
          canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => {
              cleanup();
              resolve(blob);
            },
            "image/jpeg",
            0.8,
          );
        },
        { once: true },
      );

      video.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          cleanup();
          resolve(null);
        },
        { once: true },
      );
    });
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/")) {
      toast.error("Only video and image files are supported");
      return;
    }

    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const ext = file.name.split(".").pop();
      const ts = Date.now();
      const path = `uploads/${session.user.id}/${ts}.${ext}`;

      const isVideo = file.type.startsWith("video/");
      const [uploadResult, thumbnailBlob] = await Promise.all([
        supabase.storage.from("inspiration-media").upload(path, file),
        isVideo ? generateVideoThumbnail(file) : Promise.resolve(null),
      ]);

      if (uploadResult.error) throw uploadResult.error;

      let thumbnailUrl: string | null = null;
      if (thumbnailBlob) {
        const thumbPath = `thumbnails/${session.user.id}/${ts}.jpg`;
        const { error: thumbErr } = await supabase.storage
          .from("inspiration-media")
          .upload(thumbPath, thumbnailBlob, { contentType: "image/jpeg" });
        if (!thumbErr) {
          const { data: signed } = await supabase.storage
            .from("inspiration-media")
            .createSignedUrl(thumbPath, 365 * 24 * 60 * 60);
          thumbnailUrl = signed?.signedUrl ?? null;
        }
      }

      const result = await callFunction("vault-save", {
        file_path: path,
        platform: "upload",
        mime_type: file.type,
        brand_name: brandName.trim() || null,
        thumbnail_url: thumbnailUrl,
      });
      await attachTagsAndNotes(result.item_id);

      onItemCreated(result.item_id);
      toast.success("Uploaded! Processing in the background…");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
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
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleFile(file);
                }}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                )}
              >
                {loading ? (
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                ) : (
                  <>
                    <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm font-medium">Drop a file or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-1">Video or image files</p>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/*,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
