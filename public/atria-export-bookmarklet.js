(function () {
  const config = window.__ADVAULT_ATRIA_CONFIG || {};
  const importUrl = config.importUrl;

  if (!importUrl) {
    alert("Atria export is missing configuration. Please copy a fresh bookmarklet from AdVault.");
    return;
  }

  if (window.__ADVAULT_ATRIA_RUNNING) {
    alert("Atria export is already running on this page.");
    return;
  }

  window.__ADVAULT_ATRIA_RUNNING = true;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const unique = (arr) => arr.filter(Boolean).filter((value, index, self) => self.indexOf(value) === index);
  const videoRe = /\.(mp4|webm|mov|m3u8|avi)(\?|$)/i;

  // URL patterns that indicate profile pictures / logos — NOT ad creatives
  const PROFILE_PATTERNS = [
    /\/profile/i, /\/avatar/i, /\/logo/i, /page_picture/i,
    /p\d{2,3}x\d{2,3}/i, /s\d{2,3}x\d{2,3}/i,
    /\/rsrc\.php/i, /emoji/i, /icon/i, /badge/i, /\/static\//i,
    /favicon/i, /sprite/i,
  ];

  const isProfileUrl = (url) => {
    if (!url) return false;
    return PROFILE_PATTERNS.some((p) => p.test(url));
  };

  const normalizeUrl = (url) => {
    if (!url) return null;
    try {
      return new URL(url, location.href).href;
    } catch {
      return null;
    }
  };

  const extractBg = (el) => {
    const bg = getComputedStyle(el).backgroundImage || "";
    const match = bg.match(/url\(["']?(.*?)["']?\)/);
    return match && match[1] ? normalizeUrl(match[1]) : null;
  };

  // Check if an image element is likely a profile picture / logo
  const isSmallOrProfileImg = (img) => {
    const w = img.naturalWidth || img.width || img.offsetWidth || 0;
    const h = img.naturalHeight || img.height || img.offsetHeight || 0;
    // Skip very small images (< 200px both dimensions) — likely logos
    if (w > 0 && h > 0 && w < 200 && h < 200) return true;
    // Check if it's circular (profile pic style)
    const style = getComputedStyle(img);
    if (style.borderRadius === "50%" || style.borderRadius === "9999px") return true;
    // Check URL patterns
    const src = img.currentSrc || img.src || "";
    return isProfileUrl(src);
  };

  // Find the main creative media within an ad card
  const extractCreativeMedia = (card) => {
    const images = [];
    const videos = [];

    // Extract videos first — these are always the actual creative
    card.querySelectorAll("video").forEach((video) => {
      const direct = normalizeUrl(video.currentSrc || video.src);
      if (direct && !isProfileUrl(direct)) videos.push(direct);
      video.querySelectorAll("source").forEach((source) => {
        const src = normalizeUrl(source.src);
        if (src && !isProfileUrl(src)) videos.push(src);
      });
    });

    // Extract images — filter out profile pics and logos
    const allImgs = Array.from(card.querySelectorAll("img"));
    
    // Sort by size descending — largest images are most likely the creative
    const sizedImgs = allImgs
      .map((img) => {
        const w = img.naturalWidth || img.width || img.offsetWidth || 0;
        const h = img.naturalHeight || img.height || img.offsetHeight || 0;
        const src = normalizeUrl(img.currentSrc || img.src);
        return { img, src, w, h, area: w * h };
      })
      .filter((item) => item.src && !isProfileUrl(item.src))
      .sort((a, b) => b.area - a.area);

    // Take the largest image(s) that are likely the creative (> 200px on a side)
    for (const item of sizedImgs) {
      if (item.w >= 200 || item.h >= 200 || item.area === 0) {
        // area === 0 means we couldn't determine size, include it
        images.push(item.src);
      }
    }

    // If no sized images found, try background images on large containers
    if (images.length === 0) {
      const containers = card.querySelectorAll('[class*="creative"],[class*="media"],[class*="preview"],[class*="image"]');
      containers.forEach((el) => {
        const bg = extractBg(el);
        if (bg && !isProfileUrl(bg)) images.push(bg);
      });
    }

    // Fallback: take the largest image even if small
    if (images.length === 0 && sizedImgs.length > 0) {
      images.push(sizedImgs[0].src);
    }

    return { images: unique(images), videos: unique(videos) };
  };

  const flatten = (input) => {
    if (!input) return [];
    if (Array.isArray(input)) return input.flatMap(flatten);
    if (typeof input === "object") {
      const values = Object.values(input);
      let maybeMedia = [];

      if (typeof input.video_url === "string") maybeMedia.push(input.video_url);
      if (typeof input.thumbnail_url === "string" && !isProfileUrl(input.thumbnail_url)) maybeMedia.push(input.thumbnail_url);
      if (typeof input.image_url === "string" && !isProfileUrl(input.image_url)) maybeMedia.push(input.image_url);
      if (typeof input.creative_url === "string") maybeMedia.push(input.creative_url);
      if (typeof input.asset_url === "string") maybeMedia.push(input.asset_url);
      if (typeof input.media_url === "string") maybeMedia.push(input.media_url);
      if (Array.isArray(input.media_urls)) maybeMedia = maybeMedia.concat(input.media_urls.filter((u) => !isProfileUrl(u)));
      if (Array.isArray(input.mediaUrls)) maybeMedia = maybeMedia.concat(input.mediaUrls.filter((u) => !isProfileUrl(u)));

      if (typeof input.source_url === "string" || typeof input.url === "string") {
        return [
          {
            source_url: input.source_url || input.url,
            landing_page_url: input.landing_page_url || input.destination_url || null,
            advertiser_name: input.advertiser_name || input.brand_name || input.advertiser || "Unknown",
            body_text: input.body_text || input.body || input.text || null,
            platform: input.platform || "facebook",
            ad_format:
              input.ad_format ||
              input.format ||
              (maybeMedia.some((url) => typeof url === "string" && videoRe.test(url)) ? "video" : null),
            thumbnail_url: (input.thumbnail_url && !isProfileUrl(input.thumbnail_url)) ? input.thumbnail_url : (input.image_url && !isProfileUrl(input.image_url)) ? input.image_url : null,
            media_urls: unique(maybeMedia.map(normalizeUrl).filter(Boolean).filter((u) => !isProfileUrl(u))),
            raw_data: input,
          },
        ];
      }

      return values.flatMap(flatten);
    }

    return [];
  };

  const overlay = document.createElement("div");
  overlay.style.cssText = [
    "position:fixed", "top:20px", "right:20px", "z-index:99999",
    "background:#18181b", "color:white", "padding:16px 24px",
    "border-radius:12px", "font-family:system-ui,sans-serif",
    "font-size:14px", "box-shadow:0 8px 32px rgba(0,0,0,.3)",
    "max-width:320px", "line-height:1.4",
  ].join(";");
  overlay.innerHTML = "Scanning Atria page…";
  document.body.appendChild(overlay);

  const cleanup = () => {
    window.__ADVAULT_ATRIA_RUNNING = false;
  };

  const networkAds = [];

  if (!window.__ADVAULT_ATRIA_FETCH_PATCHED) {
    window.__ADVAULT_ATRIA_FETCH_PATCHED = true;
    const originalFetch = window.fetch;
    window.fetch = function () {
      return originalFetch.apply(this, arguments).then(async (response) => {
        try {
          const clone = response.clone();
          const text = await clone.text();
          if ((text && text[0] === "{") || (text && text[0] === "[")) {
            const data = JSON.parse(text);
            const serialized = JSON.stringify(data);
            if (/video_url|media_urls|thumbnail|advertiser|headline|body_text|creative_url|asset_url/i.test(serialized)) {
              networkAds.push(data);
            }
          }
        } catch {
          // ignore parse failures
        }
        return response;
      });
    };
  }

  (async () => {
    try {
      if (!location.hostname.includes("tryatria.com") && !location.hostname.includes("atria")) {
        alert("Please navigate to tryatria.com first.");
        overlay.remove();
        cleanup();
        return;
      }

      let lastHeight = -1;
      for (let pass = 0; pass < 10; pass += 1) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
        await delay(900);
        overlay.innerHTML = `Scanning Atria page… pass ${pass + 1}/10`;
        if (document.body.scrollHeight === lastHeight) break;
        lastHeight = document.body.scrollHeight;
      }

      window.scrollTo({ top: 0, behavior: "auto" });
      await delay(250);

      const ads = [];
      const seen = {};
      const cards = document.querySelectorAll(
        '[class*="card"],[class*="Card"],[class*="ad-item"],[class*="AdCard"],[class*="swipe"],article,div[class*="grid"]>div'
      );

      cards.forEach((card, index) => {
        if (card.offsetHeight < 50) return;

        const text = (card.innerText || "").trim();
        
        // Use smart extraction that filters out profile pics
        const { images, videos } = extractCreativeMedia(card);
        const media = unique(videos.concat(images));
        const thumb = images[0] || null;

        const link = card.querySelector(
          'a[href*="facebook.com"],a[href*="tiktok.com"],a[href*="ads/library"],a[href*="instagram.com"]'
        );
        const landingPageLink = card.querySelector('a[href^="http"]');
        const nameEl = card.querySelector('h1,h2,h3,h4,[class*="brand"],[class*="name"],[class*="advertiser"]');
        let name = nameEl ? nameEl.textContent.trim() : "";
        const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

        if (!name && lines.length > 0) name = lines[0].substring(0, 80);
        if (!text && media.length === 0) return;

        const sourceUrl = link
          ? link.href
          : landingPageLink
            ? landingPageLink.href
            : `https://tryatria.com/saved/${index}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        if (seen[sourceUrl]) return;
        seen[sourceUrl] = true;

        ads.push({
          source_url: sourceUrl,
          landing_page_url: landingPageLink && landingPageLink.href !== sourceUrl ? landingPageLink.href : null,
          advertiser_name: name || "Unknown",
          body_text: text.substring(0, 4000) || null,
          platform: /tiktok/i.test(sourceUrl) ? "tiktok" : "facebook",
          ad_format: videos.length ? "video" : media.length > 1 ? "carousel" : thumb ? "image" : null,
          thumbnail_url: thumb,
          media_urls: media,
          raw_data: {
            captured_from: "atria-bookmarklet",
            page_url: location.href,
            card_index: index,
            text,
            video_urls: videos,
            image_urls: images,
          },
        });
      });

      flatten(networkAds).forEach((ad) => {
        if (!ad.source_url || seen[ad.source_url]) return;
        seen[ad.source_url] = true;
        ads.push(ad);
      });

      if (!ads.length) {
        overlay.innerHTML = "No ads found. Open your saved ads page and let Atria fully load first.";
        setTimeout(() => overlay.remove(), 5000);
        cleanup();
        return;
      }

      overlay.innerHTML = `Found ${ads.length} ads. Sending to AdVault…`;
      const token = prompt("Paste your AdVault auth token (from the Import modal copy button):");
      if (!token) {
        overlay.remove();
        cleanup();
        return;
      }

      const response = await fetch(importUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ads }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Import failed.");
      }

      overlay.innerHTML = `<b>Done!</b> Imported ${data.imported || 0} ads${data.skipped_duplicates ? ` (${data.skipped_duplicates} duplicates skipped)` : ""}.`;
      setTimeout(() => overlay.remove(), 7000);
      cleanup();
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      overlay.innerHTML = `Import failed: ${message}`;
      setTimeout(() => overlay.remove(), 7000);
      alert(`Atria bookmarklet failed: ${message}`);
      cleanup();
    }
  })();
})();
