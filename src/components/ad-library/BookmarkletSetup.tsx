import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Bookmark, Copy, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";

function generateBookmarkletCode(supabaseUrl: string, token: string, appUrl: string) {
  // This JS runs in the browser on the Facebook Ads Library page
  const code = `
(function(){
  var S='${supabaseUrl}';
  var T='${token}';
  var A='${appUrl}';
  try{
    var url=location.href;
    var d={};
    /* Extract advertiser name */
    var nameEl=document.querySelector('[class*="x1heor9g"]')||document.querySelector('h2')||document.querySelector('[role="heading"]');
    if(nameEl)d.advertiser_name=nameEl.innerText.trim();
    /* Extract ad body text */
    var bodyEls=document.querySelectorAll('[class*="_4ik4"]');
    if(bodyEls.length===0)bodyEls=document.querySelectorAll('[data-testid="ad_body"]');
    if(bodyEls.length>0)d.body_text=bodyEls[0].innerText.trim().substring(0,2000);
    /* Extract images */
    var imgs=document.querySelectorAll('img[src*="scontent"]');
    d.media_urls=[];
    d.thumbnail_url=null;
    imgs.forEach(function(img){if(img.src&&img.naturalWidth>100){d.media_urls.push(img.src);if(!d.thumbnail_url)d.thumbnail_url=img.src;}});
    /* Extract CTA */
    var ctaEl=document.querySelector('[class*="cta"]')||document.querySelector('a[class*="_7jyr"]');
    if(ctaEl)d.cta_text=ctaEl.innerText.trim();
    /* Extract landing page */
    var linkEls=document.querySelectorAll('a[href*="l.facebook.com"]');
    if(linkEls.length>0){try{var u=new URL(linkEls[0].href);d.landing_page_url=u.searchParams.get('u')||linkEls[0].href;}catch(e){}}
    /* Send to edge function */
    var x=new XMLHttpRequest();
    x.open('POST',S+'/functions/v1/quick-save');
    x.setRequestHeader('Content-Type','application/json');
    x.setRequestHeader('Authorization','Bearer '+T);
    x.onload=function(){
      var r=JSON.parse(x.responseText);
      var n=document.createElement('div');
      n.style.cssText='position:fixed;top:20px;right:20px;z-index:999999;background:#1a1a2e;color:#fff;padding:16px 20px;border-radius:12px;font-family:-apple-system,sans-serif;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,.3);display:flex;align-items:center;gap:10px;';
      if(r.success){
        n.innerHTML='<span style="font-size:18px">✓</span><span>'+(r.duplicate?'Already saved!':'Saved to Ad Library!')+'</span><a href="'+A+'/ad-library" target="_blank" style="color:#a78bfa;margin-left:8px;text-decoration:underline">Open</a>';
      }else{
        n.innerHTML='<span style="font-size:18px">✗</span><span>Save failed: '+(r.error||'Unknown')+'</span>';
        n.style.background='#7f1d1d';
      }
      document.body.appendChild(n);
      setTimeout(function(){n.remove()},4000);
    };
    x.onerror=function(){alert('Quick Save failed — check your connection.');};
    x.send(JSON.stringify({url:url,extracted_data:d}));
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
  const appUrl = window.location.origin;

  const bookmarkletHref = token
    ? generateBookmarkletCode(supabaseUrl, token, appUrl)
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
          Save ads from the Facebook Ads Library with one click — no copy-pasting URLs.
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
          <span>Click the bookmarklet on any ad page to instantly save it.</span>
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
