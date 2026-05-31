import { useCallback, useEffect, useRef, useState } from "react";

const CACHE_NAME = "verdanote-media-cache-v1";
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days


/**
 * Returns true for URLs that are video files (won't cache well as blobs in IndexedDB).
 * Videos are large and already streamed by the browser -- skip IndexedDB caching for them.
 */
function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes(".mp4") ||
    lower.includes(".webm") ||
    lower.includes(".mov") ||
    lower.includes("video/") ||
    lower.includes("fbcdn.net") && lower.includes("video") ||
    lower.includes("/video-proxy")
  );
}

interface CachedMedia {
  url: string;
  blob: Blob;
  timestamp: number;
  contentType: string;
}

class MediaCache {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(CACHE_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("media")) {
          db.createObjectStore("media", { keyPath: "url" });
        }
      };
    });

    return this.initPromise;
  }

  async get(url: string): Promise<string | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["media"], "readonly");
      const store = tx.objectStore("media");
      const request = store.get(url);

      request.onsuccess = () => {
        const result: CachedMedia | undefined = request.result;
        if (!result) return resolve(null);

        // Check expiration
        if (Date.now() - result.timestamp > CACHE_DURATION) {
          this.delete(url);
          return resolve(null);
        }

        // Create object URL from blob
        const objectUrl = URL.createObjectURL(result.blob);
        resolve(objectUrl);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async set(url: string, blob: Blob): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["media"], "readwrite");
      const store = tx.objectStore("media");
      const request = store.put({
        url,
        blob,
        timestamp: Date.now(),
        contentType: blob.type,
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(url: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["media"], "readwrite");
      const store = tx.objectStore("media");
      const request = store.delete(url);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["media"], "readwrite");
      const store = tx.objectStore("media");
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

const mediaCache = new MediaCache();

interface UseCachedMediaOptions {
  fallbackUrl?: string;
  placeholderUrl?: string;
  // Called when a non-storage (CDN) url fails to load — almost always an expired Meta
  // fbcdn url. Consumers wire this to trigger an on-demand re-cache (cache-creative-image)
  // so the dead url is replaced with a permanent storage url, instead of looping on it.
  onExpired?: (url: string) => void;
}

/** Permanent Supabase Storage urls never expire; everything else (fbcdn CDN) can. */
function isStorageUrl(url: string): boolean {
  return url.includes("/storage/v1/object/public/");
}

export function useCachedMedia(
  mediaUrl: string | null | undefined,
  options: UseCachedMediaOptions = {}
) {
  const { fallbackUrl, placeholderUrl = "/placeholder-creative.png", onExpired } = options;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Track the previous blob URL so we can revoke it when a new one is created,
  // preventing the memory leak where stale blob URLs accumulate.
  const previousObjectUrlRef = useRef<string | null>(null);

  const loadMedia = useCallback(async () => {
    if (!mediaUrl) {
      setObjectUrl(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Videos are large and streamed natively by the browser -- skip IndexedDB caching.
      // Just return the URL directly so the browser handles it natively.
      if (isVideoUrl(mediaUrl)) {
        setObjectUrl(mediaUrl);
        setIsLoading(false);
        return;
      }

      // Check cache first
      const cached = await mediaCache.get(mediaUrl);
      if (cached) {
        // Revoke previous blob URL before setting new one
        if (previousObjectUrlRef.current && previousObjectUrlRef.current.startsWith("blob:")) {
          URL.revokeObjectURL(previousObjectUrlRef.current);
        }
        previousObjectUrlRef.current = cached;
        setObjectUrl(cached);
        setIsLoading(false);
        return;
      }

      // Fetch from network -- images only at this point
      const response = await fetch(mediaUrl, {
        credentials: "omit", // Don't send cookies to Meta
      });

      if (!response.ok) {
        throw new Error(`Failed to load media: ${response.status}`);
      }

      const blob = await response.blob();
      await mediaCache.set(mediaUrl, blob);

      const url = URL.createObjectURL(blob);
      // Revoke previous blob URL before setting new one
      if (previousObjectUrlRef.current && previousObjectUrlRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(previousObjectUrlRef.current);
      }
      previousObjectUrlRef.current = url;
      setObjectUrl(url);
    } catch (err) {
      console.error("Media load error:", err);
      setError(err as Error);
      if (mediaUrl && isStorageUrl(mediaUrl)) {
        // Permanent storage url — the failure is transient (network blip). The <img> tag can
        // still load it cross-origin even when fetch() couldn't, so it's worth reusing.
        setObjectUrl(mediaUrl);
      } else {
        // Non-storage CDN url that failed = expired Meta fbcdn url. Reusing it just loops on a
        // dead link. Show the fallback/placeholder and signal a re-cache to replace it.
        setObjectUrl(fallbackUrl || placeholderUrl);
        if (mediaUrl && onExpired) onExpired(mediaUrl);
      }
    } finally {
      setIsLoading(false);
    }
  }, [mediaUrl, fallbackUrl, placeholderUrl, onExpired]);

  useEffect(() => {
    loadMedia();

    // Cleanup object URL on unmount
    return () => {
      if (previousObjectUrlRef.current && previousObjectUrlRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(previousObjectUrlRef.current);
        previousObjectUrlRef.current = null;
      }
    };
  }, [mediaUrl]);

  return {
    url: objectUrl || placeholderUrl,
    isLoading,
    error,
    retry: loadMedia,
  };
}

// Preload multiple media URLs in background with concurrency limit
export function preloadMedia(urls: string[]): void {
  const CONCURRENCY = 4;
  let active = 0;
  const queue = [...urls];

  function next() {
    while (active < CONCURRENCY && queue.length > 0) {
      const url = queue.shift()!;
      if (isVideoUrl(url)) continue; // skip videos
      active++;
      mediaCache.get(url).then((cached) => {
        if (cached) { active--; next(); return; }
        fetch(url, { credentials: "omit" })
          .then((res) => res.blob())
          .then((blob) => mediaCache.set(url, blob))
          .catch(() => {})
          .finally(() => { active--; next(); });
      }).catch(() => { active--; next(); });
    }
  }
  next();
}

export { mediaCache };
