// Vault types — mirror inspiration_items schema (US-001).
// These DB tables aren't in the generated Verdanote `types.ts` yet,
// so we type the rows here and cast supabase calls with `as any`.

export type VaultPlatform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "twitter"
  | "facebook_ad"
  | "upload"
  | "unknown";

export type VaultStatus =
  | "pending"
  | "extracting"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "error";

export interface InspirationItem {
  id: string;
  user_id: string;
  source_url: string | null;
  platform: string | null;
  creator_handle: string | null;
  title: string | null;
  thumbnail_url: string | null;
  thumbnail_path: string | null;
  video_url: string | null;
  file_path: string | null;
  ad_archive_id: string | null;
  ad_body_text: string | null;
  saved_by: string | null;
  status: string;
  error_message: string | null;
  brand_name: string | null;
  industry: string | null;
  ad_format: string | null;
  target_audience: string | null;
  is_featured: boolean;
  hook_verbal_saved: boolean;
  hook_text_saved: boolean;
  hook_visual_saved: boolean;
  script_analysis: string | null;
  visual_analysis: string | null;
  created_at: string;
}

export interface InspirationTranscript {
  id: string;
  item_id: string;
  cleaned_script: string | null;
}

export interface InspirationFramework {
  id: string;
  item_id: string;
  hook_verbal: string | null;
  hook_text: string | null;
  hook_visual: string | null;
  hook_formula: string | null;
  copywriting_framework: string | null;
}

export type LibraryItem = InspirationItem & {
  inspiration_transcripts?: { cleaned_script: string | null }[];
  inspiration_frameworks?: {
    hook_verbal: string | null;
    hook_text: string | null;
    hook_formula: string | null;
    copywriting_framework: string | null;
  }[];
};

export const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube Shorts",
  twitter: "Twitter / X",
  facebook_ad: "Meta Ad",
  upload: "Upload",
  unknown: "Unknown",
};

export const PLATFORM_COLORS: Record<string, string> = {
  tiktok: "bg-black text-white",
  instagram: "bg-gradient-to-r from-purple-500 to-pink-500 text-white",
  youtube: "bg-red-600 text-white",
  twitter: "bg-sky-500 text-white",
  facebook_ad: "bg-blue-600 text-white",
  upload: "bg-gray-500 text-white",
  unknown: "bg-gray-400 text-white",
};

export const STATUS_LABELS: Record<string, string> = {
  pending: "Queued",
  extracting: "Extracting video...",
  transcribing: "Transcribing...",
  analyzing: "Analyzing...",
  ready: "Ready",
  error: "Error",
};

export const VAULT_PROCESSING_STATUSES = new Set([
  "pending",
  "extracting",
  "transcribing",
  "analyzing",
]);

export const VAULT_TERMINAL_STATUSES = new Set(["ready", "error"]);

export const VAULT_PLATFORMS = [
  "all",
  "tiktok",
  "instagram",
  "youtube",
  "twitter",
  "upload",
] as const;
export type VaultPlatformFilter = (typeof VAULT_PLATFORMS)[number];
