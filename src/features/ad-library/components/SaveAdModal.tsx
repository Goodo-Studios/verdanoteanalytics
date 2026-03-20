import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Link,
  PenLine,
  Upload,
  Clipboard,
  Loader2,
  Image as ImageIcon,
  Search,
  Plus,
  X,
  Check,
  LayoutGrid,
  Tag,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAdLibraryBoards,
  useAdLibraryTags,
  useCreateBoard,
  useCreateTag,
} from "@/features/ad-library/hooks/useAdLibrary";
import { useQueryClient } from "@tanstack/react-query";
import type { ScrapeAdResponse, AdLibraryBoard, AdLibraryTag } from "@/features/ad-library/types/ad-library";

interface SaveAdModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultBoardId?: string;
}

interface StoredMediaLocal {
  stored_url: string;
  type: "image" | "video" | "carousel_frame";
  mime_type: string;
  file_size_bytes: number;
  position: number;
  original_url: string;
}

interface FormState {
  source_url: string;
  advertiser_name: string;
  advertiser_page_id: string;
  ad_id: string;
  headline: string;
  body_text: string;
  cta_text: string;
  thumbnail_url: string;
  landing_page_url: string;
  ad_format: string;
  platform: string;
  started_running: string;
  notes: string;
  media_urls: string[];
  country_targeting: string[];
  raw_data: Record<string, unknown> | null;
  stored_media: StoredMediaLocal[];
}

const INITIAL_FORM: FormState = {
  source_url: "",
  advertiser_name: "",
  advertiser_page_id: "",
  ad_id: "",
  headline: "",
  body_text: "",
  cta_text: "",
  thumbnail_url: "",
  landing_page_url: "",
  ad_format: "image",
  platform: "facebook",
  started_running: "",
  notes: "",
  media_urls: [],
  country_targeting: [],
  raw_data: null,
  stored_media: [],
};

