/**
 * video-proxy -- streams Meta CDN video through Supabase edge to avoid CORS and URL expiry.
 *
 * GET /functions/v1/video-proxy?url=<encoded_video_url>
 *
 * - No auth required (video URLs are already scoped to specific ad creatives)
 * - Supports Range requests for seek-able playback
 * - Adds permissive CORS headers
 * - Caches aggressively with Cache-Control
 * - Falls back gracefully if the upstream URL has expired
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "range, content-type, authorization",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges",
};

const FETCH_TIMEOUT_MS = 30_000;
// Max video we will proxy in a single request (prevents abuse)
const MAX_PROXY_BYTES = 200 * 1024 * 1024; // 200 MB

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const reqUrl = new URL(req.url);
  const videoUrl = reqUrl.searchParams.get("url");

  if (!videoUrl) {
    return new Response(JSON.stringify({ error: "url parameter required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Only proxy Meta CDN / Facebook video URLs
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(videoUrl);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const allowedHosts = [
    "fbcdn.net",
    "facebook.com",
    "scontent",
    "video.xx.fbcdn.net",
    "video-sea1-1.xx.fbcdn.net",
  ];
  const isAllowed =
    allowedHosts.some((h) => parsedUrl.hostname.includes(h)) ||
    parsedUrl.hostname.endsWith("fbcdn.net");

  // Also allow Supabase storage URLs (safe to proxy own content)
  const isSupabaseStorage = parsedUrl.hostname.includes("supabase.co");

  if (!isAllowed && !isSupabaseStorage) {
    return new Response(JSON.stringify({ error: "URL not from an allowed domain" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Forward Range header if present (enables seeking in <video>)
  const upstreamHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; Verdanote/1.0)",
  };
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    upstreamHeaders["Range"] = rangeHeader;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(videoUrl, {
      signal: controller.signal,
      headers: upstreamHeaders,
    });

    clearTimeout(timer);

    if (!upstream.ok && upstream.status !== 206) {
      // Upstream failed -- likely expired URL
      return new Response(
        JSON.stringify({
          error: "upstream_error",
          status: upstream.status,
          message: "Video URL expired or unreachable. Re-open the ad to refresh.",
        }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    const contentType = upstream.headers.get("content-type") || "video/mp4";
    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges") || "bytes";

    const responseHeaders: Record<string, string> = {
      ...CORS_HEADERS,
      "Content-Type": contentType,
      "Accept-Ranges": acceptRanges,
      // Cache aggressively -- the proxy URL itself is stable (it contains the upstream URL)
      "Cache-Control": "public, max-age=3600",
    };

    if (contentLength) responseHeaders["Content-Length"] = contentLength;
    if (contentRange) responseHeaders["Content-Range"] = contentRange;

    // Stream the response body
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return new Response(
      JSON.stringify({
        error: isAbort ? "timeout" : "proxy_error",
        message: isAbort ? "Upstream request timed out" : String(err),
      }),
      {
        status: 504,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }
});
