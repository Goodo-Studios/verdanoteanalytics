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

// ── Auth Token Display ──

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

// ── Types ──

interface ImportResult {
  success: boolean;
  imported: number;
  skipped_duplicates: number;
  failed: number;
  total: number;
  videos_downloaded?: number;
  images_downloaded?: number;
  video_download_failed?: number;
  errors?: string[];
  results?: {
    boards_created?: number;
    tags_created?: number;
    ads_imported?: number;
    ads_skipped_duplicate?: number;
    board_assignments_created?: number;
    tag_assignments_created?: number;
  };
}

interface ImportFromAtriaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── CSV helpers ──

const CSV_TEMPLATE = `source_url,advertiser_name,platform,ad_format,headline,body_text,cta_text,landing_page_url,started_running,tags,board_name,notes
https://www.facebook.com/ads/library/?id=123456,Brand Name,facebook,image,My Headline,Ad body text,Shop Now,https://example.com,2025-01-15,"hook,ugc",Inspiration,Great ad`;

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
    advertiser_name: ad.advertiser_name || ad.brand_name || ad.advertiser || "",
    ad_id: ad.ad_id || ad.adId || null,
    meta_page_id: ad.meta_page_id || ad.advertiser_page_id || null,
    platform: ad.platform || "facebook",
    ad_format: ad.ad_format || ad.format || (ad.video_url ? "video" : null),
    headline: ad.headline || ad.title || null,
    body_text: ad.body_text || ad.body || ad.text || null,
    cta_text: ad.cta_text || ad.cta || null,
    landing_page_url: ad.landing_page_url || ad.landing_page || null,
    thumbnail_url: ad.thumbnail_url || ad.image_url || null,
    video_url: ad.video_url || null,
    tags: typeof ad.tags === "string" ? ad.tags.split(",").map((s: string) => s.trim()).filter(Boolean) : (ad.tags || []),
    boards: ad.boards || (ad.board_name ? [ad.board_name] : []),
    notes: ad.notes || null,
  }));
}

// ── Component ──

