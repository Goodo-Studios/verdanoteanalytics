import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Bookmark, Copy, Check, ExternalLink, Video, Facebook, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* ────────────────────────────────────────────────────────
   Facebook bookmarklet — fully inlined, no external scripts.
   Facebook CSP blocks loading external JS so everything
   must live inside the javascript: URL.
   ──────────────────────────────────────────────────────── */
function generateFacebookBookmarklet(supabaseUrl: string, token: string, appUrl: string) {
  // The entire saver script is inlined.  We use single-quotes inside the
  // template and avoid backticks so the result can safely live in an href.
  const code = `(function(){
if(window.__vnActive){alert('Verdanote saver is already active.');return;}
window.__vnActive=true;
var S='${supabaseUrl}',T='${token}',A='${appUrl}';
var delay=function(ms){return new Promise(function(r){setTimeout(r,ms);});};

/* ── toolbar ── */
var tb=document.createElement('div');
tb.id='vn-tb';
tb.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999999;background:#1a1a2e;color:#fff;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-family:-apple-system,sans-serif;font-size:14px;box-shadow:0 4px 24px rgba(0,0,0,.3);';
tb.innerHTML='<div style="display:flex;align-items:center;gap:10px"><span style="font-weight:700;color:#a78bfa">Verdanote</span><span id="vn-status" style="color:#a1a1aa">Scanning for ads\\u2026</span></div><div style="display:flex;gap:8px"><button id="vn-sa" style="background:#7c3aed;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px">Save All Visible</button><button id="vn-x" style="background:transparent;color:#a1a1aa;border:none;padding:6px 10px;cursor:pointer;font-size:15px">\\u2715</button></div>';
document.body.appendChild(tb);
document.body.style.marginTop=tb.offsetHeight+'px';

document.getElementById('vn-x').onclick=function(){
  tb.remove();document.body.style.marginTop='';
  document.querySelectorAll('.vn-btn').forEach(function(b){b.remove();});
  window.__vnActive=false;
};

/* ── find ad cards ── */
function findCards(){
  var cards=[],seen=new Set();
  var spans=document.querySelectorAll('span');
  for(var i=0;i<spans.length;i++){
    if(/Library ID/i.test(spans[i].textContent)){
      var el=spans[i];
      for(var j=0;j<10;j++){
        if(!el.parentElement)break;
        el=el.parentElement;
        if(el.offsetHeight>200&&el.offsetWidth>250&&!seen.has(el)){
          seen.add(el);cards.push(el);break;
        }
      }
    }
  }
  if(cards.length===0){
    var links=document.querySelectorAll('a[href*="/ads/library/?id="]');
    for(var i=0;i<links.length;i++){
      var el=links[i];
      for(var j=0;j<10;j++){
        if(!el.parentElement)break;
        el=el.parentElement;
        if(el.offsetHeight>200&&el.offsetWidth>250&&!seen.has(el)){
          seen.add(el);cards.push(el);break;
        }
      }
    }
  }
  return cards;
}

/* ── decode fb redirect links ── */
function decodeFb(href){
  if(!href)return null;
  try{
    if(href.indexOf('l.facebook.com')>-1||href.indexOf('lm.facebook.com')>-1){
      return decodeURIComponent(new URL(href).searchParams.get('u')||href);
    }
    return href;
  }catch(e){return href;}
}

/* ── extract data from one card ── */
function extract(card){
  var d={platform:'facebook',ad_format:'image',advertiser_name:null,body_text:null,headline:null,cta_text:null,landing_page_url:null,started_running:null,source_url:null,thumbnail_url:null,media_urls:[],stored_media:[]};

  /* source url */
  var dl=card.querySelector('a[href*="/ads/library/?id="]');
  d.source_url=dl?dl.href:location.href;

  /* advertiser */
  var pLinks=card.querySelectorAll('a[href*="facebook.com/"]');
  for(var i=0;i<pLinks.length;i++){
    var t=pLinks[i].textContent.trim();
    if(t&&t.length>1&&t.length<100&&t.indexOf('Ad Library')<0&&pLinks[i].href.indexOf('/ads/library')<0){d.advertiser_name=t;break;}
  }
  if(!d.advertiser_name){var h=card.querySelector('h2,h3,[role="heading"]');if(h)d.advertiser_name=h.textContent.trim();}

  /* expand see-more */
  var btns=card.querySelectorAll('div[role="button"]');
  for(var i=0;i<btns.length;i++){if(/see more/i.test(btns[i].textContent)){try{btns[i].click();}catch(e){}}}

  /* body text */
  var longest='';
  var els=card.querySelectorAll('div,span,p');
  for(var i=0;i<els.length;i++){
    var t=els[i].textContent.trim();
    if(t.length>longest.length&&t.length>30&&t.length<5000&&t!==d.advertiser_name&&!/^(Started running|Active since|Inactive)/i.test(t)){longest=t;}
  }
  d.body_text=longest.substring(0,2000)||null;

  /* date */
  var dm=card.textContent.match(/Started running on\\s+([A-Za-z]+ \\d{1,2},?\\s*\\d{4})/i);
  if(dm){try{var dt=new Date(dm[1]);if(!isNaN(dt.getTime()))d.started_running=dt.toISOString().split('T')[0];}catch(e){}}

  /* cta */
  var ctas=['Shop Now','Learn More','Sign Up','Download','Book Now','Get Offer','Subscribe','Apply Now','Watch More','Order Now','Contact Us','Install Now'];
  var cBtns=card.querySelectorAll('a,button,[role="button"]');
  for(var i=0;i<cBtns.length;i++){var ct=cBtns[i].textContent.trim();for(var j=0;j<ctas.length;j++){if(ct.toLowerCase().indexOf(ctas[j].toLowerCase())>-1){d.cta_text=ct;break;}}if(d.cta_text)break;}

  /* landing page */
  var oLinks=card.querySelectorAll('a[href*="l.facebook.com"],a[href*="lm.facebook.com"]');
  for(var i=0;i<oLinks.length;i++){var dec=decodeFb(oLinks[i].href);if(dec&&dec.indexOf('facebook.com')<0){d.landing_page_url=dec;break;}}

  /* video */
  var vid=card.querySelector('video');
  if(vid){
    d.ad_format='video';
    var vurl=vid.currentSrc||vid.src;
    if(!vurl){var src=card.querySelector('video source');if(src&&src.src)vurl=src.src;}
    if(vurl)d.media_urls.push(vurl);
  }

  /* images — skip small avatars */
  var imgs=card.querySelectorAll('img');
  var bestImg=null,bestSize=0;
  for(var i=0;i<imgs.length;i++){
    var w=imgs[i].naturalWidth||imgs[i].width||0;
    var h=imgs[i].naturalHeight||imgs[i].height||0;
    if(w<100&&h<100)continue;
    var par=imgs[i].parentElement;
    var br=par?getComputedStyle(par).borderRadius:'';
    if(br==='50%'||br==='9999px')continue;
    if(imgs[i].src){d.media_urls.push(imgs[i].src);var sz=w*h;if(sz>bestSize){bestSize=sz;bestImg=imgs[i].src;}}
  }
  d.thumbnail_url=bestImg||null;
  return d;
}

/* ── try to trigger video playback ── */
async function loadVideo(card){
  var v=card.querySelector('video');
  if(v&&(v.currentSrc||v.src))return;
  var pbs=card.querySelectorAll('[aria-label*="Play"],[aria-label*="play"],[role="button"]');
  for(var i=0;i<pbs.length;i++){
    var lbl=(pbs[i].getAttribute('aria-label')||pbs[i].textContent||'').toLowerCase();
    if(lbl.indexOf('play')>-1){pbs[i].click();break;}
  }
  for(var i=0;i<12;i++){
    await delay(500);
    v=card.querySelector('video');
    if(v&&(v.currentSrc||v.src))return;
  }
}

/* ── upload blob to storage from browser ── */
async function uploadBlob(blob,adId,name,contentType){
  var path=encodeURIComponent(adId+'/'+name);
  var resp=await fetch(S+'/storage/v1/object/ad-media/'+path,{
    method:'POST',
    headers:{'Authorization':'Bearer '+T,'Content-Type':contentType,'x-upsert':'true'},
    body:blob
  });
  if(!resp.ok)return null;
  return S+'/storage/v1/object/public/ad-media/'+adId+'/'+name;
}

/* ── save one ad ── */
async function saveAd(card,btn){
  btn.textContent='Saving\\u2026';btn.style.background='#6366f1';btn.disabled=true;
  try{
    await loadVideo(card);
    var d=extract(card);
    var adId=Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    var storedMedia=[];

    /* upload video blob from browser context */
    var vidUrl=null;
    if(d.ad_format==='video'){
      var vidSrc=card.querySelector('video');
      var vurl=vidSrc?(vidSrc.currentSrc||vidSrc.src):null;
      if(vurl){
        btn.textContent='Downloading video\\u2026';
        try{
          var vr=await fetch(vurl);
          if(vr.ok){
            var vblob=await vr.blob();
            if(vblob.size>1000&&vblob.size<200*1024*1024){
              btn.textContent='Uploading video ('+Math.round(vblob.size/1024/1024)+'MB)\\u2026';
              var ext=(vblob.type||'').indexOf('mp4')>-1?'mp4':'webm';
              var storedUrl=await uploadBlob(vblob,adId,'video.'+ext,vblob.type||'video/mp4');
              if(storedUrl){storedMedia.push({original_url:vurl,stored_url:storedUrl,type:'video',mime_type:vblob.type||'video/mp4',file_size_bytes:vblob.size,position:0});}
            }
          }
        }catch(e){console.error('VN video err',e);}
      }
    }

    /* upload thumbnail / main image */
    var imgUrl=d.thumbnail_url||(d.media_urls.length?d.media_urls[0]:null);
    if(imgUrl){
      try{
        var ir=await fetch(imgUrl);
        if(ir.ok){
          var iblob=await ir.blob();
          if(iblob.size>1000){
            var iext=(iblob.type||'').indexOf('png')>-1?'png':'jpg';
            var iStored=await uploadBlob(iblob,adId,'thumbnail.'+iext,iblob.type||'image/jpeg');
            if(iStored){
              storedMedia.push({original_url:imgUrl,stored_url:iStored,type:d.ad_format==='video'?'video_thumbnail':'image',mime_type:iblob.type||'image/jpeg',file_size_bytes:iblob.size,position:storedMedia.length});
              d.thumbnail_url=iStored;
            }
          }
        }
      }catch(e){console.error('VN img err',e);}
    }

    d.stored_media=storedMedia;

    /* send to quick-save */
    var resp=await fetch(S+'/functions/v1/quick-save',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+T},
      body:JSON.stringify({url:d.source_url,extracted_data:d})
    });
    var result=await resp.json();
    if(result.success){
      btn.textContent=result.duplicate?'Already saved':'Saved \\u2713';
      btn.style.background=result.duplicate?'#1e40af':'#059669';
      return true;
    }else{
      btn.textContent='Failed';btn.style.background='#991b1b';return false;
    }
  }catch(e){
    console.error('VN save err',e);
    btn.textContent='Error';btn.style.background='#991b1b';return false;
  }
}

/* ── inject save buttons ── */
function inject(){
  var cards=findCards();
  if(cards.length===0){
    setTimeout(function(){
      cards=findCards();
      if(cards.length===0){document.getElementById('vn-status').textContent='No ads found. Make sure ads are visible on this page.';return;}
      addBtns(cards);
    },2500);
    return;
  }
  addBtns(cards);
}

function addBtns(cards){
  cards.forEach(function(card){
    if(card.querySelector('.vn-btn'))return;
    var cs=getComputedStyle(card);if(cs.position==='static')card.style.position='relative';
    var b=document.createElement('button');
    b.className='vn-btn';
    b.textContent='Save';
    b.style.cssText='position:absolute;top:8px;right:8px;z-index:99999;background:#059669;color:#fff;border:none;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:-apple-system,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);';
    b.onclick=function(e){e.stopPropagation();e.preventDefault();saveAd(card,b);};
    card.appendChild(b);
  });
  document.getElementById('vn-status').textContent='Ad Saver Active \\u2014 '+cards.length+' ads found';
}

/* save all */
document.getElementById('vn-sa').onclick=async function(){
  var cards=findCards();if(cards.length===0){alert('No ads found.');return;}
  this.disabled=true;this.textContent='Saving\\u2026';
  var ok=0,fail=0;
  for(var i=0;i<cards.length;i++){
    document.getElementById('vn-status').textContent='Saving '+(i+1)+' of '+cards.length+'\\u2026';
    var btn=cards[i].querySelector('.vn-btn');
    if(btn&&(btn.textContent==='Saved \\u2713'||btn.textContent==='Already saved'))continue;
    if(!btn){btn=document.createElement('button');btn.className='vn-btn';btn.style.cssText='display:none';cards[i].appendChild(btn);}
    var r=await saveAd(cards[i],btn);
    if(r)ok++;else fail++;
    await delay(800);
  }
  document.getElementById('vn-status').textContent='Done! '+ok+' saved'+(fail?' ('+fail+' failed)':'');
  this.textContent='Done';
};

/* re-scan on scroll */
var scrollTimer;
window.addEventListener('scroll',function(){
  clearTimeout(scrollTimer);
  scrollTimer=setTimeout(inject,1500);
});

inject();
})();`;

  return `javascript:${encodeURIComponent(code.replace(/\n\s*/g, ""))}`;
}

function generateAtriaBookmarklet(supabaseUrl: string, anonKey: string, token: string, appUrl: string) {
  const code = `(function(){window.__ADVAULT_ATRIA_CONFIG={importUrl:'${supabaseUrl}/functions/v1/import-ads',authToken:'${token}'};var s=document.createElement('script');s.src='${appUrl}/atria-export-bookmarklet.js?t='+Date.now();document.head.appendChild(s);})();`;
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
              <strong className="text-foreground">Captures videos directly from your browser.</strong> Since this runs
              on Facebook's page in your authenticated session, it can download actual video files &mdash; no server scraping needed.
              All code is self-contained (no external scripts loaded).
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
          If saving fails, click "Refresh Token" above and re-drag the bookmarklet to your bookmarks bar.
        </p>
      </div>
    </div>
  );
}
