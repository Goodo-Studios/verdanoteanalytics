import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Bookmark, Copy, Check, ExternalLink, Video, Facebook } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function generateFacebookBookmarklet(supabaseUrl: string, token: string, appUrl: string) {
  // Lightweight loader that injects the full facebook-saver.js script
  const code = `(function(){window.__VERDANOTE_FB_CONFIG={supabaseUrl:'${supabaseUrl}',authToken:'${token}',appUrl:'${appUrl}'};var s=document.createElement('script');s.src='${appUrl}/facebook-saver.js?t='+Date.now();document.head.appendChild(s);})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

function generateAtriaBookmarklet(supabaseUrl: string, anonKey: string, token: string, appUrl: string) {
  const importUrl = supabaseUrl + "/functions/v1/import-ads";
  const code = `(function(){window.__ADVAULT_ATRIA_CONFIG={importUrl:'${importUrl}',authToken:'${token}'};var s=document.createElement('script');s.src='${appUrl}/atria-export-bookmarklet.js?t='+Date.now();document.head.appendChild(s);})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

function generateQuickSaveBookmarklet(supabaseUrl: string, anonKey: string, token: string, appUrl: string) {
  const code = `
(function(){
  var S='${supabaseUrl}';
  var K='${anonKey}';
  var T='${token}';
  var A='${appUrl}';
  try{
    var url=location.href;
    var d={};
    var nameEl=document.querySelector('[class*="x1heor9g"]')||document.querySelector('h2')||document.querySelector('[role="heading"]');
    if(nameEl)d.advertiser_name=nameEl.innerText.trim();
    var bodyEls=document.querySelectorAll('[class*="_4ik4"]');
    if(bodyEls.length===0)bodyEls=document.querySelectorAll('[data-testid="ad_body"]');
    if(bodyEls.length>0)d.body_text=bodyEls[0].innerText.trim().substring(0,2000);
    var imgs=document.querySelectorAll('img[src*="scontent"]');
    d.media_urls=[];d.thumbnail_url=null;
    imgs.forEach(function(img){if(img.src&&img.naturalWidth>100){d.media_urls.push(img.src);if(!d.thumbnail_url)d.thumbnail_url=img.src;}});
    var videoEl=document.querySelector('video');
    var videoSrc=videoEl?(videoEl.currentSrc||videoEl.src):null;
    if(!videoSrc){var sources=document.querySelectorAll('video source');for(var i=0;i<sources.length;i++){if(sources[i].src){videoSrc=sources[i].src;break;}}}
    var overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;top:20px;right:20px;z-index:999999;background:#1a1a2e;color:#fff;padding:16px 20px;border-radius:12px;font-family:-apple-system,sans-serif;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,.3);';
    if(videoSrc){
      overlay.innerText='Downloading video...';document.body.appendChild(overlay);
      fetch(videoSrc).then(function(r){return r.blob();}).then(function(blob){
        overlay.innerText='Uploading video ('+Math.round(blob.size/1024/1024)+'MB)...';
        var adId=Date.now().toString(36);var path=encodeURIComponent(adId+'/video.'+((blob.type||'').indexOf('mp4')>-1?'mp4':'webm'));
        return fetch(S+'/storage/v1/object/ad-media/'+path,{method:'POST',headers:{'Authorization':'Bearer '+T,'Content-Type':blob.type||'video/mp4','x-upsert':'true'},body:blob}).then(function(upResp){
          if(!upResp.ok)throw new Error('Upload failed');var publicUrl=S+'/storage/v1/object/public/ad-media/'+path;
          d.ad_format='video';d.stored_media=[{original_url:videoSrc,stored_url:publicUrl,type:'video',mime_type:blob.type||'video/mp4',file_size_bytes:blob.size,position:0}];
          return sendToQuickSave(d);});
      }).catch(function(e){console.error(e);overlay.innerText='Video failed, saving thumbnail...';sendToQuickSave(d);});
    }else{overlay.innerText='Saving ad...';document.body.appendChild(overlay);sendToQuickSave(d);}
    function sendToQuickSave(data){var x=new XMLHttpRequest();x.open('POST',S+'/functions/v1/quick-save');x.setRequestHeader('Content-Type','application/json');x.setRequestHeader('Authorization','Bearer '+T);
      x.onload=function(){var r=JSON.parse(x.responseText);if(r.success){overlay.innerHTML='<span style="font-size:18px">\\u2713</span> '+(r.duplicate?'Already saved!':'Saved to Ad Library!')+'<br><a href="'+A+'/builder/ad-library" target="_blank" style="color:#a78bfa;text-decoration:underline;font-size:12px">Open</a>';}else{overlay.innerHTML='\\u2717 Failed: '+(r.error||'Unknown');overlay.style.background='#7f1d1d';}setTimeout(function(){overlay.remove()},5000);};
      x.onerror=function(){overlay.innerText='Failed';setTimeout(function(){overlay.remove()},3000);};x.send(JSON.stringify({url:url,extracted_data:data}));}
  }catch(e){alert('Quick Save error: '+e.message);}
})();`;
  return `javascript:${encodeURIComponent(code.replace(/\n\s*/g, ""))}`;
}

export function BookmarkletSetup() {
  const { user } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token || null);
    });
  }, []);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const appUrl = window.location.origin;

  const fbHref = token ? generateFacebookBookmarklet(supabaseUrl, token, appUrl) : "#";
  const atriaHref = token ? generateAtriaBookmarklet(supabaseUrl, anonKey, token, appUrl) : "#";
  const quickSaveHref = token ? generateQuickSaveBookmarklet(supabaseUrl, anonKey, token, appUrl) : "#";

  const handleCopy = (href: string, label: string) => {
    navigator.clipboard.writeText(href);
    setCopied(label);
    toast.success(`${label} code copied`);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!user || !token) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        Sign in to set up bookmarklets.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-heading text-base font-semibold mb-1">Save Ads with Bookmarklets</h3>
        <p className="font-body text-sm text-muted-foreground leading-relaxed">
          Drag a bookmarklet to your bookmarks bar, then click it on the source page to save ads.
        </p>
      </div>

      <Tabs defaultValue="facebook" className="w-full">
        <TabsList className="w-full grid grid-cols-3 mb-4">
          <TabsTrigger value="facebook" className="gap-1.5 text-xs">
            <Facebook className="h-3.5 w-3.5" /> Facebook
          </TabsTrigger>
          <TabsTrigger value="atria" className="gap-1.5 text-xs">
            Atria
          </TabsTrigger>
          <TabsTrigger value="quicksave" className="gap-1.5 text-xs">
            Quick Save
          </TabsTrigger>
        </TabsList>

        {/* ── Facebook Ad Library saver ── */}
        <TabsContent value="facebook" className="space-y-4">
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3">
            <Video className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <p className="font-body text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Captures videos directly.</strong> Since this runs in your browser
              on Facebook's page, it can download the actual video file — no server scraping needed.
            </p>
          </div>

          <ol className="space-y-2.5 font-body text-sm text-muted-foreground">
            {[
              "Drag the button below to your bookmarks bar",
              <>Go to <a href="https://www.facebook.com/ads/library" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">facebook.com/ads/library <ExternalLink className="h-3 w-3" /></a> and search for any brand</>,
              "Click the bookmark — a toolbar appears with Save buttons on each ad",
              'Click "Save" on individual ads or "Save All Visible" for the whole page',
            ].map((text, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold">{i + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>

          <div className="flex items-center gap-3">
            <a
              href={fbHref}
              onClick={(e) => e.preventDefault()}
              draggable
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm shadow-md hover:shadow-lg transition-shadow cursor-grab active:cursor-grabbing select-none"
            >
              <Facebook className="h-4 w-4" />
              Save from Facebook
            </a>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleCopy(fbHref, "Facebook bookmarklet")}>
              {copied === "Facebook bookmarklet" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === "Facebook bookmarklet" ? "Copied" : "Copy"}
            </Button>
          </div>
        </TabsContent>

        {/* ── Atria exporter ── */}
        <TabsContent value="atria" className="space-y-4">
          <p className="font-body text-sm text-muted-foreground leading-relaxed">
            Import entire boards from Atria with full organizational structure — boards, tags, and media files.
          </p>

          <ol className="space-y-2.5 font-body text-sm text-muted-foreground">
            {[
              "Drag the button below to your bookmarks bar",
              "Go to app.tryatria.com and log in",
              "Navigate to any board or Saved Ads view",
              "Click the bookmark — select boards to import and wait",
            ].map((text, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold">{i + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>

          <div className="flex items-center gap-3">
            <a
              href={atriaHref}
              onClick={(e) => e.preventDefault()}
              draggable
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm shadow-md hover:shadow-lg transition-shadow cursor-grab active:cursor-grabbing select-none"
            >
              <Bookmark className="h-4 w-4" />
              Export from Atria
            </a>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleCopy(atriaHref, "Atria bookmarklet")}>
              {copied === "Atria bookmarklet" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === "Atria bookmarklet" ? "Copied" : "Copy"}
            </Button>
          </div>
        </TabsContent>

        {/* ── Quick Save (single page) ── */}
        <TabsContent value="quicksave" className="space-y-4">
          <p className="font-body text-sm text-muted-foreground leading-relaxed">
            Save the current page as an ad — works on any Facebook Ads Library ad detail page. Captures video if playing.
          </p>

          <div className="flex items-center gap-3">
            <a
              href={quickSaveHref}
              onClick={(e) => e.preventDefault()}
              draggable
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm shadow-md hover:shadow-lg transition-shadow cursor-grab active:cursor-grabbing select-none"
            >
              <Bookmark className="h-4 w-4" />
              Quick Save
            </a>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleCopy(quickSaveHref, "Quick Save")}>
              {copied === "Quick Save" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === "Quick Save" ? "Copied" : "Copy"}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
        <p className="font-body text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Token refresh:</strong> Bookmarklets use your session token which expires periodically.
          If saving fails, come back here to grab a fresh bookmarklet.
        </p>
      </div>
    </div>
  );
}
