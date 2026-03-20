import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Upload, FileJson, Globe, HelpCircle, Download, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface ImportResult {
  success: boolean;
  imported: number;
  skipped_duplicates: number;
  failed: number;
  total: number;
  errors?: string[];
}

interface ImportFromAtriaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// CSV template columns
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
    advertiser_name: ad.advertiser_name || ad.brand_name || ad.advertiser || ad.brandName || "",
    advertiser_page_id: ad.advertiser_page_id || ad.page_id || ad.pageId || null,
    ad_id: ad.ad_id || ad.adId || ad.facebook_ad_id || null,
    platform: ad.platform || "facebook",
    ad_format: ad.ad_format || ad.format || ad.type || ad.adFormat || null,
    headline: ad.headline || ad.title || null,
    body_text: ad.body_text || ad.body || ad.text || ad.copy || ad.bodyText || null,
    cta_text: ad.cta_text || ad.cta || ad.ctaText || null,
    landing_page_url: ad.landing_page_url || ad.landing_page || ad.landingPage || ad.destination_url || null,
    thumbnail_url: ad.thumbnail_url || ad.image_url || ad.thumbnail || ad.thumbnailUrl || ad.imageUrl || null,
    media_urls: ad.media_urls || (ad.media_url ? [ad.media_url] : []),
    started_running: ad.started_running || ad.start_date || ad.startDate || null,
    tags: typeof ad.tags === "string" ? ad.tags.split(",").map((s: string) => s.trim()).filter(Boolean) : (ad.tags || []),
    boards: ad.boards || (ad.board_name ? [ad.board_name] : (ad.boardName ? [ad.boardName] : [])),
    notes: ad.notes || null,
    raw_data: ad.raw_data || null,
  }));
}

export function ImportFromAtriaModal({ isOpen, onClose }: ImportFromAtriaModalProps) {
  const [tab, setTab] = useState<string>("paste");
  const [jsonText, setJsonText] = useState("");
  const [parsedAds, setParsedAds] = useState<any[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const resetState = useCallback(() => {
    setParsedAds(null);
    setParseError(null);
    setProgress(null);
    setResult(null);
  }, []);

  const handleParse = useCallback(() => {
    resetState();
    try {
      let data = JSON.parse(jsonText);
      if (!Array.isArray(data)) {
        if (data.ads) data = data.ads;
        else if (data.data) data = data.data;
        else if (data.results) data = data.results;
        else data = [data];
      }
      const normalized = normalizeAds(data);
      if (normalized.length === 0) {
        setParseError("No ads found in the JSON data.");
        return;
      }
      setParsedAds(normalized);
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

  // Build bookmarklet code
  const bookmarkletCode = `javascript:void(function(){if(!location.hostname.includes('tryatria.com')&&!location.hostname.includes('atria')){alert('Please navigate to tryatria.com first');return}var ads=[];var seen={};var cards=document.querySelectorAll('[class*="card"],[class*="Card"],[class*="ad-item"],[class*="AdCard"],[class*="swipe"],article,div[class*="grid"]>div');cards.forEach(function(c,idx){if(c.offsetHeight<50||c.querySelectorAll('img').length===0)return;var img=c.querySelector('img[src*="http"]');if(!img)return;var text=c.innerText||'';if(text.length<10)return;var link=c.querySelector('a[href*="facebook.com"],a[href*="tiktok.com"],a[href*="ads/library"]');var nameEl=c.querySelector('h3,h4,h2,[class*="brand"],[class*="name"],[class*="advertiser"]');var name=nameEl?nameEl.innerText.trim():'';var lines=text.split('\\n').filter(function(l){return l.trim().length>0});if(!name&&lines.length>0)name=lines[0].substring(0,60);var srcUrl=link?link.href:'https://tryatria.com/saved/'+idx+'-'+Date.now()+'-'+Math.random().toString(36).substring(2,8);if(seen[srcUrl])return;seen[srcUrl]=true;ads.push({thumbnail_url:img.src,body_text:text.substring(0,1000),source_url:srcUrl,advertiser_name:name||'Unknown',platform:'facebook'})});if(!ads.length){alert('No ads found on this page. Make sure you are on your saved ads view and have scrolled to load all ads.');return}var d=document.createElement('div');d.style.cssText='position:fixed;top:20px;right:20px;z-index:99999;background:#18181b;color:white;padding:16px 24px;border-radius:12px;font-family:system-ui;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,.3)';d.innerHTML='Found '+ads.length+' ads. Sending to AdVault...';document.body.appendChild(d);var token=prompt('Paste your AdVault auth token (from Settings > API Keys, or run this in your Verdanote console:\\nJSON.parse(localStorage.getItem(atob("c2ItdmpqbHVsaWZvdnNkandicGhtZHNoLWF1dGgtdG9rZW4=")))?.access_token');if(!token){d.remove();return}fetch('${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-ads',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({ads:ads})}).then(function(r){return r.json()}).then(function(data){d.innerHTML='<b>Done!</b> Imported '+(data.imported||0)+' ads.'+(data.skipped_duplicates?' ('+data.skipped_duplicates+' duplicates skipped)':'');setTimeout(function(){d.remove()},5000)}).catch(function(e){d.innerHTML='Import failed: '+e.message;setTimeout(function(){d.remove()},5000)})})()`;

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
            <Button className="w-full" onClick={() => { resetState(); onClose(); }}>
              View Imported Ads
            </Button>
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

            {/* Tab 2: Browser Capture */}
            <TabsContent value="browser" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                This bookmarklet extracts your saved ads directly from the Atria website. Works for all Atria plans.
              </p>
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <a
                    href={bookmarkletCode}
                    onClick={(e) => e.preventDefault()}
                    draggable
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium cursor-grab active:cursor-grabbing shadow-sm hover:opacity-90 transition-opacity"
                  >
                    <Globe className="h-4 w-4" /> Export from Atria
                  </a>
                  <span className="text-xs text-muted-foreground">← Drag this to your bookmarks bar</span>
                </div>
              </div>
              <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                <li>Drag the button above to your browser's bookmarks bar</li>
                <li>Go to <a href="https://tryatria.com" target="_blank" rel="noopener" className="text-primary underline">tryatria.com</a> and log in to your account</li>
                <li>Navigate to your saved ads or swipe file</li>
                <li>Scroll down to load all your ads, then click the bookmarklet</li>
                <li>When prompted, paste your auth token (find it in Settings → API Keys)</li>
                <li>The bookmarklet will extract and send your ads automatically</li>
              </ol>
              <div className="rounded-lg bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
                <strong>Tip:</strong> The bookmarklet captures whatever is visible on the page. Scroll to the bottom first to load all your ads before clicking it.
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
