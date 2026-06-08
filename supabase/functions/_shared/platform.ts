export const PLATFORM_MAP: Record<string, string> = {
  "tiktok.com": "tiktok",
  "instagram.com": "instagram",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "twitter.com": "twitter",
  "x.com": "twitter",
  "facebook.com": "facebook_ad",
  "linkedin.com": "linkedin",
};

export const VIDEO_PLATFORMS = [
  "tiktok.com",
  "instagram.com",
  "youtube.com/shorts",
  "youtu.be",
  "twitter.com",
  "x.com",
  "facebook.com/ads/library",
  "linkedin.com",
];

export const VIDEO_URL_PATTERN =
  /https?:\/\/(www\.)?(tiktok\.com|instagram\.com|youtube\.com\/shorts|youtu\.be|twitter\.com|x\.com|facebook\.com\/ads\/library|linkedin\.com)[^\s><"'|]*/g;

export function detectPlatform(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    for (const [domain, platform] of Object.entries(PLATFORM_MAP)) {
      if (hostname.includes(domain)) return platform;
    }
  } catch { /* ignore invalid URLs */ }
  return "unknown";
}

export function isVideoUrl(url: string): boolean {
  return VIDEO_PLATFORMS.some((p) => url.includes(p));
}
