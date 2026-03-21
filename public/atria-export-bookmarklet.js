(function () {
  const config = window.__ADVAULT_ATRIA_CONFIG || {};
  const importUrl = config.importUrl;

  if (!importUrl) {
    alert("Atria export is missing configuration. Please copy a fresh bookmarklet from Verdanote.");
    return;
  }

  if (window.__ADVAULT_ATRIA_RUNNING) {
    alert("Atria export is already running on this page.");
    return;
  }

  if (!location.hostname.includes("tryatria.com") && !location.hostname.includes("atria")) {
    alert("Please navigate to app.tryatria.com first.");
    return;
  }

  window.__ADVAULT_ATRIA_RUNNING = true;

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── UI overlay ──
  const overlay = document.createElement("div");
  overlay.id = "advault-overlay";
  overlay.style.cssText = [
    "position:fixed", "top:20px", "right:20px", "z-index:999999",
    "background:#18181b", "color:white", "padding:20px 24px",
    "border-radius:14px", "font-family:system-ui,sans-serif",
    "font-size:14px", "box-shadow:0 8px 32px rgba(0,0,0,.4)",
    "max-width:400px", "line-height:1.5", "min-width:320px",
  ].join(";");
  document.body.appendChild(overlay);

  function setStatus(html) { overlay.innerHTML = html; }
  function cleanup() { window.__ADVAULT_ATRIA_RUNNING = false; }

  // ── Helpers ──
  function getOriginalImageUrl(url) {
    if (!url) return url;
    // cdn.tryatria.com/_images/w:1920/q:75/plain/adfiles/xxx.jpeg → cdn.tryatria.com/adfiles/xxx.jpeg
    return url.replace(/cdn\.tryatria\.com\/_images\/[^/]+\/[^/]+\/plain\//, "cdn.tryatria.com/");
  }

  // ── Step 0: Get auth token ──
  async function getAuthToken() {
    // Check if token was pre-configured
    if (config.authToken) return config.authToken;
    // Prompt user
    const token = prompt("Paste your Verdanote auth token (copy from the Import modal):");
    if (!token || !token.trim()) return null;
    return token.trim();
  }

  // ── Step 1: Extract boards from sidebar ──
  function extractBoards() {
    const boards = [];
    const seen = new Set();

    // Atria sidebar has links to /workspace/board/{id}
    const sidebarLinks = document.querySelectorAll('a[href*="/workspace/board/"]');
    for (const a of sidebarLinks) {
      const name = (a.textContent || "").trim();
      const href = a.getAttribute("href") || "";
      const idMatch = href.match(/\/board\/([^/?]+)/);
      const id = idMatch ? idMatch[1] : null;
      if (name && id && !seen.has(id)) {
        seen.add(id);
        boards.push({ name, id, href });
      }
    }
    return boards;
  }

  // ── Step 2: Scroll to load all ads ──
  async function scrollToLoadAll(statusPrefix) {
    let lastHeight = 0;
    for (let pass = 0; pass < 50; pass++) {
      window.scrollTo(0, document.body.scrollHeight);
      await delay(1500);
      const newHeight = document.body.scrollHeight;
      const cardCount = document.querySelectorAll(".detail-card").length;
      setStatus(`${statusPrefix}<br>Scrolling… pass ${pass + 1}, found ${cardCount} ads`);
      if (newHeight === lastHeight) break;
      lastHeight = newHeight;
    }
    window.scrollTo(0, 0);
    await delay(300);
  }

  // ── Step 3: Extract ads from current page ──
  function extractAdsFromPage(boardName) {
    const cards = document.querySelectorAll(".detail-card");
    const ads = [];

    for (const card of cards) {
      // Advertiser name
      const brandLink = card.querySelector(".detail-card-brand-title");
      const advertiserName = brandLink ? brandLink.textContent.trim() : null;

      // Meta page ID from brand link href: /workspace/brand/m{page_id}/overview
      const brandHref = brandLink ? (brandLink.getAttribute("href") || "") : "";
      const metaPageId = (brandHref.match(/\/brand\/(m\d+)\//) || [])[1] || null;

      // Detect video vs image ad
      const hasVideoPlayer = !!card.querySelector('.react-player__preview, .react-player, [class*="react-player"]');

      let creativeImageUrl = null;
      let adId = null;

      if (hasVideoPlayer) {
        // VIDEO AD: grab the thumbnail/poster from the preview area
        const previewImg = card.querySelector('.react-player__preview img');
        if (previewImg) {
          const srcset = previewImg.getAttribute("srcset") || "";
          const srcsetUrls = srcset.split(",").map((s) => s.trim().split(" ")[0]).filter(Boolean);
          creativeImageUrl = srcsetUrls[srcsetUrls.length - 1] || previewImg.src;
        }
        // Fallback: find any CDN image that's not the avatar
        if (!creativeImageUrl) {
          const fallbackImg = [...card.querySelectorAll("img")].find((img) => {
            const isAvatar = img.closest(".w-8, .h-8, .rounded-full");
            const hasCdn = (img.src + (img.getAttribute("srcset") || "")).includes("cdn.tryatria.com");
            return !isAvatar && hasCdn;
          });
          if (fallbackImg) {
            const srcset = fallbackImg.getAttribute("srcset") || "";
            const srcsetUrls = srcset.split(",").map((s) => s.trim().split(" ")[0]).filter(Boolean);
            creativeImageUrl = srcsetUrls[srcsetUrls.length - 1] || fallbackImg.src;
          }
        }
      } else {
        // IMAGE AD: grab the creative image directly (NOT the small avatar)
        const creativeImg = [...card.querySelectorAll("img")].find((img) => {
          const isAvatar = img.closest(".w-8, .h-8, .rounded-full");
          const hasCdn = (img.src + (img.getAttribute("srcset") || "")).includes("cdn.tryatria.com");
          return !isAvatar && hasCdn;
        });
        if (creativeImg) {
          const srcset = creativeImg.getAttribute("srcset") || "";
          const srcsetUrls = srcset.split(",").map((s) => s.trim().split(" ")[0]).filter(Boolean);
          creativeImageUrl = srcsetUrls[srcsetUrls.length - 1] || creativeImg.src;
        }
        // Fallback: any non-avatar image with reasonable size
        if (!creativeImageUrl) {
          const fallbackImg = [...card.querySelectorAll("img")].find((img) => {
            const isAvatar = img.closest(".w-8, .h-8, .rounded-full");
            const w = img.naturalWidth || img.width || 0;
            const h = img.naturalHeight || img.height || 0;
            return !isAvatar && (w >= 100 || h >= 100) && img.src && !img.src.includes("avatar") && !img.src.includes("profile");
          });
          if (fallbackImg) creativeImageUrl = fallbackImg.src;
        }
      }

      // Convert resized URL to original full-res
      if (creativeImageUrl) {
        creativeImageUrl = getOriginalImageUrl(creativeImageUrl);
      }

      // Extract ad ID from image URLs: adfiles/m{ad_id}_{hash}
      const adIdMatch = (creativeImageUrl || "").match(/adfiles\/(m\d+)_/);
      adId = adIdMatch ? adIdMatch[1] : null;

      // Body text
      let bodyText = "";
      const textEls = card.querySelectorAll('p, [class*="text"], [class*="body"], [class*="copy"]');
      for (const el of textEls) {
        const text = (el.textContent || "").trim();
        if (text.length > 20 && text !== advertiserName) {
          bodyText = text.substring(0, 2000);
          break;
        }
      }

      // Tags
      const tagEls = card.querySelectorAll('[class*="tag"], [class*="chip"], [class*="badge"]');
      const tags = [...tagEls]
        .map((t) => (t.textContent || "").trim())
        .filter((t) => t && t.length < 50 && !/^(image|video|carousel|active|inactive|\d+)$/i.test(t));

      ads.push({
        advertiserName,
        metaPageId,
        creativeImageUrl,
        hasVideoPlayer,
        adId,
        bodyText,
        tags: [...new Set(tags)],
        boardName,
        cardEl: card,
      });
    }

    return ads;
  }

  // ── Step 4: Extract video URLs by clicking play ──
  async function extractVideoUrls(ads, statusPrefix) {
    let videoCount = 0;
    const videoAds = ads.filter((a) => a.hasVideoPlayer);

    for (let i = 0; i < videoAds.length; i++) {
      const ad = videoAds[i];
      setStatus(`${statusPrefix}<br>Extracting video ${i + 1} of ${videoAds.length}...`);

      const playButton = ad.cardEl.querySelector(".react-player__preview");
      if (!playButton) continue;

      // Scroll card into view
      ad.cardEl.scrollIntoView({ behavior: "instant", block: "center" });
      await delay(300);

      // Click play
      playButton.click();

      // Wait for <video> element
      let videoUrl = null;
      for (let j = 0; j < 16; j++) {
        await delay(500);
        const video = ad.cardEl.querySelector("video");
        if (video) {
          const src = video.currentSrc || video.src;
          if (src) {
            videoUrl = src;
            video.pause();
            break;
          }
          const source = video.querySelector("source");
          if (source && source.src) {
            videoUrl = source.src;
            video.pause();
            break;
          }
        }
      }

      if (videoUrl) {
        ad.videoUrl = videoUrl;
        videoCount++;
      }

      // 1s delay between clicks to avoid overloading
      await delay(1000);
    }

    return videoCount;
  }

  // ── Step 5: Build and send payload ──
  async function sendToVerdanote(ads, boardName, authToken) {
    const payload = {
      export_source: "atria",
      export_date: new Date().toISOString(),
      ads: ads.map((ad) => {
        const numericAdId = ad.adId ? ad.adId.replace(/^m/, "") : null;
        return {
          advertiser_name: ad.advertiserName || "Unknown",
          ad_id: ad.adId || null,
          meta_page_id: ad.metaPageId || null,
          platform: "facebook",
          ad_format: ad.hasVideoPlayer ? "video" : "image",
          thumbnail_url: ad.creativeImageUrl || null,
          video_url: ad.videoUrl || null,
          body_text: ad.bodyText || null,
          tags: ad.tags || [],
          boards: [ad.boardName || boardName].filter(Boolean),
          source_url: numericAdId
            ? "https://www.facebook.com/ads/library/?id=" + numericAdId
            : ad.creativeImageUrl
              ? "atria-import-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)
              : "atria-import-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        };
      }),
    };

    const resp = await fetch(importUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + authToken,
      },
      body: JSON.stringify(payload),
    });

    return resp.json();
  }

  // ── Main flow ──
  (async () => {
    try {
      // Get auth token
      setStatus("Getting authentication...");
      const authToken = await getAuthToken();
      if (!authToken) {
        setStatus("❌ No auth token provided. Export cancelled.");
        setTimeout(() => { overlay.remove(); cleanup(); }, 3000);
        return;
      }

      // Extract boards
      setStatus("Scanning boards...");
      await delay(500);
      const boards = extractBoards();

      // Show board selection UI
      if (boards.length > 0) {
        // Build board selection checkboxes
        const currentPageBoard = getCurrentBoardName();
        const boardSelectionHtml = `
          <div style="margin-bottom:12px;font-weight:600;font-size:16px">Select boards to import</div>
          <div style="max-height:300px;overflow-y:auto;margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;border-bottom:1px solid #333">
              <input type="checkbox" id="advault-select-all" style="width:16px;height:16px" checked>
              <span style="font-weight:500">Select All (${boards.length} boards)</span>
            </label>
            ${boards.map((b, i) => `
              <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;border-bottom:1px solid #333">
                <input type="checkbox" class="advault-board-cb" data-index="${i}" style="width:16px;height:16px" checked>
                <span>${b.name}</span>
              </label>
            `).join("")}
          </div>
          ${currentPageBoard ? `<div style="font-size:12px;color:#a1a1aa;margin-bottom:12px">Current page: "${currentPageBoard}" — will also be imported if checked above.</div>` : ""}
          <div style="display:flex;gap:8px">
            <button id="advault-start-import" style="flex:1;padding:10px;background:#7c3aed;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Start Import</button>
            <button id="advault-current-only" style="padding:10px 16px;background:#333;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer">Current Page Only</button>
            <button id="advault-cancel" style="padding:10px 16px;background:#333;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer">Cancel</button>
          </div>
        `;
        setStatus(boardSelectionHtml);

        // Select all toggle
        const selectAllCb = document.getElementById("advault-select-all");
        if (selectAllCb) {
          selectAllCb.addEventListener("change", () => {
            document.querySelectorAll(".advault-board-cb").forEach((cb) => { cb.checked = selectAllCb.checked; });
          });
        }

        // Wait for user action
        const action = await new Promise((resolve) => {
          document.getElementById("advault-start-import")?.addEventListener("click", () => resolve("multi"));
          document.getElementById("advault-current-only")?.addEventListener("click", () => resolve("current"));
          document.getElementById("advault-cancel")?.addEventListener("click", () => resolve("cancel"));
        });

        if (action === "cancel") {
          overlay.remove();
          cleanup();
          return;
        }

        if (action === "current") {
          // Import current page only
          await importCurrentPage(authToken);
        } else {
          // Multi-board import
          const selectedBoards = [];
          document.querySelectorAll(".advault-board-cb").forEach((cb) => {
            if (cb.checked) {
              const idx = parseInt(cb.getAttribute("data-index"));
              if (!isNaN(idx) && boards[idx]) selectedBoards.push(boards[idx]);
            }
          });

          if (selectedBoards.length === 0) {
            setStatus("❌ No boards selected.");
            setTimeout(() => { overlay.remove(); cleanup(); }, 3000);
            return;
          }

          await importMultipleBoards(selectedBoards, authToken);
        }
      } else {
        // No boards found, import current page
        await importCurrentPage(authToken);
      }
    } catch (err) {
      setStatus("❌ Error: " + (err.message || err));
      console.error("Atria export error:", err);
      setTimeout(() => { overlay.remove(); cleanup(); }, 5000);
    }
  })();

  function getCurrentBoardName() {
    // Try page header
    const h1 = document.querySelector("h1, h2");
    if (h1) {
      const text = h1.textContent.trim();
      if (text && text.length < 100) return text;
    }
    // Try active sidebar item
    const activeLink = document.querySelector('a[href*="/workspace/board/"][class*="active"], a[href*="/workspace/board/"][aria-current="page"]');
    if (activeLink) return activeLink.textContent.trim();
    // URL-based
    const urlMatch = location.pathname.match(/\/board\/([^/?]+)/);
    if (urlMatch) return decodeURIComponent(urlMatch[1]);
    return "Saved Ads";
  }

  async function importCurrentPage(authToken) {
    const boardName = getCurrentBoardName();
    setStatus(`<div style="font-weight:600">Importing: ${boardName}</div>Scrolling to load all ads...`);

    await scrollToLoadAll(`<div style="font-weight:600">Importing: ${boardName}</div>`);

    const ads = extractAdsFromPage(boardName);
    setStatus(`<div style="font-weight:600">Importing: ${boardName}</div>Found ${ads.length} ads. Extracting videos...`);

    const videoCount = await extractVideoUrls(ads, `<div style="font-weight:600">Importing: ${boardName}</div>`);

    setStatus(`<div style="font-weight:600">Importing: ${boardName}</div>Sending ${ads.length} ads (${videoCount} videos) to Verdanote...`);

    const result = await sendToVerdanote(ads, boardName, authToken);

    showFinalResults([{ boardName, adCount: ads.length, videoCount, result }]);
  }

  async function importMultipleBoards(boards, authToken) {
    const allResults = [];
    let totalAds = 0;
    let totalVideos = 0;

    for (let bi = 0; bi < boards.length; bi++) {
      const board = boards[bi];
      const prefix = `<div style="font-weight:600;margin-bottom:4px">Board ${bi + 1} of ${boards.length}: ${board.name}</div>`;

      setStatus(prefix + "Navigating to board...");

      // Navigate to the board
      const boardUrl = new URL(board.href, location.origin).href;
      window.location.href = boardUrl;

      // Wait for page to load
      await delay(3000);

      // Wait for detail-cards to appear
      for (let w = 0; w < 20; w++) {
        if (document.querySelectorAll(".detail-card").length > 0) break;
        await delay(500);
      }

      // Re-attach overlay (page navigation may remove it)
      if (!document.getElementById("advault-overlay")) {
        document.body.appendChild(overlay);
      }

      // Scroll to load all
      await scrollToLoadAll(prefix);

      // Extract ads
      const ads = extractAdsFromPage(board.name);
      setStatus(prefix + `Found ${ads.length} ads. Extracting videos...`);

      // Extract video URLs
      const videoCount = await extractVideoUrls(ads, prefix);

      // Send to Verdanote
      setStatus(prefix + `Sending ${ads.length} ads (${videoCount} videos) to Verdanote...`);
      const result = await sendToVerdanote(ads, board.name, authToken);

      totalAds += ads.length;
      totalVideos += videoCount;
      allResults.push({ boardName: board.name, adCount: ads.length, videoCount, result });

      // Brief pause between boards
      await delay(1000);
    }

    showFinalResults(allResults);
  }

  function showFinalResults(results) {
    let totalImported = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let totalVideos = 0;

    const boardLines = results.map((r) => {
      const imp = r.result?.imported || 0;
      const skip = r.result?.skipped_duplicates || 0;
      totalImported += imp;
      totalSkipped += skip;
      totalFailed += r.result?.failed || 0;
      totalVideos += r.videoCount || 0;
      return `<div style="padding:4px 0;border-bottom:1px solid #333">
        <span style="color:#a78bfa">✓</span> ${r.boardName}: ${imp} imported${skip > 0 ? `, ${skip} duplicates` : ""}
      </div>`;
    }).join("");

    setStatus(`
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">🎉 Import Complete!</div>
      <div style="display:flex;gap:12px;margin-bottom:12px">
        <div style="text-align:center;flex:1;background:#222;padding:8px;border-radius:8px">
          <div style="font-size:24px;font-weight:700">${totalImported}</div>
          <div style="font-size:11px;color:#a1a1aa">Ads Imported</div>
        </div>
        <div style="text-align:center;flex:1;background:#222;padding:8px;border-radius:8px">
          <div style="font-size:24px;font-weight:700">${totalVideos}</div>
          <div style="font-size:11px;color:#a1a1aa">Videos Found</div>
        </div>
        <div style="text-align:center;flex:1;background:#222;padding:8px;border-radius:8px">
          <div style="font-size:24px;font-weight:700">${results.length}</div>
          <div style="font-size:11px;color:#a1a1aa">Boards</div>
        </div>
      </div>
      <div style="max-height:200px;overflow-y:auto;margin-bottom:12px;font-size:13px">${boardLines}</div>
      ${totalSkipped > 0 ? `<div style="font-size:12px;color:#a1a1aa;margin-bottom:8px">${totalSkipped} duplicate ads were skipped.</div>` : ""}
      ${totalFailed > 0 ? `<div style="font-size:12px;color:#ef4444;margin-bottom:8px">${totalFailed} ads failed to import.</div>` : ""}
      <div style="font-size:12px;color:#a1a1aa;margin-bottom:12px">Videos and images are being downloaded from Atria's CDN to your library. Go to Verdanote to see them.</div>
      <button onclick="document.getElementById('advault-overlay').remove()" style="width:100%;padding:10px;background:#7c3aed;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Done</button>
    `);
    cleanup();
  }
})();
