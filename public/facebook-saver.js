(function () {
  "use strict";

  // ── Config (injected by loader bookmarklet) ──
  const cfg = window.__VERDANOTE_FB_CONFIG || {};
  const SUPABASE_URL = cfg.supabaseUrl;
  const AUTH_TOKEN = cfg.authToken;
  const APP_URL = cfg.appUrl || "";

  if (!SUPABASE_URL || !AUTH_TOKEN) {
    alert("Verdanote: Missing configuration. Please copy a fresh bookmarklet from your Ad Library.");
    return;
  }

  if (window.__VERDANOTE_FB_ACTIVE) {
    alert("Verdanote Ad Saver is already active on this page.");
    return;
  }
  window.__VERDANOTE_FB_ACTIVE = true;

  if (!location.hostname.includes("facebook.com")) {
    alert("Please navigate to facebook.com/ads/library first.");
    window.__VERDANOTE_FB_ACTIVE = false;
    return;
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── Styles ──
  const STYLE = document.createElement("style");
  STYLE.textContent = `
    #vn-toolbar { position:fixed; top:0; left:0; right:0; z-index:999999; background:#1a1a2e;
      color:#fff; display:flex; align-items:center; justify-content:space-between;
      padding:8px 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:14px; box-shadow:0 4px 24px rgba(0,0,0,.3); }
    #vn-toolbar button { border:none; cursor:pointer; font-family:inherit; font-size:13px;
      border-radius:6px; padding:6px 14px; font-weight:600; transition:all .15s; }
    #vn-toolbar .vn-primary { background:#7c3aed; color:#fff; }
    #vn-toolbar .vn-primary:hover { background:#6d28d9; }
    #vn-toolbar .vn-ghost { background:transparent; color:#a1a1aa; padding:6px 10px; }
    #vn-toolbar .vn-ghost:hover { color:#fff; }
    .vn-save-btn { position:absolute !important; top:8px; right:8px; z-index:99999 !important;
      background:#059669 !important; color:#fff !important; border:none !important;
      border-radius:6px !important; padding:5px 12px !important; font-size:12px !important;
      font-weight:600 !important; cursor:pointer !important; font-family:-apple-system,sans-serif !important;
      box-shadow:0 2px 8px rgba(0,0,0,.2) !important; transition:all .15s !important; line-height:1.4 !important; }
    .vn-save-btn:hover { background:#047857 !important; transform:scale(1.05); }
    .vn-save-btn.vn-saving { background:#6366f1 !important; pointer-events:none; }
    .vn-save-btn.vn-saved { background:#1e40af !important; pointer-events:none; }
    .vn-save-btn.vn-failed { background:#991b1b !important; }
    #vn-progress { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:9999999;
      background:#1a1a2e; color:#fff; padding:24px 32px; border-radius:14px;
      font-family:-apple-system,sans-serif; font-size:14px; box-shadow:0 8px 40px rgba(0,0,0,.5);
      min-width:320px; text-align:center; }
    #vn-progress .vn-bar { height:6px; background:#333; border-radius:3px; margin:12px 0; overflow:hidden; }
    #vn-progress .vn-bar-fill { height:100%; background:#7c3aed; border-radius:3px; transition:width .3s; }
  `;
  document.head.appendChild(STYLE);

  // ── Toolbar ──
  const toolbar = document.createElement("div");
  toolbar.id = "vn-toolbar";
  toolbar.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-weight:700;color:#a78bfa">Verdanote</span>
      <span style="color:#a1a1aa">Ad Saver Active — click Save on any ad</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <button id="vn-save-all" class="vn-primary">Save All Visible</button>
      <button id="vn-close" class="vn-ghost">✕</button>
    </div>
  `;
  document.body.appendChild(toolbar);
  // push page content down
  document.body.style.marginTop = (toolbar.offsetHeight) + "px";

  document.getElementById("vn-close").addEventListener("click", cleanup);

  function cleanup() {
    toolbar.remove();
    STYLE.remove();
    document.body.style.marginTop = "";
    document.querySelectorAll(".vn-save-btn").forEach((b) => b.remove());
    window.__VERDANOTE_FB_ACTIVE = false;
  }

  // ── Helpers ──
  function decodeFbLink(href) {
    if (!href) return null;
    try {
      if (href.includes("l.facebook.com") || href.includes("lm.facebook.com")) {
        const u = new URL(href);
        return decodeURIComponent(u.searchParams.get("u") || href);
      }
      return href;
    } catch { return href; }
  }

  function getAdSourceUrl(card) {
    // Look for "See ad details" or similar link containing an ad ID
    const detailLinks = card.querySelectorAll('a[href*="/ads/library/?id="], a[href*="ads/library/?id="]');
    if (detailLinks.length > 0) return detailLinks[0].href;
    // Try current page URL if it has an id param
    const pageUrl = new URL(location.href);
    const id = pageUrl.searchParams.get("id");
    if (id) return location.href;
    // Fallback: generate a unique one
    return "fb-save-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  // ── Extract data from one ad card ──
  function extractAdData(card) {
    const data = {
      advertiserName: null,
      bodyText: null,
      headline: null,
      ctaText: null,
      landingPageUrl: null,
      startDate: null,
      sourceUrl: null,
      platform: "facebook",
      media: { type: "image", urls: [], videoUrl: null, thumbnailUrl: null },
    };

    // Source URL
    data.sourceUrl = getAdSourceUrl(card);

    // Advertiser name: typically a link to a Facebook page near the top
    const pageLinks = card.querySelectorAll('a[href*="facebook.com/"]');
    for (const a of pageLinks) {
      const text = a.textContent.trim();
      if (text && text.length > 1 && text.length < 100 && !text.includes("Ad Library") && !a.href.includes("/ads/library")) {
        data.advertiserName = text;
        break;
      }
    }
    // Fallback: heading elements
    if (!data.advertiserName) {
      const h = card.querySelector('h2, h3, [role="heading"]');
      if (h) data.advertiserName = h.textContent.trim();
    }

    // Expand "See more" if present
    const seeMore = card.querySelectorAll('div[role="button"]');
    for (const btn of seeMore) {
      if (/see more/i.test(btn.textContent)) {
        try { btn.click(); } catch {}
      }
    }

    // Body text: find the longest text block
    const textBlocks = card.querySelectorAll("div, span, p");
    let longestText = "";
    for (const el of textBlocks) {
      // Only direct text children, skip nesting
      const text = el.textContent.trim();
      if (text.length > longestText.length && text.length > 30 && text.length < 5000) {
        // Skip if it's the advertiser name, a date, or a label
        if (text !== data.advertiserName && !/^(Started running|Active since|Inactive)/i.test(text)) {
          longestText = text;
        }
      }
    }
    data.bodyText = longestText.substring(0, 2000) || null;

    // Start date
    const allText = card.textContent;
    const dateMatch = allText.match(/Started running on\s+([A-Za-z]+ \d{1,2},? \d{4})/i) ||
      allText.match(/Active since\s+([A-Za-z]+ \d{1,2},? \d{4})/i);
    if (dateMatch) {
      try {
        const d = new Date(dateMatch[1]);
        if (!isNaN(d.getTime())) data.startDate = d.toISOString().split("T")[0];
      } catch {}
    }

    // CTA text
    const ctaKeywords = ["Shop Now", "Learn More", "Sign Up", "Download", "Book Now", "Get Offer", "Subscribe", "Apply Now", "Watch More", "Order Now", "Contact Us"];
    for (const btn of card.querySelectorAll("a, button, [role='button']")) {
      const t = btn.textContent.trim();
      if (ctaKeywords.some((kw) => t.toLowerCase().includes(kw.toLowerCase()))) {
        data.ctaText = t;
        break;
      }
    }

    // Landing page URL
    const outboundLinks = card.querySelectorAll('a[href*="l.facebook.com"], a[href*="lm.facebook.com"]');
    for (const a of outboundLinks) {
      const decoded = decodeFbLink(a.href);
      if (decoded && !decoded.includes("facebook.com")) {
        data.landingPageUrl = decoded;
        break;
      }
    }

    // ── Media extraction ──
    // Check for video FIRST
    const videoEl = card.querySelector("video");
    if (videoEl) {
      data.media.type = "video";
      data.media.videoUrl = videoEl.currentSrc || videoEl.src || null;
      data.media.thumbnailUrl = videoEl.poster || null;
      // Check <source> tags
      if (!data.media.videoUrl) {
        const source = card.querySelector("video source");
        if (source && source.src) data.media.videoUrl = source.src;
      }
    }

    // Collect large images (creative, not avatars)
    const imgs = card.querySelectorAll("img");
    for (const img of imgs) {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w < 100 && h < 100) continue;
      // Skip circular avatars
      const parent = img.parentElement;
      const style = parent ? getComputedStyle(parent).borderRadius : "";
      if (style === "50%" || style === "9999px") continue;
      if (img.src) data.media.urls.push(img.src);
    }

    // Set thumbnail for image ads
    if (data.media.type === "image" && data.media.urls.length > 0) {
      data.media.thumbnailUrl = data.media.urls[0];
    }

    // Platform detection
    const platformText = card.textContent.toLowerCase();
    if (platformText.includes("instagram") && !platformText.includes("facebook")) {
      data.platform = "instagram";
    }

    return data;
  }

  // ── Upload video blob to Supabase Storage from browser ──
  async function uploadVideoBlob(videoUrl) {
    if (!videoUrl) return null;
    try {
      const resp = await fetch(videoUrl);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (blob.size > 200 * 1024 * 1024) return null; // 200MB limit

      const ext = (blob.type || "").includes("mp4") ? "mp4" : "webm";
      const adId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const path = adId + "/video." + ext;

      const upResp = await fetch(SUPABASE_URL + "/storage/v1/object/ad-media/" + encodeURIComponent(path), {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + AUTH_TOKEN,
          "Content-Type": blob.type || "video/mp4",
          "x-upsert": "true",
        },
        body: blob,
      });

      if (!upResp.ok) return null;
      const publicUrl = SUPABASE_URL + "/storage/v1/object/public/ad-media/" + path;
      return {
        stored_url: publicUrl,
        original_url: videoUrl,
        type: "video",
        mime_type: blob.type || "video/mp4",
        file_size_bytes: blob.size,
        position: 0,
      };
    } catch (e) {
      console.error("Verdanote: video upload failed", e);
      return null;
    }
  }

  // ── Upload image to Supabase Storage from browser ──
  async function uploadImageBlob(imageUrl, position) {
    if (!imageUrl) return null;
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) return null;
      const blob = await resp.blob();

      const ext = (blob.type || "").includes("png") ? "png" : "jpg";
      const adId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const path = adId + "/" + position + "_image." + ext;

      const upResp = await fetch(SUPABASE_URL + "/storage/v1/object/ad-media/" + encodeURIComponent(path), {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + AUTH_TOKEN,
          "Content-Type": blob.type || "image/jpeg",
          "x-upsert": "true",
        },
        body: blob,
      });

      if (!upResp.ok) return null;
      const publicUrl = SUPABASE_URL + "/storage/v1/object/public/ad-media/" + path;
      return {
        stored_url: publicUrl,
        original_url: imageUrl,
        type: "image",
        mime_type: blob.type || "image/jpeg",
        file_size_bytes: blob.size,
        position: position,
      };
    } catch (e) {
      console.error("Verdanote: image upload failed", e);
      return null;
    }
  }

  // ── Try to trigger video playback if needed ──
  async function ensureVideoLoaded(card) {
    let videoEl = card.querySelector("video");
    if (videoEl && (videoEl.currentSrc || videoEl.src)) return;

    // Try clicking play buttons
    const playBtns = card.querySelectorAll('[aria-label="Play"], [aria-label="Play video"], [data-testid*="play"], [role="button"]');
    for (const btn of playBtns) {
      const label = (btn.getAttribute("aria-label") || btn.textContent || "").toLowerCase();
      if (label.includes("play")) {
        btn.click();
        break;
      }
    }

    // Wait for video to appear
    for (let i = 0; i < 12; i++) {
      await delay(500);
      videoEl = card.querySelector("video");
      if (videoEl && (videoEl.currentSrc || videoEl.src)) return;
    }
  }

  // ── Save a single ad ──
  async function saveAd(card, btn) {
    btn.textContent = "Saving...";
    btn.classList.add("vn-saving");

    try {
      // Try to load video if play button exists
      await ensureVideoLoaded(card);

      const data = extractAdData(card);
      const storedMedia = [];

      // Upload video from browser
      if (data.media.type === "video" && data.media.videoUrl) {
        btn.textContent = "Uploading video...";
        const videoResult = await uploadVideoBlob(data.media.videoUrl);
        if (videoResult) storedMedia.push(videoResult);
      }

      // Upload thumbnail/main image from browser
      const imgUrl = data.media.thumbnailUrl || (data.media.urls.length > 0 ? data.media.urls[0] : null);
      if (imgUrl) {
        const imgResult = await uploadImageBlob(imgUrl, storedMedia.length);
        if (imgResult) {
          imgResult.type = data.media.type === "video" ? "video_thumbnail" : "image";
          storedMedia.push(imgResult);
        }
      }

      // Send to Verdanote
      const payload = {
        url: data.sourceUrl,
        extracted_data: {
          advertiser_name: data.advertiserName,
          body_text: data.bodyText,
          headline: data.headline,
          cta_text: data.ctaText,
          landing_page_url: data.landingPageUrl,
          started_running: data.startDate,
          platform: data.platform,
          ad_format: data.media.type,
          thumbnail_url: storedMedia.find((m) => m.type === "image" || m.type === "video_thumbnail")?.stored_url || data.media.thumbnailUrl,
          media_urls: data.media.urls,
          stored_media: storedMedia,
        },
      };

      const resp = await fetch(SUPABASE_URL + "/functions/v1/quick-save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + AUTH_TOKEN,
        },
        body: JSON.stringify(payload),
      });

      const result = await resp.json();
      if (result.success) {
        btn.textContent = result.duplicate ? "Already saved" : "Saved ✓";
        btn.classList.remove("vn-saving");
        btn.classList.add("vn-saved");
        return { success: true, duplicate: !!result.duplicate };
      } else {
        btn.textContent = "Failed";
        btn.classList.remove("vn-saving");
        btn.classList.add("vn-failed");
        return { success: false };
      }
    } catch (e) {
      console.error("Verdanote: save failed", e);
      btn.textContent = "Error";
      btn.classList.remove("vn-saving");
      btn.classList.add("vn-failed");
      return { success: false };
    }
  }

  // ── Find ad cards on the page ──
  function findAdCards() {
    // Facebook Ads Library renders ads in various containers
    // Look for containers that have ad-like content (images, text, dates)
    const candidates = [];

    // Strategy 1: divs with "Started running" text nearby (strong signal)
    const allDivs = document.querySelectorAll("div");
    const processed = new Set();
    for (const div of allDivs) {
      if (div.textContent && /Started running on/i.test(div.textContent)) {
        // Walk up to find the ad card container
        let container = div;
        for (let i = 0; i < 8; i++) {
          if (!container.parentElement) break;
          container = container.parentElement;
          // Card containers usually have specific dimensions/shadows
          const style = getComputedStyle(container);
          if (
            (style.boxShadow && style.boxShadow !== "none") ||
            (container.querySelector("img") && container.querySelector("video")) ||
            container.querySelectorAll("img").length >= 1
          ) {
            if (!processed.has(container)) {
              processed.add(container);
              candidates.push(container);
            }
            break;
          }
        }
      }
    }

    // Strategy 2: if no cards found, look for common ad card patterns
    if (candidates.length === 0) {
      // Try aria labels or role attributes
      const cards = document.querySelectorAll('[role="article"], [data-testid*="ad_card"]');
      cards.forEach((c) => {
        if (!processed.has(c)) {
          processed.add(c);
          candidates.push(c);
        }
      });
    }

    return candidates;
  }

  // ── Inject save buttons on each ad card ──
  function injectSaveButtons() {
    const cards = findAdCards();
    let injected = 0;

    for (const card of cards) {
      if (card.querySelector(".vn-save-btn")) continue; // already has button

      // Make card position relative for absolute button placement
      const style = getComputedStyle(card);
      if (style.position === "static") card.style.position = "relative";

      const btn = document.createElement("button");
      btn.className = "vn-save-btn";
      btn.textContent = "Save to Verdanote";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        saveAd(card, btn);
      });
      card.appendChild(btn);
      injected++;
    }

    return injected;
  }

  // ── Save All Visible ──
  async function saveAllVisible() {
    const cards = findAdCards();
    if (cards.length === 0) {
      alert("Verdanote: No ads found on this page. Try scrolling down to load more.");
      return;
    }

    // Show progress modal
    const progress = document.createElement("div");
    progress.id = "vn-progress";
    progress.innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:8px">Saving ${cards.length} ads to Verdanote</div>
      <div id="vn-prog-text">Preparing...</div>
      <div class="vn-bar"><div class="vn-bar-fill" id="vn-prog-bar" style="width:0%"></div></div>
      <div id="vn-prog-stats" style="font-size:12px;color:#a1a1aa"></div>
    `;
    document.body.appendChild(progress);

    const textEl = document.getElementById("vn-prog-text");
    const barEl = document.getElementById("vn-prog-bar");
    const statsEl = document.getElementById("vn-prog-stats");

    let saved = 0, duplicates = 0, failed = 0, videos = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const pct = Math.round(((i + 1) / cards.length) * 100);
      textEl.textContent = `Saving ad ${i + 1} of ${cards.length}...`;
      barEl.style.width = pct + "%";

      // Scroll card into view
      card.scrollIntoView({ behavior: "instant", block: "center" });
      await delay(300);

      // Ensure save button exists
      let btn = card.querySelector(".vn-save-btn");
      if (!btn) {
        const style = getComputedStyle(card);
        if (style.position === "static") card.style.position = "relative";
        btn = document.createElement("button");
        btn.className = "vn-save-btn";
        card.appendChild(btn);
      }

      if (btn.classList.contains("vn-saved")) {
        duplicates++;
        continue;
      }

      const hasVideo = !!card.querySelector("video") || !!card.querySelector('[aria-label="Play"]');
      if (hasVideo) videos++;

      const result = await saveAd(card, btn);
      if (result.success) {
        if (result.duplicate) duplicates++;
        else saved++;
      } else {
        failed++;
      }

      statsEl.textContent = `${saved} saved · ${videos} videos · ${duplicates} duplicates · ${failed} failed`;

      // Delay between ads
      await delay(hasVideo ? 2000 : 500);
    }

    // Final result
    progress.innerHTML = `
      <div style="font-size:22px;margin-bottom:8px">🎉</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:12px">Import Complete!</div>
      <div style="display:flex;gap:12px;justify-content:center;margin-bottom:16px">
        <div style="text-align:center;background:#222;padding:8px 16px;border-radius:8px">
          <div style="font-size:20px;font-weight:700;color:#a78bfa">${saved}</div>
          <div style="font-size:11px;color:#a1a1aa">Saved</div>
        </div>
        <div style="text-align:center;background:#222;padding:8px 16px;border-radius:8px">
          <div style="font-size:20px;font-weight:700;color:#60a5fa">${videos}</div>
          <div style="font-size:11px;color:#a1a1aa">Videos</div>
        </div>
        <div style="text-align:center;background:#222;padding:8px 16px;border-radius:8px">
          <div style="font-size:20px;font-weight:700;color:#a1a1aa">${duplicates}</div>
          <div style="font-size:11px;color:#a1a1aa">Duplicates</div>
        </div>
      </div>
      ${APP_URL ? `<a href="${APP_URL}/builder/ad-library" target="_blank" style="color:#a78bfa;text-decoration:underline;font-size:13px">Open Verdanote Ad Library →</a>` : ""}
      <div style="margin-top:12px">
        <button onclick="this.closest('#vn-progress').remove()" style="background:#333;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px">Close</button>
      </div>
    `;
  }

  document.getElementById("vn-save-all").addEventListener("click", saveAllVisible);

  // ── Initial injection + observer for dynamically loaded ads ──
  let count = injectSaveButtons();
  console.log("Verdanote: injected save buttons on", count, "ads");

  // Watch for new ads loaded via infinite scroll
  const observer = new MutationObserver(() => {
    injectSaveButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Re-inject periodically as a safety net
  setInterval(injectSaveButtons, 3000);
})();
