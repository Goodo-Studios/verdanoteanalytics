import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, XCircle, Copy, ImageIcon } from "lucide-react";

interface AdPayload {
  advertiser_name: string;
  source_url: string;
  platform: string;
  ad_format: string;
  headline: string;
  body_text: string;
  cta_text: string;
  landing_page_url: string;
  started_running: string;
  library_id: string;
  thumbnail_url: string;
  video_url: string;
  media_urls: string[];
}

interface SaveResult {
  id: string;
  advertiser_name: string;
  status: "saving" | "saved" | "duplicate" | "error";
  error?: string;
}

export default function BookmarkletReceiver() {
  const [results, setResults] = useState<SaveResult[]>([]);
  const [isListening, setIsListening] = useState(true);

  const updateResult = useCallback(
    (id: string, status: SaveResult["status"], error?: string) => {
      setResults((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status, error } : r))
      );
    },
    []
  );

  useEffect(() => {
    async function processAd(ad: AdPayload, resultId: string) {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          updateResult(resultId, "error", "Not signed in to Verdanote.");
          return;
        }

        // Duplicate check
        if (ad.source_url) {
          const { data: existing } = await supabase
            .from("ad_library_saved_ads")
            .select("id")
            .eq("user_id", user.id)
            .eq("source_url", ad.source_url)
            .maybeSingle();
          if (existing) {
            updateResult(resultId, "duplicate");
            return;
          }
        }

        // Try to download & store media
        const storedMedia: any[] = [];

        // Thumbnail / main image
        if (ad.thumbnail_url) {
          try {
            const resp = await fetch(ad.thumbnail_url);
            if (resp.ok) {
              const blob = await resp.blob();
              if (blob.size > 1000) {
                const ext = blob.type.includes("png") ? "png" : "jpg";
                const path = `${user.id}/${ad.library_id || Date.now()}/thumbnail.${ext}`;
                const { error: upErr } = await supabase.storage
                  .from("ad-media")
                  .upload(path, blob, {
                    contentType: blob.type,
                    upsert: true,
                  });
                if (!upErr) {
                  const { data: urlData } = supabase.storage
                    .from("ad-media")
                    .getPublicUrl(path);
                  storedMedia.push({
                    type:
                      ad.ad_format === "video" ? "video_thumbnail" : "image",
                    stored_url: urlData.publicUrl,
                    original_url: ad.thumbnail_url,
                    mime_type: blob.type || "image/jpeg",
                    file_size_bytes: blob.size,
                    position: 0,
                  });
                }
              }
            }
          } catch (e) {
            console.error("Image download failed:", e);
          }
        }

        // Insert ad
        const { error: insertError } = await supabase
          .from("ad_library_saved_ads")
          .insert({
            user_id: user.id,
            advertiser_name: ad.advertiser_name || "Unknown",
            source_url: ad.source_url || "",
            platform: ad.platform || "facebook",
            ad_format: ad.ad_format || "image",
            headline: ad.headline || null,
            body_text: ad.body_text || null,
            cta_text: ad.cta_text || null,
            landing_page_url: ad.landing_page_url || null,
            started_running: ad.started_running || null,
            thumbnail_url:
              storedMedia.find(
                (m: any) => m.type === "image" || m.type === "video_thumbnail"
              )?.stored_url ||
              ad.thumbnail_url ||
              null,
            media_urls: ad.media_urls || [],
            stored_media: storedMedia,
            notes: "Saved via Facebook bookmarklet",
          });

        if (insertError) {
          updateResult(resultId, "error", insertError.message);
        } else {
          updateResult(resultId, "saved");
        }
      } catch (e: any) {
        updateResult(resultId, "error", e.message);
      }
    }

    async function handleMessage(event: MessageEvent) {
      if (!event.data || event.data.type !== "VERDANOTE_SAVE_AD") return;

      const ads: AdPayload[] = Array.isArray(event.data.ads)
        ? event.data.ads
        : event.data.ad
          ? [event.data.ad]
          : [];

      if (ads.length === 0) return;
      setIsListening(false);

      // Add all as "saving"
      const newResults: SaveResult[] = ads.map((ad, i) => ({
        id: `${Date.now()}_${i}`,
        advertiser_name: ad.advertiser_name || "Unknown",
        status: "saving" as const,
      }));
      setResults((prev) => [...prev, ...newResults]);

      // Process sequentially
      for (let i = 0; i < ads.length; i++) {
        await processAd(ads[i], newResults[i].id);
        if (i < ads.length - 1)
          await new Promise((r) => setTimeout(r, 300));
      }

      // Notify bookmarklet
      if (event.source) {
        try {
          (event.source as Window).postMessage(
            { type: "VERDANOTE_SAVE_COMPLETE" },
            "*"
          );
        } catch {}
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [updateResult]);

  const saved = results.filter((r) => r.status === "saved").length;
  const duplicates = results.filter((r) => r.status === "duplicate").length;
  const errors = results.filter((r) => r.status === "error").length;
  const saving = results.filter((r) => r.status === "saving").length;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <ImageIcon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-sm font-semibold">Verdanote Ad Saver</h1>
          <p className="text-xs text-muted-foreground">
            {isListening
              ? "Waiting for ads from bookmarklet…"
              : saving > 0
                ? `Saving ads… (${saving} remaining)`
                : `Done! ${saved} saved${duplicates ? `, ${duplicates} duplicates` : ""}${errors ? `, ${errors} errors` : ""}`}
          </p>
        </div>
      </div>

      {/* Waiting state */}
      {isListening && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            Click "Save" on an ad in the Facebook Ads Library…
          </p>
        </div>
      )}

      {/* Results list */}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              {r.status === "saving" && (
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              )}
              {r.status === "saved" && (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              )}
              {r.status === "duplicate" && (
                <Copy className="h-4 w-4 text-blue-500 shrink-0" />
              )}
              {r.status === "error" && (
                <XCircle className="h-4 w-4 text-destructive shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {r.advertiser_name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {r.status === "saving" && "Saving…"}
                  {r.status === "saved" && "Saved to library"}
                  {r.status === "duplicate" && "Already in library"}
                  {r.status === "error" && (r.error || "Failed to save")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {!isListening && saving === 0 && (
        <div className="mt-6 pt-4 border-t border-border text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            You can close this window and continue browsing.
          </p>
          <button
            onClick={() => {
              setResults([]);
              setIsListening(true);
            }}
            className="text-xs text-primary underline hover:no-underline"
          >
            Keep open for more saves
          </button>
        </div>
      )}
    </div>
  );
}
