import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Bookmark, Copy, Check, ExternalLink, Video } from "lucide-react";
import { toast } from "sonner";

function generateBookmarkletCode(supabaseUrl: string, anonKey: string, token: string, appUrl: string) {
  // The bookmarklet now captures video blobs directly from the browser context
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
    d.media_urls=[];
    d.thumbnail_url=null;
    imgs.forEach(function(img){if(img.src&&img.naturalWidth>100){d.media_urls.push(img.src);if(!d.thumbnail_url)d.thumbnail_url=img.src;}});
    var ctaEl=document.querySelector('[class*="cta"]')||document.querySelector('a[class*="_7jyr"]');
    if(ctaEl)d.cta_text=ctaEl.innerText.trim();
    var linkEls=document.querySelectorAll('a[href*="l.facebook.com"]');
    if(linkEls.length>0){try{var u=new URL(linkEls[0].href);d.landing_page_url=u.searchParams.get('u')||linkEls[0].href;}catch(e){}}

    /* VIDEO CAPTURE: find video elements and fetch blob from browser context */
    var videoEl=document.querySelector('video');
    var videoSrc=videoEl?(videoEl.currentSrc||videoEl.src):null;
    if(!videoSrc){
      var sources=document.querySelectorAll('video source');
      for(var i=0;i<sources.length;i++){if(sources[i].src){videoSrc=sources[i].src;break;}}
    }

    var overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;top:20px;right:20px;z-index:999999;background:#1a1a2e;color:#fff;padding:16px 20px;border-radius:12px;font-family:-apple-system,sans-serif;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,.3);';

    if(videoSrc){
      overlay.innerText='Downloading video...';
      document.body.appendChild(overlay);
      fetch(videoSrc).then(function(r){return r.blob();}).then(function(blob){
        overlay.innerText='Uploading video ('+Math.round(blob.size/1024/1024)+'MB)...';
        var adId=Date.now().toString(36);
        var path=encodeURIComponent(adId+'/video.'+((blob.type||'').indexOf('mp4')>-1?'mp4':'webm'));
        return fetch(S+'/storage/v1/object/ad-media/'+path,{
          method:'POST',
          headers:{'Authorization':'Bearer '+T,'Content-Type':blob.type||'video/mp4','x-upsert':'true'},
          body:blob
        }).then(function(upResp){
          if(!upResp.ok)throw new Error('Upload failed: '+upResp.status);
          var publicUrl=S+'/storage/v1/object/public/ad-media/'+path;
          d.ad_format='video';
          d.stored_media=[{original_url:videoSrc,stored_url:publicUrl,type:'video',mime_type:blob.type||'video/mp4',file_size_bytes:blob.size,position:0}];
          return sendToQuickSave(d);
        });
      }).catch(function(e){
        console.error('Video capture failed:',e);
        overlay.innerText='Video capture failed, saving thumbnail only...';
        sendToQuickSave(d);
      });
    }else{
      overlay.innerText='Saving ad...';
      document.body.appendChild(overlay);
      sendToQuickSave(d);
    }

    function sendToQuickSave(data){
      var x=new XMLHttpRequest();
      x.open('POST',S+'/functions/v1/quick-save');
      x.setRequestHeader('Content-Type','application/json');
      x.setRequestHeader('Authorization','Bearer '+T);
      x.onload=function(){
        var r=JSON.parse(x.responseText);
        if(r.success){
          overlay.innerHTML='<span style="font-size:18px">\\u2713</span> '+(r.duplicate?'Already saved!':'Saved'+(data.ad_format==='video'?' with video':'')+' to Ad Library!')+'<br><a href="'+A+'/ad-library" target="_blank" style="color:#a78bfa;text-decoration:underline;font-size:12px">Open</a>';
        }else{
          overlay.innerHTML='<span style="font-size:18px">\\u2717</span> Save failed: '+(r.error||'Unknown');
          overlay.style.background='#7f1d1d';
        }
        setTimeout(function(){overlay.remove()},5000);
      };
      x.onerror=function(){overlay.innerText='Save failed';setTimeout(function(){overlay.remove()},3000);};
      x.send(JSON.stringify({url:url,extracted_data:data}));
    }
  }catch(e){alert('Quick Save error: '+e.message);}
})();`;

  return `javascript:${encodeURIComponent(code.replace(/\n\s*/g, ""))}`;
}

export function BookmarkletSetup() {
  const { user } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token || null);
    });
  }, []);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const appUrl = window.location.origin;

  const bookmarkletHref = token
    ? generateBookmarkletCode(supabaseUrl, anonKey, token, appUrl)
    : "#";

  const handleCopy = () => {
    if (!token) return;
    navigator.clipboard.writeText(bookmarkletHref);
    setCopied(true);
    toast.success("Bookmarklet code copied");
    setTimeout(() => setCopied(false), 2000);
  };

  if (!user || !token) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        Sign in to set up Quick Save.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-heading text-base font-semibold mb-1">Quick Save Bookmarklet</h3>
        <p className="font-body text-sm text-muted-foreground leading-relaxed">
          Save ads from the Facebook Ads Library with one click. For video ads, the bookmarklet
          will capture the actual video file directly from your browser.
        </p>
      </div>

      {/* Video capture callout */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3">
        <Video className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
        <p className="font-body text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Video capture:</strong> When used on a page with a playing video ad,
          the bookmarklet downloads the video file directly from your browser session (where Facebook's CDN URLs are valid)
          and uploads it to your library.
        </p>
      </div>

      {/* Instructions */}
      <ol className="space-y-3 font-body text-sm text-muted-foreground">
        <li className="flex gap-2.5">
          <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold">1</span>
          <span>Drag the button below to your browser's bookmarks bar.</span>
        </li>
        <li className="flex gap-2.5">
          <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold">2</span>
          <span>
            Browse the{" "}
            <a href="https://www.facebook.com/ads/library" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
              Facebook Ads Library <ExternalLink className="h-3 w-3" />
            </a>
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold">3</span>
          <span>Click the bookmarklet on any ad page to save it — videos included.</span>
        </li>
      </ol>

      {/* Bookmarklet drag target */}
      <div className="flex items-center gap-3">
        <a
          href={bookmarkletHref}
          onClick={(e) => e.preventDefault()}
          draggable
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm shadow-md hover:shadow-lg transition-shadow cursor-grab active:cursor-grabbing select-none"
        >
          <Bookmark className="h-4 w-4" />
          Save to Ad Library
        </a>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy Code"}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
        <p className="font-body text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Note:</strong> The bookmarklet uses your current session token.
          If it stops working, come back here to get a fresh one. Your token is never shared with third parties.
        </p>
      </div>
    </div>
  );
}
