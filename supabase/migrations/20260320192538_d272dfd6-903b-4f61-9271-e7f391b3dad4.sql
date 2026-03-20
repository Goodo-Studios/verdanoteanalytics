
-- Clean slate: drop old tables
DROP TABLE IF EXISTS public.ad_library_collection_items CASCADE;
DROP TABLE IF EXISTS public.ad_library_collections CASCADE;
DROP TABLE IF EXISTS public.ad_library_saved_ads CASCADE;
DROP TABLE IF EXISTS public.ad_library_board_ads CASCADE;
DROP TABLE IF EXISTS public.ad_library_ad_tags CASCADE;
DROP TABLE IF EXISTS public.ad_library_tags CASCADE;
DROP TABLE IF EXISTS public.ad_library_boards CASCADE;
DROP TABLE IF EXISTS public.ad_library_folders CASCADE;

-- Drop functions if they exist
DROP FUNCTION IF EXISTS public.owns_ad_library_board(uuid);
DROP FUNCTION IF EXISTS public.board_is_public(uuid);
DROP FUNCTION IF EXISTS public.owns_ad_library_ad(uuid);
DROP FUNCTION IF EXISTS public.ad_is_on_public_board(uuid);

-- ======= 1. FOLDERS =======
CREATE TABLE public.ad_library_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_library_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "folders_select" ON public.ad_library_folders FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "folders_insert" ON public.ad_library_folders FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "folders_update" ON public.ad_library_folders FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "folders_delete" ON public.ad_library_folders FOR DELETE USING (user_id = auth.uid());

-- ======= 2. BOARDS =======
CREATE TABLE public.ad_library_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.ad_library_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  is_public BOOLEAN DEFAULT false,
  share_token TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_library_boards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "boards_select_own" ON public.ad_library_boards FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "boards_select_public" ON public.ad_library_boards FOR SELECT USING (is_public = true);
CREATE POLICY "boards_insert" ON public.ad_library_boards FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "boards_update" ON public.ad_library_boards FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "boards_delete" ON public.ad_library_boards FOR DELETE USING (user_id = auth.uid());
CREATE INDEX idx_ad_lib_boards_user ON public.ad_library_boards(user_id);
CREATE INDEX idx_ad_lib_boards_folder ON public.ad_library_boards(folder_id);
CREATE INDEX idx_ad_lib_boards_token ON public.ad_library_boards(share_token);

-- ======= 3. SAVED ADS =======
CREATE TABLE public.ad_library_saved_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  advertiser_name TEXT,
  advertiser_page_id TEXT,
  ad_id TEXT,
  platform TEXT DEFAULT 'facebook',
  ad_status TEXT,
  ad_format TEXT,
  headline TEXT,
  body_text TEXT,
  cta_text TEXT,
  landing_page_url TEXT,
  media_urls TEXT[] DEFAULT '{}',
  thumbnail_url TEXT,
  started_running DATE,
  country_targeting TEXT[] DEFAULT '{}',
  raw_data JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_library_saved_ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saved_ads_select" ON public.ad_library_saved_ads FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "saved_ads_insert" ON public.ad_library_saved_ads FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "saved_ads_update" ON public.ad_library_saved_ads FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "saved_ads_delete" ON public.ad_library_saved_ads FOR DELETE USING (user_id = auth.uid());
CREATE INDEX idx_ad_lib_ads_user ON public.ad_library_saved_ads(user_id);
CREATE INDEX idx_ad_lib_ads_advertiser ON public.ad_library_saved_ads(advertiser_name);
CREATE INDEX idx_ad_lib_ads_platform ON public.ad_library_saved_ads(platform);
CREATE INDEX idx_ad_lib_ads_format ON public.ad_library_saved_ads(ad_format);

-- ======= 4. BOARD-ADS JUNCTION =======
CREATE TABLE public.ad_library_board_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.ad_library_boards(id) ON DELETE CASCADE,
  ad_id UUID NOT NULL REFERENCES public.ad_library_saved_ads(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(board_id, ad_id)
);
ALTER TABLE public.ad_library_board_ads ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ad_lib_board_ads_board ON public.ad_library_board_ads(board_id);
CREATE INDEX idx_ad_lib_board_ads_ad ON public.ad_library_board_ads(ad_id);

-- ======= 5. TAGS =======
CREATE TABLE public.ad_library_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#8b5cf6',
  UNIQUE(user_id, name)
);
ALTER TABLE public.ad_library_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags_select" ON public.ad_library_tags FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "tags_insert" ON public.ad_library_tags FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "tags_update" ON public.ad_library_tags FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "tags_delete" ON public.ad_library_tags FOR DELETE USING (user_id = auth.uid());

-- ======= 6. AD-TAGS JUNCTION =======
CREATE TABLE public.ad_library_ad_tags (
  ad_id UUID NOT NULL REFERENCES public.ad_library_saved_ads(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.ad_library_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (ad_id, tag_id)
);
ALTER TABLE public.ad_library_ad_tags ENABLE ROW LEVEL SECURITY;

-- ======= SECURITY DEFINER FUNCTIONS =======
CREATE OR REPLACE FUNCTION public.owns_ad_library_board(_board_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.ad_library_boards WHERE id = _board_id AND user_id = auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.board_is_public(_board_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.ad_library_boards WHERE id = _board_id AND is_public = true) $$;

CREATE OR REPLACE FUNCTION public.owns_ad_library_ad(_ad_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.ad_library_saved_ads WHERE id = _ad_id AND user_id = auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.ad_is_on_public_board(_ad_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.ad_library_board_ads ba JOIN public.ad_library_boards b ON b.id = ba.board_id WHERE ba.ad_id = _ad_id AND b.is_public = true) $$;

-- Junction RLS using security definer functions
CREATE POLICY "board_ads_select_own" ON public.ad_library_board_ads FOR SELECT USING (public.owns_ad_library_board(board_id));
CREATE POLICY "board_ads_select_public" ON public.ad_library_board_ads FOR SELECT USING (public.board_is_public(board_id));
CREATE POLICY "board_ads_insert" ON public.ad_library_board_ads FOR INSERT WITH CHECK (public.owns_ad_library_board(board_id));
CREATE POLICY "board_ads_update" ON public.ad_library_board_ads FOR UPDATE USING (public.owns_ad_library_board(board_id));
CREATE POLICY "board_ads_delete" ON public.ad_library_board_ads FOR DELETE USING (public.owns_ad_library_board(board_id));

CREATE POLICY "saved_ads_select_public" ON public.ad_library_saved_ads FOR SELECT USING (public.ad_is_on_public_board(id));

CREATE POLICY "ad_tags_select" ON public.ad_library_ad_tags FOR SELECT USING (public.owns_ad_library_ad(ad_id));
CREATE POLICY "ad_tags_insert" ON public.ad_library_ad_tags FOR INSERT WITH CHECK (public.owns_ad_library_ad(ad_id));
CREATE POLICY "ad_tags_delete" ON public.ad_library_ad_tags FOR DELETE USING (public.owns_ad_library_ad(ad_id));
