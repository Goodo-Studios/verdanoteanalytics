import { supabase } from "@/integrations/supabase/client";

export interface DownloadableVaultItem {
  id: string;
  file_path?: string | null;
  thumbnail_path?: string | null;
}

export interface VaultDownloadResult {
  requested: number;
  started: number;
  /** Items with no stored file, or whose file could not be signed. */
  skipped: number;
}

export interface VaultDownloadDeps {
  /** Signs the paths for download. Entries without a URL are skipped. */
  sign: (paths: string[]) => Promise<{ path: string | null; signedUrl: string | null }[]>;
  /** Starts one browser download. */
  trigger: (url: string) => void;
  /** Gap between downloads; browsers drop a burst of them. */
  pause: () => Promise<void>;
}

/** The stored file for an item: the video or image, falling back to the saved still. */
export function downloadPathFor(item: DownloadableVaultItem): string | null {
  return item.file_path || item.thumbnail_path || null;
}

const DEFAULT_DEPS: VaultDownloadDeps = {
  sign: async (paths) => {
    const { data, error } = await supabase.storage
      .from("inspiration-media")
      .createSignedUrls(paths, 600, { download: true });
    if (error) throw error;
    return data ?? [];
  },
  trigger: (url) => {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
  pause: () => new Promise((resolve) => setTimeout(resolve, 450)),
};

/**
 * Downloads the stored file of each item. The links ask the server for an attachment, so each
 * file saves instead of opening in a tab. The browser may ask once to allow several downloads.
 */
export async function downloadVaultItems(
  items: DownloadableVaultItem[],
  deps: VaultDownloadDeps = DEFAULT_DEPS,
): Promise<VaultDownloadResult> {
  const paths = [...new Set(items.map(downloadPathFor).filter((p): p is string => !!p))];
  if (paths.length === 0) return { requested: items.length, started: 0, skipped: items.length };

  const signed = await deps.sign(paths);
  const urls = signed.filter((s) => s.path && s.signedUrl).map((s) => s.signedUrl as string);

  let started = 0;
  for (const url of urls) {
    if (started > 0) await deps.pause();
    deps.trigger(url);
    started += 1;
  }
  return { requested: items.length, started, skipped: Math.max(0, items.length - started) };
}

/** The toast for a finished bulk download. */
export function vaultDownloadMessage({ requested, started, skipped }: VaultDownloadResult): {
  ok: boolean;
  text: string;
} {
  const noun = (n: number) => `${n} file${n === 1 ? "" : "s"}`;
  if (started === 0) return { ok: false, text: "Nothing to download. The selected items have no saved file." };
  if (skipped === 0) return { ok: true, text: `Downloading ${noun(started)}` };
  return {
    ok: false,
    text: `Downloading ${noun(started)}. ${skipped} of ${requested} had no saved file.`,
  };
}
