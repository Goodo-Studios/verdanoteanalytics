// =============================================
// Ad Library Feature — TypeScript Types
// =============================================

/** A board (collection) of saved ads, optionally inside a folder */
export interface AdLibraryBoard {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  is_public: boolean;
  share_token: string | null;
  created_at: string;
  updated_at: string;
  /** Computed client-side */
  ad_count?: number;
}

/** A saved ad from Facebook Ad Library or manually added */
/** A single stored media file in Supabase Storage */
export interface StoredMediaItem {
  original_url: string;
  stored_url: string;
  type: "image" | "video" | "carousel_frame" | "video_thumbnail";
  mime_type: string;
  file_size_bytes: number;
  width?: number;
  height?: number;
  position: number;
  download_failed?: boolean;
}

/** A saved ad from Facebook Ad Library or manually added */
export interface AdLibrarySavedAd {
  id: string;
  user_id: string;
  source_url: string;
  advertiser_name: string | null;
  advertiser_page_id: string | null;
  ad_id: string | null;
  platform: string;
  ad_status: string | null;
  ad_format: string | null;
  headline: string | null;
  body_text: string | null;
  cta_text: string | null;
  landing_page_url: string | null;
  media_urls: string[];
  thumbnail_url: string | null;
  started_running: string | null;
  country_targeting: string[];
  raw_data: Record<string, unknown> | null;
  notes: string | null;
  transcript: string | null;
  transcript_status: "none" | "processing" | "completed" | "failed";
  stored_media: StoredMediaItem[];
  created_at: string;
  updated_at: string;
  /** Joined client-side */
  tags?: AdLibraryTag[];
}

/** A user-defined tag */
export interface AdLibraryTag {
  id: string;
  user_id: string;
  name: string;
  color: string;
}

