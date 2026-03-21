import { useState, useCallback, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Upload, FileJson, Globe, HelpCircle, Download, CheckCircle2, AlertCircle, Loader2, Copy, Check, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

function AuthTokenDisplay() {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token || null);
    });
  }, []);

  if (!token) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    toast.success("Auth token copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Your Auth Token</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy Token"}
        </Button>
      </div>
      <code className="block text-[10px] text-muted-foreground bg-background rounded p-2 break-all max-h-16 overflow-y-auto select-all">
        {token}
      </code>
      <p className="text-[10px] text-muted-foreground">Paste this when the bookmarklet prompts you. Expires in ~1 hour.</p>
    </div>
  );
}

interface ImportResult {
  success: boolean;
  imported: number;
  skipped_duplicates: number;
  failed: number;
  total: number;
  errors?: string[];
  imported_ads?: Array<{ id: string; source_url: string; ad_format?: string }>;
  results?: {
    folders_created?: number;
    boards_created?: number;
    tags_created?: number;
    ads_imported?: number;
    ads_skipped_duplicate?: number;
    board_assignments_created?: number;
    tag_assignments_created?: number;
  };
}

interface EnrichmentState {
  phase: "idle" | "running" | "done";
  total: number;
  processed: number;
  videosFound: number;
  imageAds: number;
  failedFetch: number;
}

interface ImportFromAtriaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// CSV template columns
const CSV_TEMPLATE = `source_url,advertiser_name,platform,ad_format,headline,body_text,cta_text,landing_page_url,started_running,tags,board_name,folder_name,notes
https://www.facebook.com/ads/library/?id=123456,Brand Name,facebook,image,My Headline,Ad body text,Shop Now,https://example.com,2025-01-15,"hook,ugc",Inspiration,Competitor Research,Great ad`;

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += char;
    }
    values.push(current.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ""; });
    return obj;
  });
}

function normalizeAds(raw: any[]): any[] {
  return raw.map(ad => ({
    source_url: ad.source_url || ad.url || ad.link || ad.ad_url || "",
    advertiser_name: ad.advertiser_name || ad.brand_name || ad.advertiser || ad.brandName || "",
    advertiser_page_id: ad.advertiser_page_id || ad.page_id || ad.pageId || null,
    ad_id: ad.ad_id || ad.adId || ad.facebook_ad_id || null,
    platform: ad.platform || "facebook",
    ad_format: ad.ad_format || ad.format || ad.type || ad.adFormat || (Array.isArray(ad.media_urls) && ad.media_urls.some((url: string) => /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url)) ? "video" : null),
    headline: ad.headline || ad.title || null,
    body_text: ad.body_text || ad.body || ad.text || ad.copy || ad.bodyText || null,
    cta_text: ad.cta_text || ad.cta || ad.ctaText || null,
    landing_page_url: ad.landing_page_url || ad.landing_page || ad.landingPage || ad.destination_url || null,
    thumbnail_url: ad.thumbnail_url || ad.image_url || ad.thumbnail || ad.thumbnailUrl || ad.imageUrl || ad.poster_url || ad.poster || null,
    media_urls: ad.media_urls || ad.mediaUrls || ad.assets || (ad.media_url ? [ad.media_url] : ad.video_url ? [ad.video_url] : []),
    started_running: ad.started_running || ad.start_date || ad.startDate || null,
    tags: typeof ad.tags === "string" ? ad.tags.split(",").map((s: string) => s.trim()).filter(Boolean) : (ad.tags || []),
    boards: ad.boards || (ad.board_name ? [ad.board_name] : (ad.boardName ? [ad.boardName] : [])),
    folder_name: ad.folder_name || ad.folderName || null,
    notes: ad.notes || null,
    raw_data: ad.raw_data || ad,
  }));
}

