import { toast } from "sonner";

interface ZipExportResult {
  download_url?: string | null;
  file_count?: number;
  error?: string | null;
}

/**
 * Tell the user the ZIP is ready and let them open it with a click. Opening a window after the
 * export finishes is no longer part of the user's click, so popup blockers stop it; the Download
 * button in the toast is a fresh click, which they allow (audit plan item 3.2).
 */
export function announceZipExport(res: ZipExportResult) {
  const url = res.download_url;
  if (!url) {
    toast.error(res.error ?? "Export produced no file");
    return;
  }
  const count = res.file_count ?? 0;
  toast.success(`Zip ready: ${count} file${count === 1 ? "" : "s"}`, {
    duration: 60_000,
    action: { label: "Download", onClick: () => window.open(url, "_blank", "noopener") },
  });
}
