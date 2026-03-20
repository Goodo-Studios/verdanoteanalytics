// =============================================
// Ad Library Feature — TypeScript Types
// =============================================

/** A folder that groups boards together */
export interface AdLibraryFolder {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

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
  type: "image" | "video" | "carousel_frame";
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

/** Junction: a saved ad's position within a board */
export interface AdLibraryBoardAd {
  id: string;
  board_id: string;
  ad_id: string;
  position: number;
  added_at: string;
}

/** A user-defined tag */
export interface AdLibraryTag {
  id: string;
  user_id: string;
  name: string;
  color: string;
}

/** Junction: tag applied to a saved ad */
export interface AdLibraryAdTag {
  ad_id: string;
  tag_id: string;
}

// =============================================
// Insert / Update helpers
// =============================================

export type AdLibraryFolderInsert = Omit<AdLibraryFolder, "id" | "created_at" | "updated_at">;
export type AdLibraryFolderUpdate = Partial<Pick<AdLibraryFolder, "name" | "description" | "color">>;

export type AdLibraryBoardInsert = Omit<AdLibraryBoard, "id" | "created_at" | "updated_at" | "ad_count">;
export type AdLibraryBoardUpdate = Partial<Pick<AdLibraryBoard, "name" | "description" | "folder_id" | "cover_image_url" | "is_public" | "share_token">>;

export type AdLibrarySavedAdInsert = Omit<AdLibrarySavedAd, "id" | "created_at" | "updated_at" | "tags">;
export type AdLibrarySavedAdUpdate = Partial<Omit<AdLibrarySavedAd, "id" | "user_id" | "created_at" | "updated_at" | "tags">>;

export type AdLibraryTagInsert = Omit<AdLibraryTag, "id">;
export type AdLibraryTagUpdate = Partial<Pick<AdLibraryTag, "name" | "color">>;

// =============================================
// Edge Function response type (scrape-ad)
// =============================================

export interface ScrapeAdResponse {
  success: boolean;
  data: {
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
  } | null;
  error?: string;
}