export function ImportFromAtriaModal({ isOpen, onClose }: ImportFromAtriaModalProps) {
  const [tab, setTab] = useState<string>("browser");
  const [jsonText, setJsonText] = useState("");
  const [parsedAds, setParsedAds] = useState<any[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [bookmarkletCopied, setBookmarkletCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const resetState = useCallback(() => {
    setParsedAds(null);
    setParseError(null);
    setProgress(null);
    setResult(null);
  }, []);

  // ── Parse JSON ──
  const handleParse = useCallback(() => {
    resetState();
    try {
      let raw = JSON.parse(jsonText);
      let adsData: any[];
      if (Array.isArray(raw)) adsData = raw;
      else if (raw.ads) adsData = raw.ads;
      else if (raw.data) adsData = Array.isArray(raw.data) ? raw.data : [raw.data];
      else adsData = [raw];

      const normalized = normalizeAds(adsData);
      if (normalized.length === 0) { setParseError("No ads found."); return; }
      setParsedAds(normalized);
    } catch {
      setParseError("Invalid JSON.");
    }
  }, [jsonText, resetState]);

  // ── File Upload ──
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
          if (normalized.length === 0) { setParseError("No ads found in CSV."); return; }
          setParsedAds(normalized);
        } else {
          let data = JSON.parse(text);
          if (!Array.isArray(data)) { data = data.ads || data.data || [data]; }
          const normalized = normalizeAds(data);
          if (normalized.length === 0) { setParseError("No ads found in file."); return; }
          setParsedAds(normalized);
        }
      } catch {
        setParseError("Could not parse file.");
      }
    };
    reader.readAsText(file);
  }, [resetState]);

  // ── Import ──
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
        body: JSON.stringify({ ads }),
      });

      const data = await resp.json();
      if (!resp.ok || !data.success) {
        toast.error(data.error || "Import failed");
        return;
      }

      setResult(data);
      toast.success(`Imported ${data.imported} ads`);
      queryClient.invalidateQueries({ queryKey: ["ad-library"] });
      queryClient.invalidateQueries({ queryKey: ["ad-library-saved-ads"] });
      queryClient.invalidateQueries({ queryKey: ["ad-library-ads-infinite"] });
      queryClient.invalidateQueries({ queryKey: ["ad-library-boards"] });
      queryClient.invalidateQueries({ queryKey: ["ad-library-tags"] });
    } catch (e: any) {
      toast.error("Import failed: " + e.message);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }, [queryClient]);

  const downloadTemplate = useCallback(() => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ad-library-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── Bookmarklet code ──
  const appUrl = window.location.origin;
  const bookmarkletLoaderUrl = `${appUrl}/atria-export-bookmarklet.js`;
  const importUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-ads`;
  const bookmarkletCode = `javascript:(function(){try{window.__ADVAULT_ATRIA_CONFIG={importUrl:${JSON.stringify(importUrl)}};var s=document.createElement('script');s.src=${JSON.stringify(bookmarkletLoaderUrl)}+'?t='+Date.now();s.onerror=function(){alert('Could not load exporter. Try copying a fresh bookmarklet.');};document.body.appendChild(s);}catch(e){alert('Error: '+e.message);}})();`;

  const handleCopyBookmarklet = useCallback(async () => {
    await navigator.clipboard.writeText(bookmarkletCode);
    setBookmarkletCopied(true);
    toast.success("Bookmarklet code copied");
    setTimeout(() => setBookmarkletCopied(false), 2000);
  }, [bookmarkletCode]);

  return (
    <Dialog open={isOpen} onOpenChange={() => { if (!importing) { resetState(); onClose(); } }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Import from Atria</DialogTitle>
          <DialogDescription>Migrate your saved ads from tryatria.com into your Ad Library.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
              <span className="text-lg font-semibold">Import Complete</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border p-3 text-center">
                <div className="text-2xl font-bold">{result.imported}</div>
                <div className="text-xs text-muted-foreground">Ads Imported</div>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <div className="text-2xl font-bold">{result.videos_downloaded || 0}</div>
                <div className="text-xs text-muted-foreground">Videos Downloaded</div>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <div className="text-2xl font-bold">{result.images_downloaded || 0}</div>
                <div className="text-xs text-muted-foreground">Images Downloaded</div>
              </div>
            </div>

            {/* Organization stats */}
            {result.results && (result.results.boards_created || result.results.tags_created) ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                <p className="text-xs font-medium text-foreground">Organization:</p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {(result.results.boards_created ?? 0) > 0 && <span>✓ {result.results.boards_created} boards created</span>}
                  {(result.results.tags_created ?? 0) > 0 && <span>✓ {result.results.tags_created} tags created</span>}
                  {(result.results.board_assignments_created ?? 0) > 0 && <span>✓ {result.results.board_assignments_created} board assignments</span>}
                  {(result.results.tag_assignments_created ?? 0) > 0 && <span>✓ {result.results.tag_assignments_created} tag assignments</span>}
                </div>
              </div>
            ) : null}

            {result.skipped_duplicates > 0 && (
              <p className="text-xs text-muted-foreground">{result.skipped_duplicates} duplicate ads were skipped.</p>
            )}

            {(result.video_download_failed ?? 0) > 0 && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
                <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Video className="h-3.5 w-3.5 text-primary" />
                  {result.video_download_failed} video downloads failed
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Some videos couldn't be downloaded from Atria's CDN. The thumbnails were saved instead.
                  You can use the bookmarklet on individual ad pages to re-capture videos.
                </p>
              </div>
            )}

            {result.errors && result.errors.length > 0 && (
              <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive space-y-1">
                {result.errors.map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            )}

            <Button className="w-full" onClick={() => { resetState(); onClose(); }}>
              View Imported Ads
            </Button>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full grid grid-cols-3 h-9">
              <TabsTrigger value="browser" className="text-xs gap-1.5"><Globe className="h-3.5 w-3.5" /> Bookmarklet</TabsTrigger>
              <TabsTrigger value="paste" className="text-xs gap-1.5"><FileJson className="h-3.5 w-3.5" /> Paste JSON</TabsTrigger>
              <TabsTrigger value="upload" className="text-xs gap-1.5"><Upload className="h-3.5 w-3.5" /> Upload File</TabsTrigger>
            </TabsList>

            {/* Tab 1: Bookmarklet (primary) */}
            <TabsContent value="browser" className="space-y-4 mt-4">
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">How it works:</p>
                <p className="text-sm text-muted-foreground">
                  The bookmarklet runs on Atria's website, extracts all your ads (including videos), 
                  and sends them directly to Verdanote with full media downloads.
                </p>
              </div>

              {/* Bookmarklet button */}
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <a
                    href={bookmarkletCode}
                    onClick={(e) => { e.preventDefault(); void handleCopyBookmarklet(); }}
                    draggable
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium cursor-grab active:cursor-grabbing shadow-sm hover:opacity-90 transition-opacity"
                    title="Drag to bookmarks bar, or click to copy"
                  >
                    <Globe className="h-4 w-4" /> Export from Atria
                  </a>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handleCopyBookmarklet}>
                    {bookmarkletCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {bookmarkletCopied ? "Copied" : "Copy Code"}
                  </Button>
                </div>
              </div>

              {/* Auth token */}
              <AuthTokenDisplay />

              {/* Instructions */}
              <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                <li>Drag the button above to your browser's bookmarks bar (or click to copy, then paste as a new bookmark URL)</li>
                <li>Go to <a href="https://app.tryatria.com" target="_blank" rel="noopener" className="text-primary underline">app.tryatria.com</a> and log in</li>
                <li>Navigate to any board or your Saved Ads</li>
                <li>Click the "Export from Atria" bookmark</li>
                <li>Select which boards to import — the bookmarklet will:
                  <ul className="ml-4 mt-1 space-y-0.5 list-disc text-xs">
                    <li>Scroll to load all ads</li>
                    <li>Click play on video ads to capture the actual video URL</li>
                    <li>Send everything to Verdanote, where videos and images are downloaded from Atria's CDN</li>
                  </ul>
                </li>
                <li>When prompted, paste your auth token from above</li>
              </ol>

              <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">How media capture works:</strong> The bookmarklet extracts video URLs 
                  directly from Atria's react-player. Our server then downloads the actual .mp4 files from Atria's CDN 
                  (which is publicly accessible) and stores them permanently in your library.
                </p>
              </div>
            </TabsContent>

            {/* Tab 2: Paste JSON */}
            <TabsContent value="paste" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Paste JSON data from Atria's API or a manual export.
              </p>
              <Textarea
                placeholder='Paste JSON here...'
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
                <Button variant="outline" onClick={handleParse} disabled={!jsonText.trim() || importing}>
                  Parse
                </Button>
                {parsedAds && (
                  <Button onClick={() => doImport(parsedAds)} disabled={importing}>
                    {importing ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Importing...</> : `Import ${parsedAds.length} Ads`}
                  </Button>
                )}
              </div>
            </TabsContent>

            {/* Tab 3: Upload File */}
            <TabsContent value="upload" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Upload a JSON or CSV file with your ad data.
              </p>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate}>
                <Download className="h-3.5 w-3.5" /> Download CSV Template
              </Button>
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click to upload a JSON or CSV file</p>
                <Input ref={fileInputRef} type="file" accept=".json,.csv" className="hidden" onChange={handleFileUpload} />
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
