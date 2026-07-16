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
  share_token: string | null;
  shared_at: string | null;
  created_at: string;
}

// Creative carousel/multi-frame media (US-004).
// `public.creative_frames` + joined `media_assets` — neither is in the generated
// Verdanote `types.ts`, so we hand-type the row here and cast supabase calls with
// `as any` (same approach as InspirationItem above).
export type CreativeFrameMediaType =
  | "image"
  | "video"
  | "carousel_frame"
  | "video_thumbnail";

export interface CreativeFrame {
  id: string;
  ad_id: string;
  // 0-based render order; frames are queried `order("frame_index", ascending)`.
  frame_index: number;
  media_type: string;
  // FK → media_assets.id. NULL when the frame's media has not been cached yet.
  asset_id: string | null;
  created_at?: string;
  updated_at?: string;
  // Joined from media_assets on asset_id (may be absent when asset_id is NULL).
  media_assets?: {
    public_url: string | null;
    content_type: string | null;
    byte_size: number | null;
  } | null;
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
  "facebook_ad",
  "upload",
] as const;
export type VaultPlatformFilter = (typeof VAULT_PLATFORMS)[number];