export function SaveAdModal({ isOpen, onClose, defaultBoardId }: SaveAdModalProps) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"url" | "manual">("url");
  const [form, setForm] = useState<FormState>({ ...INITIAL_FORM });
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Organization
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(defaultBoardId || null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagNames, setNewTagNames] = useState<string[]>([]);
  const [boardSearch, setBoardSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [newBoardName, setNewBoardName] = useState("");
  const [boardPopoverOpen, setBoardPopoverOpen] = useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: boards = [] } = useAdLibraryBoards();
  const { data: allTags = [] } = useAdLibraryTags();
  const createBoard = useCreateBoard();
  const createTag = useCreateTag();

  const set = (key: keyof FormState, val: any) =>
    setForm((p) => ({ ...p, [key]: val }));

  const reset = () => {
    setForm({ ...INITIAL_FORM });
    setFetchError(null);
    setSelectedBoardId(defaultBoardId || null);
    setSelectedTagIds([]);
    setNewTagNames([]);
    setTab("url");
  };

  // ---- Fetch Ad from URL ----
  const handleFetch = async () => {
    const url = form.source_url.trim();
    if (!url) return;

    if (!url.includes("facebook.com/ads/library")) {
      toast.error("Please paste a Facebook Ads Library URL");
      return;
    }

    setIsFetching(true);
    setFetchError(null);

    try {
      const { data, error } = await supabase.functions.invoke("scrape-ad", {
        body: { url },
      });

      if (error) throw new Error(error.message);

      const result = data as ScrapeAdResponse;

      if (result.success && result.data) {
        setForm((prev) => ({
          ...prev,
          advertiser_name: result.data!.advertiser_name || prev.advertiser_name,
          advertiser_page_id: result.data!.advertiser_page_id || "",
          ad_id: result.data!.ad_id || "",
          headline: result.data!.headline || "",
          body_text: result.data!.body_text || "",
          cta_text: result.data!.cta_text || "",
          thumbnail_url: result.data!.thumbnail_url || "",
          landing_page_url: result.data!.landing_page_url || "",
          ad_format: result.data!.ad_format || "image",
          platform: result.data!.platform || "facebook",
          started_running: result.data!.started_running || "",
          media_urls: result.data!.media_urls || [],
          country_targeting: result.data!.country_targeting || [],
          raw_data: data.data || null,
          stored_media: (data.data as any)?.stored_media || [],
        }));
        toast.success("Ad data fetched — review and save");
      } else {
        setFetchError(
          result.error ||
            "Could not fetch ad data. You can screenshot the ad and use the Manual Entry tab."
        );
      }
    } catch (e: any) {
      setFetchError(
        "Facebook blocked this request. You can screenshot the ad and enter it manually — takes just a few seconds."
      );
    } finally {
      setIsFetching(false);
    }
  };

  // ---- File Upload ----
  const uploadFile = async (file: File) => {
    if (!user) return;
    setIsUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const isVid = file.type.startsWith("video/");
      const position = form.stored_media.length;
      const tempId = Date.now().toString(36);
      const mediaType: "image" | "video" | "carousel_frame" = isVid
        ? "video"
        : form.stored_media.filter(m => m.type === "image" || m.type === "carousel_frame").length > 0
          ? "carousel_frame"
          : "image";

      const path = `${user.id}/${tempId}/${position}_${mediaType}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("ad-media")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("ad-media").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      const newItem: StoredMediaLocal = {
        stored_url: publicUrl,
        type: mediaType,
        mime_type: file.type,
        file_size_bytes: file.size,
        position,
        original_url: "",
      };

      setForm(prev => {
        const newMedia = [...prev.stored_media, newItem];
        // Auto-upgrade format if multiple images
        const imageCount = newMedia.filter(m => m.type !== "video").length;
        const hasVideo = newMedia.some(m => m.type === "video");
        // Re-label earlier "image" entries as "carousel_frame" if now > 1
        if (imageCount > 1) {
          newMedia.forEach(m => { if (m.type === "image") m.type = "carousel_frame"; });
        }
        const autoFormat = hasVideo ? "video" : imageCount > 1 ? "carousel" : "image";

        return {
          ...prev,
          stored_media: newMedia,
          thumbnail_url: prev.thumbnail_url || publicUrl,
          ad_format: autoFormat,
        };
      });
      toast.success(`${isVid ? "Video" : "Image"} uploaded`);
    } catch (e: any) {
      toast.error("Upload failed: " + e.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
          uploadFile(file);
        }
      }
    },
    [user, form.stored_media.length]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) uploadFile(file);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], `clipboard-${Date.now()}.png`, { type: imageType });
          await uploadFile(file);
          return;
        }
      }
      toast.error("No image found in clipboard");
    } catch {
      toast.error("Could not read clipboard — try drag and drop instead");
    }
  };

  // ---- Create Board Inline ----
  const handleCreateBoard = () => {
    if (!newBoardName.trim()) return;
    createBoard.mutate(
      { name: newBoardName.trim() },
      {
        onSuccess: (board) => {
          setSelectedBoardId(board.id);
          setNewBoardName("");
          setBoardPopoverOpen(false);
        },
      }
    );
  };

  // ---- Tag Toggle ----
  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const addNewTagName = () => {
    const name = tagSearch.trim();
    if (!name) return;
    if (allTags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      const existing = allTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (existing && !selectedTagIds.includes(existing.id)) {
        setSelectedTagIds((p) => [...p, existing.id]);
      }
    } else if (!newTagNames.includes(name)) {
      setNewTagNames((p) => [...p, name]);
    }
    setTagSearch("");
  };

  // ---- Save Flow ----
  const handleSave = async () => {
    if (tab === "url" && !form.source_url.trim()) {
      toast.error("Source URL is required");
      return;
    }
    if (tab === "manual" && !form.advertiser_name.trim() && !form.thumbnail_url) {
      toast.error("Please add at least an advertiser name or a screenshot");
      return;
    }

    if (!user) return;
    setIsSaving(true);

    try {
      // 1. Insert saved ad
      const { data: savedAd, error: adError } = await supabase
        .from("ad_library_saved_ads" as any)
        .insert({
          user_id: user.id,
          source_url: form.source_url || `manual-${Date.now()}`,
          advertiser_name: form.advertiser_name || null,
          advertiser_page_id: form.advertiser_page_id || null,
          ad_id: form.ad_id || null,
          platform: form.platform,
          ad_format: form.ad_format || null,
          headline: form.headline || null,
          body_text: form.body_text || null,
          cta_text: form.cta_text || null,
          landing_page_url: form.landing_page_url || null,
          thumbnail_url: form.thumbnail_url || null,
          started_running: form.started_running || null,
          media_urls: form.media_urls,
          country_targeting: form.country_targeting,
          raw_data: form.raw_data,
          notes: form.notes || null,
          stored_media: form.stored_media,
        } as any)
        .select()
        .single();

      if (adError) throw adError;
      const adId = (savedAd as any).id;

      // 2. Add to board if selected
      if (selectedBoardId) {
        await supabase
          .from("ad_library_board_ads" as any)
          .insert({ board_id: selectedBoardId, ad_id: adId } as any);
      }

      // 3. Create new tags and link all tags
      const tagIdsToLink = [...selectedTagIds];

      for (const name of newTagNames) {
        const { data: newTag } = await supabase
          .from("ad_library_tags" as any)
          .insert({ user_id: user.id, name, color: "#8b5cf6" } as any)
          .select()
          .single();
        if (newTag) tagIdsToLink.push((newTag as any).id);
      }

      if (tagIdsToLink.length > 0) {
        await supabase
          .from("ad_library_ad_tags" as any)
          .insert(tagIdsToLink.map((tag_id) => ({ ad_id: adId, tag_id })) as any);
      }

      // 4. Auto-trigger transcription for video ads
      if (form.ad_format === "video" && form.media_urls.length > 0) {
        const videoUrl = form.media_urls.find((u) => u.match(/\.(mp4|webm|mov)/i)) || form.media_urls[0];
        if (videoUrl) {
          supabase.functions.invoke("transcribe-ad", {
            body: { ad_id: adId, video_url: videoUrl },
          }).catch((e) => console.error("Auto-transcription failed:", e));
        }
      }

      // 5. Done
      qc.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
      qc.invalidateQueries({ queryKey: ["ad-library-ads-infinite"] });
      qc.invalidateQueries({ queryKey: ["ad-library-boards"] });
      qc.invalidateQueries({ queryKey: ["ad-library-tags"] });
      toast.success("Ad saved to library");
      reset();
      onClose();
    } catch (e: any) {
      toast.error("Failed to save: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  // ---- Computed ----
  const filteredBoards = boards.filter((b) =>
    b.name.toLowerCase().includes(boardSearch.toLowerCase())
  );
  const filteredTags = allTags.filter((t) =>
    t.name.toLowerCase().includes(tagSearch.toLowerCase())
  );
  const selectedBoard = boards.find((b) => b.id === selectedBoardId);
  const selectedTags = allTags.filter((t) => selectedTagIds.includes(t.id));

  // ---- Shared form fields ----
  const renderFormFields = () => (
    <div className="grid gap-3">
      {/* Thumbnail preview */}
      {form.thumbnail_url && (
        <div className="relative rounded-lg overflow-hidden bg-muted aspect-video max-h-48">
          <img
            src={form.thumbnail_url}
            alt="Preview"
            className="h-full w-full object-contain"
          />
          <button
            onClick={() => set("thumbnail_url", "")}
            className="absolute top-2 right-2 h-6 w-6 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center hover:bg-card transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Advertiser Name</Label>
          <Input
            value={form.advertiser_name}
            onChange={(e) => set("advertiser_name", e.target.value)}
            placeholder="e.g. Nike"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Platform</Label>
          <Select value={form.platform} onValueChange={(v) => set("platform", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="facebook">Facebook</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
              <SelectItem value="youtube">YouTube</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Ad Format</Label>
          <Select value={form.ad_format} onValueChange={(v) => set("ad_format", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="image">Image</SelectItem>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="carousel">Carousel</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Started Running</Label>
          <Input
            type="date"
            value={form.started_running}
            onChange={(e) => set("started_running", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Headline</Label>
        <Input
          value={form.headline}
          onChange={(e) => set("headline", e.target.value)}
          placeholder="Primary text or headline"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Body Text</Label>
        <Textarea
          value={form.body_text}
          onChange={(e) => set("body_text", e.target.value)}
          rows={2}
          placeholder="Ad copy"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">CTA Text</Label>
          <Input
            value={form.cta_text}
            onChange={(e) => set("cta_text", e.target.value)}
            placeholder="Shop Now"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Landing Page URL</Label>
          <Input
            value={form.landing_page_url}
            onChange={(e) => set("landing_page_url", e.target.value)}
            placeholder="https://..."
          />
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg text-foreground">
            Save Ad to Library
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "url" | "manual")} className="w-full">
          <TabsList className="w-full grid grid-cols-2 mb-4">
            <TabsTrigger value="url" className="gap-1.5">
              <Link className="h-3.5 w-3.5" /> Paste URL
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-1.5">
              <PenLine className="h-3.5 w-3.5" /> Enter Manually
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Paste URL */}
          <TabsContent value="url" className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={form.source_url}
                onChange={(e) => set("source_url", e.target.value)}
                placeholder="Paste a Facebook Ads Library URL..."
                className="flex-1 h-10 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleFetch()}
              />
              <Button
                onClick={handleFetch}
                disabled={isFetching || !form.source_url.trim()}
                className="gap-1.5 h-10"
              >
                {isFetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Fetch Ad
              </Button>
            </div>

            {/* Loading skeleton */}
            {isFetching && (
              <div className="space-y-3 animate-pulse">
                <div className="aspect-video bg-muted rounded-lg" />
                <div className="h-4 bg-muted rounded w-1/2" />
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-9 bg-muted rounded" />
                  <div className="h-9 bg-muted rounded" />
                </div>
              </div>
            )}

            {/* Fetch error */}
            {fetchError && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                <p className="text-sm text-destructive">{fetchError}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs"
                  onClick={() => { setTab("manual"); setFetchError(null); }}
                >
                  Switch to Manual Entry →
                </Button>
              </div>
            )}

            {/* Fetched data — show editable fields */}
            {!isFetching && !fetchError && form.advertiser_name && renderFormFields()}
          </TabsContent>

          {/* Tab 2: Enter Manually */}
          <TabsContent value="manual" className="space-y-4">
            {/* Uploaded media previews */}
            {form.stored_media.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Uploaded Media ({form.stored_media.length})</Label>
                <div className="flex gap-2 flex-wrap">
                  {form.stored_media.map((m, i) => (
                    <div key={i} className="relative rounded-md overflow-hidden border border-border w-20 h-20">
                      {m.type === "video" ? (
                        <div className="h-full w-full bg-muted flex items-center justify-center">
                          <Video className="h-6 w-6 text-muted-foreground" />
                        </div>
                      ) : (
                        <img src={m.stored_url} alt="" className="h-full w-full object-cover" />
                      )}
                      <button
                        onClick={() => {
                          setForm(prev => ({
                            ...prev,
                            stored_media: prev.stored_media.filter((_, idx) => idx !== i),
                            thumbnail_url: i === 0 ? (prev.stored_media[1]?.stored_url || "") : prev.thumbnail_url,
                          }));
                        }}
                        className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-card/80 flex items-center justify-center hover:bg-card"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                      <div className="absolute bottom-0.5 left-0.5 text-[8px] font-label bg-foreground/60 text-background px-1 rounded">
                        {m.type === "video" ? "VID" : m.type === "carousel_frame" ? `#${i + 1}` : "IMG"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload zone — always show for adding more */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer",
                "hover:border-primary/40 hover:bg-primary/5 transition-colors",
                isUploading && "opacity-50 pointer-events-none"
              )}
            >
              {isUploading ? (
                <Loader2 className="h-8 w-8 text-muted-foreground mx-auto animate-spin" />
              ) : (
                <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              )}
              <p className="text-sm text-muted-foreground font-body">
                {isUploading
                  ? "Uploading..."
                  : form.stored_media.length > 0
                    ? "Add another image or video"
                    : "Drag & drop files, or click to browse"}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Images (PNG, JPG) or videos (MP4, WebM) — up to 100MB. Add multiple images for carousel.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            {form.stored_media.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs w-full"
                onClick={handlePasteFromClipboard}
              >
                <Clipboard className="h-3.5 w-3.5" />
                Paste from Clipboard
              </Button>
            )}

            {/* Source URL (optional) */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Source URL <span className="text-muted-foreground/50">(optional)</span>
              </Label>
              <Input
                value={form.source_url}
                onChange={(e) => set("source_url", e.target.value)}
                placeholder="https://www.facebook.com/ads/library/..."
              />
            </div>

            {renderFormFields()}
          </TabsContent>
        </Tabs>

        {/* ---- Organization Section ---- */}
        <div className="border-t border-border pt-4 mt-2 space-y-3">
          <p className="font-label text-[11px] text-muted-foreground uppercase tracking-wider">
            Organize
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Board picker */}
            <Popover open={boardPopoverOpen} onOpenChange={setBoardPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-sm h-8">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  {selectedBoard ? selectedBoard.name : "Add to Board"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <Input
                  value={boardSearch}
                  onChange={(e) => setBoardSearch(e.target.value)}
                  placeholder="Search boards..."
                  className="h-8 text-sm mb-2"
                />
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {filteredBoards.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        setSelectedBoardId(b.id === selectedBoardId ? null : b.id);
                        setBoardPopoverOpen(false);
                      }}
                      className={cn(
                        "w-full text-left text-sm px-2 py-1.5 rounded-md transition-colors flex items-center gap-2",
                        b.id === selectedBoardId
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-accent"
                      )}
                    >
                      <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate">{b.name}</span>
                      {b.id === selectedBoardId && (
                        <Check className="h-3.5 w-3.5 ml-auto" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t border-border mt-2 pt-2">
                  <div className="flex gap-1.5">
                    <Input
                      value={newBoardName}
                      onChange={(e) => setNewBoardName(e.target.value)}
                      placeholder="New board name"
                      className="h-7 text-xs flex-1"
                      onKeyDown={(e) => e.key === "Enter" && handleCreateBoard()}
                    />
                    <Button
                      size="sm"
                      className="h-7 px-2"
                      onClick={handleCreateBoard}
                      disabled={!newBoardName.trim() || createBoard.isPending}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Tag picker */}
            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-sm h-8">
                  <Tag className="h-3.5 w-3.5" />
                  Add Tags
                  {(selectedTagIds.length + newTagNames.length) > 0 && (
                    <Badge variant="default" className="h-4 min-w-4 px-1 text-[10px] rounded-full">
                      {selectedTagIds.length + newTagNames.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="start">
                <div className="flex gap-1.5 mb-2">
                  <Input
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="Search or create tag..."
                    className="h-7 text-xs flex-1"
                    onKeyDown={(e) => e.key === "Enter" && addNewTagName()}
                  />
                </div>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {filteredTags.map((tag) => {
                    const active = selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={cn(
                          "w-full text-left text-sm px-2 py-1.5 rounded-md transition-colors flex items-center gap-2",
                          active ? "bg-primary/10 text-primary" : "hover:bg-accent"
                        )}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="truncate">{tag.name}</span>
                        {active && <Check className="h-3.5 w-3.5 ml-auto" />}
                      </button>
                    );
                  })}
                </div>
                {tagSearch.trim() &&
                  !allTags.some((t) => t.name.toLowerCase() === tagSearch.trim().toLowerCase()) && (
                    <button
                      onClick={addNewTagName}
                      className="w-full text-left text-xs text-primary px-2 py-1.5 rounded-md hover:bg-primary/5 flex items-center gap-1.5 border-t border-border mt-1 pt-1"
                    >
                      <Plus className="h-3 w-3" />
                      Create "{tagSearch.trim()}"
                    </button>
                  )}
              </PopoverContent>
            </Popover>
          </div>

          {/* Show selected tags */}
          {(selectedTags.length > 0 || newTagNames.length > 0) && (
            <div className="flex flex-wrap gap-1">
              {selectedTags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className="text-xs gap-1 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-secondary/60"
                  onClick={() => toggleTag(tag.id)}
                >
                  {tag.name}
                  <X className="h-3 w-3" />
                </Badge>
              ))}
              {newTagNames.map((name) => (
                <Badge
                  key={name}
                  variant="outline"
                  className="text-xs gap-1 pl-2 pr-1 py-0.5 cursor-pointer border-primary/30 text-primary hover:bg-primary/5"
                  onClick={() => setNewTagNames((p) => p.filter((n) => n !== name))}
                >
                  {name} (new)
                  <X className="h-3 w-3" />
                </Badge>
              ))}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              placeholder="Why you're saving this ad..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="gap-1.5"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
            {isSaving ? "Saving..." : "Save Ad"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
