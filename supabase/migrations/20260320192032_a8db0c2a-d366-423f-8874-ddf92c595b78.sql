
-- Collections to organize saved ads
CREATE TABLE public.ad_library_collections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  account_id TEXT REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saved ads (from FB Ad Library or manually added)
CREATE TABLE public.ad_library_saved_ads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id TEXT REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  brand_name TEXT,
  page_id TEXT,
  ad_archive_id TEXT,
  headline TEXT,
  body_text TEXT,
  cta_type TEXT,
  media_type TEXT DEFAULT 'image',
  thumbnail_url TEXT,
  video_url TEXT,
  landing_page_url TEXT,
  platform TEXT DEFAULT 'meta',
  started_running TEXT,
  is_active BOOLEAN DEFAULT true,
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Junction table for ads in collections
CREATE TABLE public.ad_library_collection_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID REFERENCES public.ad_library_collections(id) ON DELETE CASCADE NOT NULL,
  saved_ad_id UUID REFERENCES public.ad_library_saved_ads(id) ON DELETE CASCADE NOT NULL,
  position INTEGER DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(collection_id, saved_ad_id)
);

-- RLS
ALTER TABLE public.ad_library_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_library_saved_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_library_collection_items ENABLE ROW LEVEL SECURITY;

-- Collections: builder only for now
CREATE POLICY "Builder can manage ad_library_collections"
  ON public.ad_library_collections FOR ALL
  USING (has_role(auth.uid(), 'builder'));

-- Saved ads: builder only
CREATE POLICY "Builder can manage ad_library_saved_ads"
  ON public.ad_library_saved_ads FOR ALL
  USING (has_role(auth.uid(), 'builder'));

-- Collection items: builder only
CREATE POLICY "Builder can manage ad_library_collection_items"
  ON public.ad_library_collection_items FOR ALL
  USING (has_role(auth.uid(), 'builder'));