const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function ImportFromAtriaModal({ isOpen, onClose }: ImportFromAtriaModalProps) {
  const [tab, setTab] = useState<string>("paste");
  const [jsonText, setJsonText] = useState("");
  const [parsedAds, setParsedAds] = useState<any[] | null>(null);
  const [parsedOrganization, setParsedOrganization] = useState<any | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentState>({ phase: "idle", total: 0, processed: 0, videosFound: 0, imageAds: 0, failedFetch: 0 });
  const [bookmarkletCopied, setBookmarkletCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const enrichmentAbortRef = useRef(false);
  const queryClient = useQueryClient();

  const resetState = useCallback(() => {
    setParsedAds(null);
    setParsedOrganization(null);
    setParseError(null);
    setProgress(null);
    setResult(null);
    setEnrichment({ phase: "idle", total: 0, processed: 0, videosFound: 0, imageAds: 0, failedFetch: 0 });
    enrichmentAbortRef.current = false;
  }, []);

  const handleParse = useCallback(() => {
    resetState();
    try {
      let raw = JSON.parse(jsonText);
      let adsData: any[];
      let org = null;

      // Detect structured format with organization
      if (raw.organization && raw.ads) {
        org = raw.organization;
        adsData = raw.ads;
      } else if (Array.isArray(raw)) {
        adsData = raw;
      } else if (raw.ads) {
        adsData = raw.ads;
        // Try to extract org from same object
        if (raw.boards || raw.folders || raw.tags) {
          org = {
            folders: raw.folders || [],
            standalone_boards: raw.boards || raw.collections || [],
            tags: raw.tags || raw.labels || [],
          };
        }
      } else if (raw.data) {
        adsData = Array.isArray(raw.data) ? raw.data : [raw.data];
      } else if (raw.results) {
        adsData = Array.isArray(raw.results) ? raw.results : [raw.results];
      } else {
        adsData = [raw];
      }

      const normalized = normalizeAds(adsData);
      if (normalized.length === 0) {
        setParseError("No ads found in the JSON data.");
        return;
      }
      setParsedAds(normalized);
      if (org) setParsedOrganization(org);
    } catch {
      setParseError("Invalid JSON. Please check the format and try again.");
    }
  }, [jsonText, resetState]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    resetState();
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        if (file.name.endsWith(".csv")) {
          const rows = parseCSV(text);
          const normalized = normalizeAds(rows);
          if (normalized.length === 0) {
            setParseError("No ads found in the CSV file.");
            return;
          }
          setParsedAds(normalized);
        } else {
          let data = JSON.parse(text);
          if (!Array.isArray(data)) {
            if (data.ads) data = data.ads;
            else if (data.data) data = data.data;
            else data = [data];
          }
          const normalized = normalizeAds(data);
          if (normalized.length === 0) {
            setParseError("No ads found in the file.");
            return;
          }
          setParsedAds(normalized);
        }
      } catch {
        setParseError("Could not parse the file. Ensure it's valid JSON or CSV.");
      }
    };
    reader.readAsText(file);
  }, [resetState]);

  const runEnrichment = useCallback(async (importedAds: Array<{ id: string; source_url: string; ad_format?: string }>) => {
    const fbAds = importedAds.filter(a => a.source_url && a.source_url.includes("facebook.com/ads/library"));
    if (fbAds.length === 0) return;

    setEnrichment({ phase: "running", total: fbAds.length, processed: 0, videosFound: 0, imageAds: 0, failedFetch: 0 });

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    let videosFound = 0;
    let imageAds = 0;
    let failedFetch = 0;

    for (let i = 0; i < fbAds.length; i += BATCH_SIZE) {
      if (enrichmentAbortRef.current) break;

      const batch = fbAds.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (ad) => {
        try {
          const scrapeResp = await fetch(`${SUPABASE_URL}/functions/v1/scrape-ad`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ url: ad.source_url }),
          });

          if (!scrapeResp.ok) return { status: "failed" as const };

          const scrapeData = await scrapeResp.json();
          if (!scrapeData.success || !scrapeData.data) return { status: "failed" as const };

          const scraped = scrapeData.data;
          const hasVideo = scraped.ad_format === "video" ||
            (scraped.stored_media || []).some((m: any) => m.type === "video" && !m.download_failed);

          // Update the saved ad with enriched data
          const updatePayload: Record<string, any> = {};

          if (scraped.stored_media && scraped.stored_media.length > 0) {
            updatePayload.stored_media = scraped.stored_media;
          }
          if (scraped.thumbnail_url) {
            updatePayload.thumbnail_url = scraped.thumbnail_url;
          }
          if (scraped.ad_format) {
            updatePayload.ad_format = scraped.ad_format;
          }
          if (scraped.media_urls && scraped.media_urls.length > 0) {
            updatePayload.media_urls = scraped.media_urls;
          }
          // Also enrich text fields if they were empty
          if (scraped.headline) updatePayload.headline = scraped.headline;
          if (scraped.body_text) updatePayload.body_text = scraped.body_text;
          if (scraped.cta_text) updatePayload.cta_text = scraped.cta_text;
          if (scraped.landing_page_url) updatePayload.landing_page_url = scraped.landing_page_url;
          if (scraped.advertiser_name) updatePayload.advertiser_name = scraped.advertiser_name;

          if (Object.keys(updatePayload).length > 0) {
            await supabase
              .from("ad_library_saved_ads")
              .update(updatePayload)
              .eq("id", ad.id);
          }

          return { status: hasVideo ? "video" as const : "image" as const };
        } catch {
          return { status: "failed" as const };
        }
      });

      const results = await Promise.all(promises);
      results.forEach(r => {
        if (r.status === "video") videosFound++;
        else if (r.status === "image") imageAds++;
        else failedFetch++;
      });

      const processed = Math.min(i + BATCH_SIZE, fbAds.length);
      setEnrichment({
        phase: "running",
        total: fbAds.length,
        processed,
        videosFound,
        imageAds,
        failedFetch,
      });

      // Delay between batches (skip after last batch)
      if (i + BATCH_SIZE < fbAds.length && !enrichmentAbortRef.current) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    setEnrichment({
      phase: "done",
      total: fbAds.length,
      processed: fbAds.length,
      videosFound,
      imageAds,
      failedFetch,
    });

    queryClient.invalidateQueries({ queryKey: ["ad-library"] });
  }, [queryClient]);

  const doImport = useCallback(async (ads: any[]) => {
    setImporting(true);
    setProgress(`Importing ${ads.length} ads...`);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Please log in first"); return; }

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/import-ads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ads,
          boards: [...new Set(ads.flatMap(a => a.boards || []))],
          tags: [...new Set(ads.flatMap(a => a.tags || []))],
        }),
      });

      const data = await resp.json();
      if (!resp.ok || !data.success) {
        toast.error(data.error || "Import failed");
        return;
      }

      setResult(data);
      toast.success(`Imported ${data.imported} ads`);
      queryClient.invalidateQueries({ queryKey: ["ad-library"] });

      // Auto-trigger enrichment for imported ads with Facebook source URLs
      if (data.imported_ads && data.imported_ads.length > 0) {
        // Run enrichment in background (don't await — let the user see results)
        runEnrichment(data.imported_ads);
      }
    } catch (e: any) {
      toast.error("Import failed: " + e.message);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }, [queryClient, runEnrichment]);

  const downloadTemplate = useCallback(() => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ad-library-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const appUrl = window.location.origin;
  const bookmarkletLoaderUrl = `${appUrl}/atria-export-bookmarklet.js`;
  const importUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-ads`;
  const bookmarkletCode = `javascript:(function(){try{window.__ADVAULT_ATRIA_CONFIG={importUrl:${JSON.stringify(importUrl)}};var existing=document.getElementById('advault-atria-export-loader');if(existing){existing.remove();}var s=document.createElement('script');s.id='advault-atria-export-loader';s.src=${JSON.stringify(bookmarkletLoaderUrl)}+'?t=' + Date.now();s.onerror=function(){alert('Could not load the Atria exporter. Re-copy the bookmarklet from AdVault and try again.');};document.body.appendChild(s);}catch(err){alert('Atria bookmarklet failed: '+(err&&err.message?err.message:err));}})();`;

  const handleCopyBookmarklet = useCallback(async () => {
    await navigator.clipboard.writeText(bookmarkletCode);
    setBookmarkletCopied(true);
    toast.success("Bookmarklet code copied");
    setTimeout(() => setBookmarkletCopied(false), 2000);
  }, [bookmarkletCode]);

  const enrichmentPercent = enrichment.total > 0 ? Math.round((enrichment.processed / enrichment.total) * 100) : 0;

  return (
    <Dialog open={isOpen} onOpenChange={() => { if (!importing && enrichment.phase !== "running") { enrichmentAbortRef.current = true; resetState(); onClose(); } }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Import from Atria</DialogTitle>
          <DialogDescription>Migrate your saved ads from tryatria.com into your Ad Library.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-4">
            {/* Step 1: Import Results */}
            <div className="flex items-center gap-3 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
              <span className="text-lg font-semibold">Step 1: Import Complete</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border p-3 text-center">
                <div className="text-2xl font-bold">{result.imported}</div>
                <div className="text-xs text-muted-foreground">Imported</div>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <div className="text-2xl font-bold">{result.skipped_duplicates}</div>
                <div className="text-xs text-muted-foreground">Duplicates Skipped</div>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <div className="text-2xl font-bold">{result.failed}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
            </div>
            {result.errors && result.errors.length > 0 && (
              <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive space-y-1">
                {result.errors.map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            )}

            {/* Step 2: Media Enrichment */}
            {enrichment.phase === "running" && (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <Video className="h-5 w-5 text-primary animate-pulse" />
                  <span className="text-sm font-semibold">Step 2: Fetching full media from Facebook for {enrichment.total} ads...</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full transition-all duration-300"
                    style={{ width: `${enrichmentPercent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Enriched {enrichment.processed} of {enrichment.total} ads — found {enrichment.videosFound} videos so far...
                </p>
              </div>
            )}

            {enrichment.phase === "done" && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-emerald-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="text-sm font-semibold">Step 2: Media Enrichment Complete</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Found and downloaded <strong>{enrichment.videosFound}</strong> videos.{" "}
                  <strong>{enrichment.imageAds}</strong> ads were images (no video to fetch).{" "}
                  {enrichment.failedFetch > 0 && (
                    <><strong>{enrichment.failedFetch}</strong> ads could not be re-fetched (source may have expired).</>
                  )}
                </p>
                {enrichment.failedFetch > 0 && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
                    <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      <Video className="h-3.5 w-3.5 text-primary" />
                      Missing video files?
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Facebook blocks server-side video downloads. To capture the actual video files:
                    </p>
                    <ul className="text-[11px] text-muted-foreground space-y-1 ml-4 list-disc">
                      <li>Open the ad on Facebook and use our <strong>bookmarklet</strong> — it captures video directly from your browser</li>
                      <li>Use <strong>Screen Capture</strong> in the Save Ad modal to record videos as they play</li>
                      <li>Or keep the thumbnails — they're still useful for reference</li>
                    </ul>
                  </div>
                )}
              </div>
            )}

            {enrichment.phase === "idle" && enrichment.total === 0 && (
              <p className="text-xs text-muted-foreground italic">No Facebook Ad Library URLs found — skipping media enrichment.</p>
            )}

            <Button
              className="w-full"
              onClick={() => { enrichmentAbortRef.current = true; resetState(); onClose(); }}
              disabled={enrichment.phase === "running"}
              variant={enrichment.phase === "running" ? "outline" : "default"}
            >
              {enrichment.phase === "running" ? "Enrichment in progress..." : "View Imported Ads"}
            </Button>
            {enrichment.phase === "running" && (
              <p className="text-[10px] text-center text-muted-foreground">
                You can close this modal — enrichment will continue in the background.
              </p>
            )}
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full grid grid-cols-3 h-9">
              <TabsTrigger value="paste" className="text-xs gap-1.5"><FileJson className="h-3.5 w-3.5" /> Paste JSON</TabsTrigger>
              <TabsTrigger value="browser" className="text-xs gap-1.5"><Globe className="h-3.5 w-3.5" /> Browser Capture</TabsTrigger>
              <TabsTrigger value="upload" className="text-xs gap-1.5"><Upload className="h-3.5 w-3.5" /> Manual Upload</TabsTrigger>
            </TabsList>

            {/* Tab 1: Paste JSON */}
            <TabsContent value="paste" className="space-y-4 mt-4">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground mb-2">
                    If you have API access to your Atria account, paste the JSON response here.
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        <HelpCircle className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs text-xs">
                      Atria Team plan users may have API access. Contact Atria support to get your export endpoint. Paste the full JSON response here.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Textarea
                placeholder='Paste your Atria export data here (JSON format)...'
                className="min-h-[200px] font-mono text-xs"
                value={jsonText}
                onChange={(e) => { setJsonText(e.target.value); setParseError(null); setParsedAds(null); }}
              />
              {parseError && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" /> {parseError}
                </div>
              )}
              {parsedAds && (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-sm font-medium">Found {parsedAds.length} ads ready to import</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {[...new Set(parsedAds.flatMap(a => a.boards))].filter(Boolean).map(b => (
                      <Badge key={b} variant="secondary" className="text-xs">{b}</Badge>
                    ))}
                    {[...new Set(parsedAds.flatMap(a => a.tags))].filter(Boolean).map(t => (
                      <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleParse}
                  disabled={!jsonText.trim() || importing}
                >
                  Parse
                </Button>
                {parsedAds && (
                  <Button onClick={() => doImport(parsedAds)} disabled={importing}>
                    {importing ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Importing...</> : `Import ${parsedAds.length} Ads`}
                  </Button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="browser" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                This bookmarklet extracts your saved ads directly from the Atria website. Works for all Atria plans.
              </p>
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <a
                    href={bookmarkletCode}
                    onClick={(e) => {
                      e.preventDefault();
                      void handleCopyBookmarklet();
                    }}
                    draggable
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium cursor-grab active:cursor-grabbing shadow-sm hover:opacity-90 transition-opacity"
                    title="Drag to bookmarks bar, or click to copy the bookmarklet code"
                  >
                    <Globe className="h-4 w-4" /> Export from Atria
                  </a>
                  <span className="text-xs text-muted-foreground">← Drag this to bookmarks, or click to copy a fresh Chrome-safe bookmarklet</span>
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handleCopyBookmarklet}>
                  {bookmarkletCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {bookmarkletCopied ? "Copied" : "Copy bookmarklet code"}
                </Button>
              </div>

              {/* Auth token display */}
              <AuthTokenDisplay />

              <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                 <li>Delete your old Atria bookmarklet, then drag this new one to your browser's bookmarks bar</li>
                <li>Go to <a href="https://tryatria.com" target="_blank" rel="noopener" className="text-primary underline">tryatria.com</a> and log in to your account</li>
                <li>Navigate to your saved ads or swipe file</li>
                <li>Scroll down to load all your ads, then click the bookmarklet</li>
                <li>When prompted, paste your auth token from the box above</li>
                <li>The bookmarklet will extract and send your ads automatically</li>
              </ol>
              <div className="rounded-lg bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
                 <strong>Tip:</strong> Chrome often refuses oversized bookmarklets silently — this refreshed version loads a tiny helper script instead, so make sure you replace the old bookmark first.
              </div>
            </TabsContent>

            {/* Tab 3: Manual Upload */}
            <TabsContent value="upload" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Upload a JSON or CSV file with your ad data. Use our template for the best results.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5" /> Download CSV Template
                </Button>
              </div>
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click to upload a JSON or CSV file</p>
                <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
              {parseError && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" /> {parseError}
                </div>
              )}
              {parsedAds && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-sm font-medium">Found {parsedAds.length} ads ready to import</p>
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="text-left p-2 font-medium">Advertiser</th>
                          <th className="text-left p-2 font-medium">Platform</th>
                          <th className="text-left p-2 font-medium">Format</th>
                          <th className="text-left p-2 font-medium">Tags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedAds.slice(0, 50).map((ad, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="p-2 truncate max-w-[150px]">{ad.advertiser_name || "—"}</td>
                            <td className="p-2">{ad.platform}</td>
                            <td className="p-2">{ad.ad_format || "—"}</td>
                            <td className="p-2 truncate max-w-[120px]">{(ad.tags || []).join(", ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button onClick={() => doImport(parsedAds)} disabled={importing} className="w-full">
                    {importing ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Importing...</> : `Import ${parsedAds.length} Ads`}
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        {progress && !result && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {progress}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
