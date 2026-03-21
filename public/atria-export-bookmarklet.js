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
    try { return new URL(url, location.href).href; } catch { return null; }
  };

  const isSmallOrProfileImg = (img) => {
    const w = img.naturalWidth || img.width || img.offsetWidth || 0;
    const h = img.naturalHeight || img.height || img.offsetHeight || 0;
    if (w > 0 && h > 0 && w < 200 && h < 200) return true;
    const style = getComputedStyle(img);
    if (style.borderRadius === "50%" || style.borderRadius === "9999px") return true;
    const src = img.currentSrc || img.src || "";
    return isProfileUrl(src);
  };

  const extractCreativeMedia = (card) => {
    const images = [];
    const videos = [];
    card.querySelectorAll("video").forEach((video) => {
      const direct = normalizeUrl(video.currentSrc || video.src);
      if (direct && !isProfileUrl(direct)) videos.push(direct);
      video.querySelectorAll("source").forEach((source) => {
        const src = normalizeUrl(source.src);
        if (src && !isProfileUrl(src)) videos.push(src);
      });
    });
    const allImgs = Array.from(card.querySelectorAll("img"));
    const sizedImgs = allImgs
      .map((img) => {
        const w = img.naturalWidth || img.width || img.offsetWidth || 0;
        const h = img.naturalHeight || img.height || img.offsetHeight || 0;
        const src = normalizeUrl(img.currentSrc || img.src);
        return { img, src, w, h, area: w * h };
      })
      .filter((item) => item.src && !isProfileUrl(item.src))
      .sort((a, b) => b.area - a.area);
    for (const item of sizedImgs) {
      if (item.w >= 200 || item.h >= 200 || item.area === 0) {
        images.push(item.src);
      }
    }
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
        return [{
          source_url: input.source_url || input.url,
          landing_page_url: input.landing_page_url || input.destination_url || null,
          advertiser_name: input.advertiser_name || input.brand_name || input.advertiser || "Unknown",
          body_text: input.body_text || input.body || input.text || null,
          platform: input.platform || "facebook",
          ad_format: input.ad_format || input.format || (maybeMedia.some((url) => typeof url === "string" && videoRe.test(url)) ? "video" : null),
          thumbnail_url: (input.thumbnail_url && !isProfileUrl(input.thumbnail_url)) ? input.thumbnail_url : (input.image_url && !isProfileUrl(input.image_url)) ? input.image_url : null,
          media_urls: unique(maybeMedia.map(normalizeUrl).filter(Boolean).filter((u) => !isProfileUrl(u))),
          boards: input.boards || input.board_ids || input.collections || [],
          tags: input.tags || input.labels || [],
          raw_data: input,
        }];
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
    "max-width:360px", "line-height:1.4",
  ].join(";");
  overlay.innerHTML = "Scanning Atria page…";
  document.body.appendChild(overlay);

  const cleanup = () => { window.__ADVAULT_ATRIA_RUNNING = false; };

  const networkAds = [];
  const networkBoards = [];
  const networkTags = [];

  // Intercept fetch to capture API responses with org data
  if (!window.__ADVAULT_ATRIA_FETCH_PATCHED) {
    window.__ADVAULT_ATRIA_FETCH_PATCHED = true;
    const originalFetch = window.fetch;
    window.fetch = function () {
      return originalFetch.apply(this, arguments).then(async (response) => {
        try {
          const url = (arguments[0] && typeof arguments[0] === "string") ? arguments[0] : (arguments[0]?.url || "");
          const clone = response.clone();
          const text = await clone.text();
          if ((text && text[0] === "{") || (text && text[0] === "[")) {
            const data = JSON.parse(text);
            const serialized = JSON.stringify(data);

            // Capture board/collection data
            if (/board|collection|folder|group/i.test(url) || /board|collection/i.test(serialized.substring(0, 500))) {
              networkBoards.push(data);
            }
            // Capture tag data
            if (/tag|label|categor/i.test(url) || /\"tags\"|\"labels\"/i.test(serialized.substring(0, 500))) {
              networkTags.push(data);
            }
            // Capture ad data
            if (/video_url|media_urls|thumbnail|advertiser|headline|body_text|creative_url|asset_url/i.test(serialized)) {
              networkAds.push(data);
            }
          }
        } catch { /* ignore */ }
        return response;
      });
    };
  }

  // ---- Organization extraction helpers ----

  function extractBoardsFromSidebar() {
    const boards = [];
    // Look for sidebar/nav elements that contain board listings
    const sidebarSelectors = [
      '[class*="sidebar"] [class*="board"]',
      '[class*="sidebar"] [class*="collection"]',
      '[class*="nav"] [class*="board"]',
      '[class*="nav"] [class*="collection"]',
      '[class*="Sidebar"]',
      'nav [class*="list"] a',
      '[class*="folder"]',
      '[role="navigation"] a',
    ];

    const seenNames = new Set();
    for (const sel of sidebarSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const name = (el.textContent || "").trim();
        if (name && name.length > 0 && name.length < 100 && !seenNames.has(name.toLowerCase())) {
          seenNames.add(name.toLowerCase());
          // Check for a link/URL that might contain an ID
          const link = el.closest("a") || el.querySelector("a");
          const href = link ? link.href : "";
          const idMatch = href.match(/\/(?:board|collection|folder|swipe)s?\/([a-zA-Z0-9_-]+)/);
          const sourceId = idMatch ? idMatch[1] : name.toLowerCase().replace(/\s+/g, "-");

          // Check for nested items (sub-boards)
          const subBoards = [];
          const parentEl = el.closest('[class*="group"]') || el.parentElement;
          if (parentEl) {
            const children = parentEl.querySelectorAll('[class*="sub"], [class*="child"], [class*="nested"]');
            children.forEach((child) => {
              const childName = (child.textContent || "").trim();
              if (childName && childName !== name && !seenNames.has(childName.toLowerCase())) {
                seenNames.add(childName.toLowerCase());
                const childLink = child.closest("a") || child.querySelector("a");
                const childHref = childLink ? childLink.href : "";
                const childIdMatch = childHref.match(/\/(?:board|collection|folder)s?\/([a-zA-Z0-9_-]+)/);
                subBoards.push({
                  name: childName,
                  source_id: childIdMatch ? childIdMatch[1] : childName.toLowerCase().replace(/\s+/g, "-"),
                });
              }
            });
          }

          boards.push({ name, source_id: sourceId, sub_boards: subBoards });
        }
      });
    }
    return boards;
  }

  function extractBoardsFromNetwork(networkData) {
    const boards = [];
    const seenIds = new Set();

    function walk(obj) {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) { obj.forEach(walk); return; }

      // Look for board-like objects
      const name = obj.name || obj.title || obj.board_name || obj.collection_name;
      const id = obj.id || obj._id || obj.board_id || obj.collection_id;
      if (name && id && !seenIds.has(String(id))) {
        seenIds.add(String(id));
        const subBoards = [];
        const children = obj.sub_boards || obj.children || obj.subCollections || obj.boards || [];
        if (Array.isArray(children)) {
          children.forEach((child) => {
            const childName = child.name || child.title;
            const childId = child.id || child._id;
            if (childName && childId && !seenIds.has(String(childId))) {
              seenIds.add(String(childId));
              subBoards.push({ name: childName, source_id: String(childId) });
            }
          });
        }
        boards.push({ name, source_id: String(id), sub_boards: subBoards });
      }

      Object.values(obj).forEach(walk);
    }

    networkData.forEach(walk);
    return boards;
  }

  function extractTagsFromDOM() {
    const tags = [];
    const seenNames = new Set();

    // Look for tag elements in filters, sidebars, or ad cards
    const tagSelectors = [
      '[class*="tag"]:not(html):not(head):not(body):not(script)',
      '[class*="Tag"]:not(html):not(head):not(body):not(script)',
      '[class*="label"]:not(label)',
      '[class*="badge"]',
      '[class*="chip"]',
      '[class*="pill"]',
    ];

    for (const sel of tagSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const name = (el.textContent || "").trim();
        if (name && name.length > 0 && name.length < 50 && !seenNames.has(name.toLowerCase())) {
          // Skip if it's just a number or too generic
          if (/^\d+$/.test(name)) return;
          if (/^(all|filter|sort|search|clear|reset|close|cancel)$/i.test(name)) return;
          seenNames.add(name.toLowerCase());
          // Try to grab color
          const style = getComputedStyle(el);
          const bg = style.backgroundColor;
          let color = null;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
            color = bg;
          }
          tags.push({ name, color });
        }
      });
    }
    return tags;
  }

  function extractTagsFromNetwork(networkData) {
    const tags = [];
    const seenNames = new Set();

    function walk(obj) {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) { obj.forEach(walk); return; }
      const name = obj.name || obj.tag_name || obj.label;
      if (name && typeof name === "string" && name.length < 50) {
        const key = name.toLowerCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          tags.push({ name, color: obj.color || null });
        }
      }
      Object.values(obj).forEach(walk);
    }

    networkData.forEach(walk);
    return tags;
  }

  function extractAdTags(card) {
    const tags = [];
    const tagEls = card.querySelectorAll('[class*="tag"], [class*="Tag"], [class*="badge"], [class*="chip"], [class*="pill"], [class*="label"]:not(label)');
    tagEls.forEach((el) => {
      const name = (el.textContent || "").trim();
      if (name && name.length > 0 && name.length < 50 && !/^\d+$/.test(name)) {
        if (!/^(all|filter|sort|search|clear|reset|close|cancel|image|video|carousel|active|inactive)$/i.test(name)) {
          tags.push(name);
        }
      }
    });
    return unique(tags);
  }

  function extractAdBoardContext() {
    // Try to determine which board/collection the current page is showing
    const urlMatch = location.href.match(/\/(?:board|collection|folder|swipe)s?\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];

    // Look at active sidebar item
    const activeEl = document.querySelector('[class*="sidebar"] [class*="active"]') ||
                     document.querySelector('[class*="nav"] [class*="active"]') ||
                     document.querySelector('[aria-current="page"]');
    if (activeEl) {
      const name = (activeEl.textContent || "").trim();
      if (name) return name;
    }
    return null;
  }

  (async () => {
    try {
      if (!location.hostname.includes("tryatria.com") && !location.hostname.includes("atria")) {
        alert("Please navigate to tryatria.com first.");
        overlay.remove();
        cleanup();
        return;
      }

      // Step 1: Extract board structure from sidebar
      overlay.innerHTML = "Step 1/4: Extracting boards & folders…";
      await delay(500);
      const domBoards = extractBoardsFromSidebar();

      // Step 2: Scroll to load all ads
      let lastHeight = -1;
      for (let pass = 0; pass < 10; pass += 1) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
        await delay(900);
        overlay.innerHTML = `Step 2/4: Loading ads… pass ${pass + 1}/10`;
        if (document.body.scrollHeight === lastHeight) break;
        lastHeight = document.body.scrollHeight;
      }
      window.scrollTo({ top: 0, behavior: "auto" });
      await delay(250);

      // Step 3: Extract tags
      overlay.innerHTML = "Step 3/4: Extracting tags…";
      const domTags = extractTagsFromDOM();
      const networkTagsList = extractTagsFromNetwork(networkTags);

      // Merge DOM + network tags
      const allTags = [];
      const tagSeen = new Set();
      [...networkTagsList, ...domTags].forEach((t) => {
        const key = t.name.toLowerCase();
        if (!tagSeen.has(key)) {
          tagSeen.add(key);
          allTags.push(t);
        }
      });

      // Merge DOM + network boards
      const networkBoardsList = extractBoardsFromNetwork(networkBoards);
      const allBoards = [];
      const boardSeen = new Set();
      [...networkBoardsList, ...domBoards].forEach((b) => {
        const key = b.name.toLowerCase();
        if (!boardSeen.has(key)) {
          boardSeen.add(key);
          allBoards.push(b);
        }
      });

      // Step 4: Extract ads with board/tag assignments
      overlay.innerHTML = "Step 4/4: Extracting ad data…";
      const currentBoard = extractAdBoardContext();

      const ads = [];
      const seen = {};
      const cards = document.querySelectorAll(
        '[class*="card"],[class*="Card"],[class*="ad-item"],[class*="AdCard"],[class*="swipe"],article,div[class*="grid"]>div'
      );

      cards.forEach((card, index) => {
        if (card.offsetHeight < 50) return;
        const text = (card.innerText || "").trim();
        const { images, videos } = extractCreativeMedia(card);
        const media = unique(videos.concat(images));
        const thumb = images[0] || null;

        const link = card.querySelector('a[href*="facebook.com"],a[href*="tiktok.com"],a[href*="ads/library"],a[href*="instagram.com"]');
        const landingPageLink = card.querySelector('a[href^="http"]');
        const nameEl = card.querySelector('h1,h2,h3,h4,[class*="brand"],[class*="name"],[class*="advertiser"]');
        let name = nameEl ? nameEl.textContent.trim() : "";
        const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
        if (!name && lines.length > 0) name = lines[0].substring(0, 80);
        if (!text && media.length === 0) return;

        const sourceUrl = link ? link.href : landingPageLink ? landingPageLink.href
          : `https://tryatria.com/saved/${index}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        if (seen[sourceUrl]) return;
        seen[sourceUrl] = true;

        // Extract tags from this ad card
        const adTags = extractAdTags(card);

        // Board assignment: current board context + any data attributes
        const adBoards = [];
        if (currentBoard) adBoards.push(currentBoard);
        const boardAttr = card.getAttribute("data-board") || card.getAttribute("data-collection");
        if (boardAttr) adBoards.push(boardAttr);

        ads.push({
          source_url: sourceUrl,
          landing_page_url: landingPageLink && landingPageLink.href !== sourceUrl ? landingPageLink.href : null,
          advertiser_name: name || "Unknown",
          body_text: text.substring(0, 4000) || null,
          platform: /tiktok/i.test(sourceUrl) ? "tiktok" : "facebook",
          ad_format: videos.length ? "video" : media.length > 1 ? "carousel" : thumb ? "image" : null,
          thumbnail_url: thumb,
          media_urls: media,
          tags: adTags,
          boards: unique(adBoards),
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

      // Also add ads from network interception
      flatten(networkAds).forEach((ad) => {
        if (!ad.source_url || seen[ad.source_url]) return;
        seen[ad.source_url] = true;
        ads.push(ad);
      });

      if (!ads.length && !allBoards.length) {
        overlay.innerHTML = "No ads or boards found. Open your saved ads page and let Atria fully load first.";
        setTimeout(() => overlay.remove(), 5000);
        cleanup();
        return;
      }

      // Build organization structure
      const folders = [];
      const standaloneBoards = [];
      for (const board of allBoards) {
        if (board.sub_boards && board.sub_boards.length > 0) {
          folders.push({
            name: board.name,
            source_id: board.source_id,
            boards: board.sub_boards,
          });
        } else {
          standaloneBoards.push({
            name: board.name,
            source_id: board.source_id,
          });
        }
      }

      const payload = {
        export_source: "atria",
        export_date: new Date().toISOString(),
        organization: {
          folders: folders,
          standalone_boards: standaloneBoards,
          tags: allTags,
        },
        ads: ads,
      };

      overlay.innerHTML = `Found ${folders.length} folders, ${standaloneBoards.length + folders.reduce((s, f) => s + f.boards.length, 0)} boards, ${allTags.length} tags, and ${ads.length} ads.<br/>Sending to Verdanote…`;

      const token = prompt("Paste your Verdanote auth token (from the Import modal copy button):");
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
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Import failed.");
      }

      const r = data.results || data;
      overlay.innerHTML = `<b>Done!</b><br/>` +
        `${r.folders_created || 0} folders, ${r.boards_created || 0} boards, ${r.tags_created || 0} tags created<br/>` +
        `${r.ads_imported || data.imported || 0} ads imported` +
        (r.ads_skipped_duplicate || data.skipped_duplicates ? ` (${r.ads_skipped_duplicate || data.skipped_duplicates} duplicates skipped)` : "");
      setTimeout(() => overlay.remove(), 8000);
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
