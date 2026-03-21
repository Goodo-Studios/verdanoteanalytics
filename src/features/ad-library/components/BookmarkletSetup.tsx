import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Bookmark, Copy, Check, ExternalLink, Video, Facebook, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* ────────────────────────────────────────────────────────
   Facebook bookmarklet — popup relay pattern.
   The bookmarklet only reads the DOM and opens a popup window
   to our app. No network requests from Facebook's page (CSP safe).
   Auth is handled by the popup using the user's existing session.
   ──────────────────────────────────────────────────────── */
function generateFacebookBookmarklet(appUrl: string) {
  const code = `(function(){
if(window.__vnActive){alert('Verdanote saver is already running.');return;}
if(!location.hostname.match(/facebook\\.com/)&&!location.hostname.match(/fb\\.com/)){alert('Navigate to Facebook Ads Library first.');return;}
window.__vnActive=true;
var APP='${appUrl}';
var popup=null;
function openPopup(){if(popup&&!popup.closed)return popup;popup=window.open(APP+'/bookmarklet-receiver','vn_saver','width=420,height=620,scrollbars=yes,resizable=yes');return popup;}
var tb=document.createElement('div');tb.id='vn-tb';
tb.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999999;background:#1a1a2e;color:#fff;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-family:-apple-system,sans-serif;font-size:14px;box-shadow:0 4px 24px rgba(0,0,0,.3);';
tb.innerHTML='<div style="display:flex;align-items:center;gap:10px"><span style="font-weight:700;color:#a78bfa">Verdanote</span><span id="vn-st" style="color:#a1a1aa">Scanning\\u2026</span></div><div style="display:flex;gap:8px"><button id="vn-sa" style="background:#7c3aed;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px">Save All Visible</button><button id="vn-x" style="background:transparent;color:#a1a1aa;border:none;padding:6px 10px;cursor:pointer;font-size:15px">\\u2715</button></div>';
document.body.appendChild(tb);document.body.style.marginTop=tb.offsetHeight+'px';
document.getElementById('vn-x').onclick=function(){tb.remove();document.body.style.marginTop='';document.querySelectorAll('.vn-btn').forEach(function(b){b.remove();});window.__vnActive=false;};
function decodeFb(h){if(!h)return null;try{if(h.indexOf('l.facebook.com')>-1||h.indexOf('lm.facebook.com')>-1)return decodeURIComponent(new URL(h).searchParams.get('u')||h);return h;}catch(e){return h;}}
function findCards(){var cards=[],seen=new Set();var spans=document.querySelectorAll('span');for(var i=0;i<spans.length;i++){if(/Library ID/i.test(spans[i].textContent)){var el=spans[i];for(var j=0;j<10;j++){if(!el.parentElement)break;el=el.parentElement;if(el.offsetHeight>200&&el.offsetWidth>250&&!seen.has(el)){seen.add(el);cards.push(el);break;}}}}if(cards.length===0){var links=document.querySelectorAll('a[href*="/ads/library/?id="]');for(var i=0;i<links.length;i++){var el=links[i];for(var j=0;j<10;j++){if(!el.parentElement)break;el=el.parentElement;if(el.offsetHeight>200&&el.offsetWidth>250&&!seen.has(el)){seen.add(el);cards.push(el);break;}}}}return cards;}
function extract(card){var d={platform:'facebook',ad_format:'image',advertiser_name:null,body_text:null,headline:null,cta_text:null,landing_page_url:null,started_running:null,source_url:null,thumbnail_url:null,media_urls:[],library_id:''};
var dl=card.querySelector('a[href*="/ads/library/?id="]');d.source_url=dl?dl.href:location.href;
try{d.library_id=new URL(d.source_url).searchParams.get('id')||'';}catch(e){}
var pLinks=card.querySelectorAll('a[href*="facebook.com/"]');for(var i=0;i<pLinks.length;i++){var t=pLinks[i].textContent.trim();if(t&&t.length>1&&t.length<100&&t.indexOf('Ad Library')<0&&pLinks[i].href.indexOf('/ads/library')<0){d.advertiser_name=t;break;}}
if(!d.advertiser_name){var h=card.querySelector('h2,h3,[role="heading"]');if(h)d.advertiser_name=h.textContent.trim();}
var btns=card.querySelectorAll('div[role="button"]');for(var i=0;i<btns.length;i++){if(/see more/i.test(btns[i].textContent)){try{btns[i].click();}catch(e){}}}
var longest='';var els=card.querySelectorAll('div,span,p');for(var i=0;i<els.length;i++){var t=els[i].textContent.trim();if(t.length>longest.length&&t.length>30&&t.length<5000&&t!==d.advertiser_name&&!/^(Started running|Active since|Inactive)/i.test(t)){longest=t;}}d.body_text=longest.substring(0,2000)||null;
var dm=card.textContent.match(/Started running on\\s+([A-Za-z]+ \\d{1,2},?\\s*\\d{4})/i);if(dm){try{var dt=new Date(dm[1]);if(!isNaN(dt.getTime()))d.started_running=dt.toISOString().split('T')[0];}catch(e){}}
var ctas=['Shop Now','Learn More','Sign Up','Download','Book Now','Get Offer','Subscribe','Apply Now','Watch More','Order Now','Contact Us','Install Now'];var cBtns=card.querySelectorAll('a,button,[role="button"]');for(var i=0;i<cBtns.length;i++){var ct=cBtns[i].textContent.trim();for(var j=0;j<ctas.length;j++){if(ct.toLowerCase().indexOf(ctas[j].toLowerCase())>-1){d.cta_text=ct;break;}}if(d.cta_text)break;}
var oLinks=card.querySelectorAll('a[href*="l.facebook.com"],a[href*="lm.facebook.com"]');for(var i=0;i<oLinks.length;i++){var dec=decodeFb(oLinks[i].href);if(dec&&dec.indexOf('facebook.com')<0){d.landing_page_url=dec;break;}}
var vid=card.querySelector('video');if(vid){d.ad_format='video';var vurl=vid.currentSrc||vid.src;if(!vurl){var src=card.querySelector('video source');if(src&&src.src)vurl=src.src;}if(vurl)d.media_urls.push(vurl);}
var imgs=card.querySelectorAll('img');var bestImg=null,bestSize=0;for(var i=0;i<imgs.length;i++){var w=imgs[i].naturalWidth||imgs[i].width||0;var h2=imgs[i].naturalHeight||imgs[i].height||0;if(w<100&&h2<100)continue;var par=imgs[i].parentElement;var br=par?getComputedStyle(par).borderRadius:'';if(br==='50%'||br==='9999px')continue;if(imgs[i].src){d.media_urls.push(imgs[i].src);var sz=w*h2;if(sz>bestSize){bestSize=sz;bestImg=imgs[i].src;}}}
d.thumbnail_url=bestImg||null;return d;}
function sendToPopup(ads){var p=openPopup();if(!p){alert('Popup blocked! Allow popups for Facebook, then try again.');return;}var attempts=0;var iv=setInterval(function(){attempts++;if(attempts>40){clearInterval(iv);alert('Popup did not load. Make sure you are signed into Verdanote.');return;}try{p.postMessage({type:'VERDANOTE_SAVE_AD',ads:ads},'*');}catch(e){}},500);window.addEventListener('message',function handler(ev){if(ev.data&&ev.data.type==='VERDANOTE_SAVE_COMPLETE'){clearInterval(iv);window.removeEventListener('message',handler);}});}
function saveOne(card,btn){btn.textContent='Sending\\u2026';btn.style.background='#6366f1';var data=extract(card);if(!data.library_id&&!data.advertiser_name){btn.textContent='No data';btn.style.background='#ef4444';return;}sendToPopup([data]);btn.textContent='Sent \\u2713';btn.style.background='#059669';}
function inject(){var cards=findCards();if(cards.length===0){setTimeout(function(){cards=findCards();if(cards.length===0){document.getElementById('vn-st').textContent='No ads found on this page.';return;}addBtns(cards);},2500);return;}addBtns(cards);}
function addBtns(cards){cards.forEach(function(card){if(card.querySelector('.vn-btn'))return;var cs=getComputedStyle(card);if(cs.position==='static')card.style.position='relative';var b=document.createElement('button');b.className='vn-btn';b.textContent='Save';b.style.cssText='position:absolute;top:8px;right:8px;z-index:99999;background:#059669;color:#fff;border:none;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:-apple-system,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);';b.onmouseenter=function(){b.style.background='#047857';};b.onmouseleave=function(){b.style.background='#059669';};b.onclick=function(e){e.stopPropagation();e.preventDefault();saveOne(card,b);};card.appendChild(b);});document.getElementById('vn-st').textContent='Ad Saver Active \\u2014 '+cards.length+' ads found';}
document.getElementById('vn-sa').onclick=function(){var cards=findCards();if(cards.length===0){alert('No ads found.');return;}var allData=[];cards.forEach(function(c){var data=extract(c);if(data.library_id||data.advertiser_name)allData.push(data);});if(allData.length===0){alert('Could not extract ad data.');return;}this.textContent='Sending '+allData.length+'\\u2026';this.style.background='#fbbf24';sendToPopup(allData);var self=this;setTimeout(function(){self.textContent='Sent '+allData.length+' \\u2713';self.style.background='#059669';cards.forEach(function(c){var b=c.querySelector('.vn-btn');if(b){b.textContent='Sent \\u2713';b.style.background='#059669';}});},1500);};
var st;window.addEventListener('scroll',function(){clearTimeout(st);st=setTimeout(inject,1500);});
inject();
})();`;

  return `javascript:${encodeURIComponent(code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*/g, "").replace(/\s{2,}/g, " ").trim())}`;
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

  const refreshToken = () => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token || null);
    });
  };

  useEffect(() => {
    refreshToken();
  }, []);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const appUrl = window.location.origin;

  const fbHref = generateFacebookBookmarklet(appUrl);
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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-base font-semibold mb-1">Save Ads with Bookmarklets</h3>
          <p className="font-body text-sm text-muted-foreground leading-relaxed">
            Drag a bookmarklet to your bookmarks bar, then click it on the source page to save ads.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => { refreshToken(); toast.success("Token refreshed"); }}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Token
        </Button>
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
              <strong className="text-foreground">No token needed.</strong> The bookmarklet extracts ad data from the page
              and sends it to a small Verdanote popup window that handles saving. Works as long as you&apos;re signed into Verdanote.
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
          <strong className="text-foreground">Facebook bookmarklet:</strong> No token refresh needed — it uses your active Verdanote session.
          <strong className="text-foreground ml-1">Atria &amp; Quick Save:</strong> These use your session token which expires periodically.
          If saving fails, click "Refresh Token" above and re-drag the bookmarklet.
        </p>
      </div>
    </div>
  );
}
