-- Audit plan item 7.1, part 1: the creatives list sorts on the server.
--
-- creatives_list_page always ordered by spend, so the Creatives page could only re-sort the
-- 100 rows it had loaded. Sorting by ROAS (or any other column) showed the best of the
-- top-spend page, not the best overall. The function now takes p_sort and p_sort_dir and
-- orders the whole filtered set before paging, in both the date-range and lifetime paths.
-- Unknown sort keys fall back to spend; nulls sort last; ad_id breaks ties.
--
-- Builds on 20261216280001 (same body, same video formulas). Ship this migration before
-- the creatives edge function that passes p_sort.

DROP FUNCTION IF EXISTS public.creatives_list_page(
  text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer
);

CREATE OR REPLACE FUNCTION public.creatives_list_page(
  p_allowed_ids text[]  DEFAULT NULL,
  p_account_id  text    DEFAULT NULL,
  p_date_from   date    DEFAULT NULL,
  p_date_to     date    DEFAULT NULL,
  p_ad_types    text[]  DEFAULT NULL,
  p_person      text    DEFAULT NULL,
  p_style       text    DEFAULT NULL,
  p_hook        text    DEFAULT NULL,
  p_product     text    DEFAULT NULL,
  p_theme       text    DEFAULT NULL,
  p_tag_source  text    DEFAULT NULL,
  p_ad_status   text    DEFAULT NULL,
  p_delivery    text    DEFAULT NULL,
  p_search      text    DEFAULT NULL,
  p_limit       integer DEFAULT 100,
  p_offset      integer DEFAULT 0,
  p_sort        text    DEFAULT 'spend',
  p_sort_dir    text    DEFAULT 'desc'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_cols constant text[] := ARRAY[
    'ad_id', 'account_id', 'ad_name', 'unique_code', 'ad_type', 'ad_status',
    'person', 'style', 'hook', 'product', 'theme', 'tag_source', 'notes',
    'spend', 'impressions', 'clicks', 'ctr', 'cpm', 'cpc', 'cpa', 'roas',
    'purchases', 'purchase_value', 'adds_to_cart', 'cost_per_add_to_cart',
    'video_views', 'thumb_stop_rate', 'hold_rate', 'frequency', 'video_avg_play_time',
    'play_curve', 'retention_p25', 'retention_p50', 'retention_p75', 'retention_p100',
    'campaign_name', 'adset_name', 'ad_post_url', 'thumbnail_url', 'full_res_url',
    'video_url', 'meta_video_ids'
  ];
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_scope  text[];
  v_limit  integer := GREATEST(COALESCE(p_limit, 100), 0);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_result jsonb;
  -- Sort keys the list may be ordered by (audit 7.1). Anything else falls back to spend.
  v_num_sorts constant text[] := ARRAY[
    'spend', 'roas', 'cpa', 'ctr', 'cpm', 'cpc', 'purchases', 'purchase_value',
    'impressions', 'clicks', 'adds_to_cart', 'cost_per_add_to_cart', 'video_views',
    'thumb_stop_rate', 'hold_rate', 'frequency', 'video_avg_play_time',
    'retention_p25', 'retention_p50', 'retention_p75', 'retention_p100'
  ];
  v_text_sorts constant text[] := ARRAY[
    'ad_name', 'ad_type', 'ad_status', 'person', 'style', 'hook', 'product', 'theme',
    'campaign_name', 'adset_name'
  ];
  v_sort text := CASE
    WHEN lower(COALESCE(p_sort, '')) = ANY (v_num_sorts || v_text_sorts) THEN lower(p_sort)
    ELSE 'spend' END;
  v_asc  boolean := lower(COALESCE(p_sort_dir, 'desc')) = 'asc';
  v_text boolean;
BEGIN
  v_text := v_sort = ANY (v_text_sorts);
  IF p_date_from IS NOT NULL OR p_date_to IS NOT NULL THEN
    -- Accounts whose daily rows are read: the picked account, else every account the
    -- caller may see (NULL allowed = staff = all accounts). Never wider than allowed.
    v_scope := ARRAY(
      SELECT a
        FROM unnest(
          CASE WHEN p_account_id IS NOT NULL THEN ARRAY[p_account_id]
               ELSE COALESCE(p_allowed_ids, ARRAY(SELECT id FROM public.ad_accounts)) END
        ) AS a
       WHERE p_allowed_ids IS NULL OR a = ANY (p_allowed_ids)
    );

    IF NOT EXISTS (
      SELECT 1 FROM public.creative_daily_metrics m
       WHERE m.account_id = ANY (v_scope)
         AND (p_date_from IS NULL OR m.date >= p_date_from)
         AND (p_date_to   IS NULL OR m.date <= p_date_to)
    ) THEN
      RETURN jsonb_build_object(
        'data', '[]'::jsonb, 'total', 0,
        'aggregates', jsonb_build_object('total_spend', 0, 'avg_cpa', 0, 'avg_roas', 0),
        'no_daily_data', true
      );
    END IF;

    WITH agg AS (
      SELECT
        m.ad_id,
        SUM(COALESCE(m.spend, 0))::numeric                AS spend,
        SUM(COALESCE(m.impressions, 0))::numeric          AS impressions,
        SUM(COALESCE(m.clicks, 0))::numeric               AS clicks,
        SUM(COALESCE(m.purchases, 0))::numeric            AS purchases,
        SUM(COALESCE(m.purchase_value, 0))::numeric       AS purchase_value,
        SUM(COALESCE(m.adds_to_cart, 0))::numeric         AS adds_to_cart,
        SUM(COALESCE(m.video_views, 0))::numeric          AS video_views,
        -- Video formulas shared with _shared/metric-math.ts (audit 6.1): frequency over every
        -- day's impressions; hook, hold and play time over days with video views, where a
        -- 0% hold or 0s play day still counts its views.
        SUM(m.frequency * m.impressions)      FILTER (WHERE m.impressions > 0) AS freq_w,
        SUM(m.impressions)                    FILTER (WHERE m.impressions > 0) AS freq_n,
        SUM(m.video_views * 100.0)            FILTER (WHERE m.video_views > 0 AND m.impressions > 0) AS tsr_w,
        SUM(m.impressions)                    FILTER (WHERE m.video_views > 0 AND m.impressions > 0) AS tsr_n,
        SUM(COALESCE(m.hold_rate, 0) * m.video_views) FILTER (WHERE m.video_views > 0) AS hr_w,
        SUM(m.video_views)                    FILTER (WHERE m.video_views > 0) AS hr_n,
        SUM(COALESCE(m.video_avg_play_time, 0) * m.video_views) FILTER (WHERE m.video_views > 0) AS vpt_w,
        SUM(m.video_views)                    FILTER (WHERE m.video_views > 0) AS vpt_n
      FROM public.creative_daily_metrics m
      WHERE m.account_id = ANY (v_scope)
        AND (p_date_from IS NULL OR m.date >= p_date_from)
        AND (p_date_to   IS NULL OR m.date <= p_date_to)
      GROUP BY m.ad_id
    ),
    calc AS (
      SELECT
        a.ad_id,
        a.spend, a.impressions, a.clicks, a.purchases, a.purchase_value, a.adds_to_cart, a.video_views,
        CASE WHEN a.impressions > 0 THEN (a.clicks / a.impressions) * 100 ELSE 0 END      AS ctr,
        CASE WHEN a.impressions > 0 THEN (a.spend / a.impressions) * 1000 ELSE 0 END      AS cpm,
        CASE WHEN a.clicks > 0 THEN a.spend / a.clicks ELSE 0 END                         AS cpc,
        CASE WHEN a.purchases > 0 THEN a.spend / a.purchases ELSE 0 END                   AS cpa,
        CASE WHEN a.spend > 0 THEN a.purchase_value / a.spend ELSE 0 END                  AS roas,
        CASE WHEN a.adds_to_cart > 0 THEN a.spend / a.adds_to_cart ELSE 0 END             AS cost_per_add_to_cart,
        CASE WHEN a.tsr_n > 0 THEN a.tsr_w / a.tsr_n ELSE 0 END                           AS thumb_stop_rate,
        CASE WHEN a.hr_n > 0 THEN a.hr_w / a.hr_n ELSE 0 END                              AS hold_rate,
        CASE WHEN a.freq_n > 0 THEN a.freq_w / a.freq_n ELSE 0 END                        AS frequency,
        CASE WHEN a.vpt_n > 0 THEN a.vpt_w / a.vpt_n ELSE 0 END                           AS video_avg_play_time
      FROM agg a
      JOIN public.creatives c ON c.ad_id = a.ad_id
      WHERE (p_delivery IS DISTINCT FROM 'had_delivery' OR a.spend > 0)
        AND (p_ad_types IS NULL OR c.ad_type = ANY (p_ad_types))
        AND (p_person     IS NULL OR c.person     = p_person)
        AND (p_style      IS NULL OR c.style      = p_style)
        AND (p_hook       IS NULL OR c.hook       = p_hook)
        AND (p_product    IS NULL OR c.product    = p_product)
        AND (p_theme      IS NULL OR c.theme      = p_theme)
        AND (p_tag_source IS NULL OR c.tag_source = p_tag_source)
        AND (p_ad_status  IS NULL OR c.ad_status  = p_ad_status)
        AND (v_search IS NULL
             OR c.ad_name       ILIKE '%' || v_search || '%'
             OR c.unique_code   ILIKE '%' || v_search || '%'
             OR c.campaign_name ILIKE '%' || v_search || '%')
    ),
    keyed AS (
      SELECT k.*,
             CASE v_sort
               WHEN 'spend' THEN k.spend WHEN 'roas' THEN k.roas WHEN 'cpa' THEN k.cpa
               WHEN 'ctr' THEN k.ctr WHEN 'cpm' THEN k.cpm WHEN 'cpc' THEN k.cpc
               WHEN 'purchases' THEN k.purchases WHEN 'purchase_value' THEN k.purchase_value
               WHEN 'impressions' THEN k.impressions WHEN 'clicks' THEN k.clicks
               WHEN 'adds_to_cart' THEN k.adds_to_cart
               WHEN 'cost_per_add_to_cart' THEN k.cost_per_add_to_cart
               WHEN 'video_views' THEN k.video_views WHEN 'thumb_stop_rate' THEN k.thumb_stop_rate
               WHEN 'hold_rate' THEN k.hold_rate WHEN 'frequency' THEN k.frequency
               WHEN 'video_avg_play_time' THEN k.video_avg_play_time
               WHEN 'retention_p25' THEN c.retention_p25::numeric
               WHEN 'retention_p50' THEN c.retention_p50::numeric
               WHEN 'retention_p75' THEN c.retention_p75::numeric
               WHEN 'retention_p100' THEN c.retention_p100::numeric
             END AS sort_num,
             CASE v_sort
               WHEN 'ad_name' THEN lower(c.ad_name) WHEN 'ad_type' THEN lower(c.ad_type)
               WHEN 'ad_status' THEN lower(c.ad_status) WHEN 'person' THEN lower(c.person)
               WHEN 'style' THEN lower(c.style) WHEN 'hook' THEN lower(c.hook)
               WHEN 'product' THEN lower(c.product) WHEN 'theme' THEN lower(c.theme)
               WHEN 'campaign_name' THEN lower(c.campaign_name)
               WHEN 'adset_name' THEN lower(c.adset_name)
             END AS sort_text
        FROM calc k
        JOIN public.creatives c ON c.ad_id = k.ad_id
    ),
    page AS (
      SELECT q.*
        FROM keyed q
       ORDER BY CASE WHEN v_asc AND NOT v_text THEN q.sort_num END ASC NULLS LAST,
                CASE WHEN NOT v_asc AND NOT v_text THEN q.sort_num END DESC NULLS LAST,
                CASE WHEN v_asc AND v_text THEN q.sort_text END ASC NULLS LAST,
                CASE WHEN NOT v_asc AND v_text THEN q.sort_text END DESC NULLS LAST,
                q.ad_id
       LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'data', COALESCE((
        SELECT jsonb_agg(
                 (SELECT jsonb_object_agg(e.key, e.value)
                    FROM jsonb_each(to_jsonb(c)) e
                   WHERE e.key = ANY (v_cols))
                 || jsonb_build_object(
                      'spend', p.spend, 'impressions', p.impressions, 'clicks', p.clicks,
                      'ctr', p.ctr, 'cpm', p.cpm, 'cpc', p.cpc, 'cpa', p.cpa, 'roas', p.roas,
                      'purchases', p.purchases, 'purchase_value', p.purchase_value,
                      'adds_to_cart', p.adds_to_cart,
                      'cost_per_add_to_cart', p.cost_per_add_to_cart,
                      'video_views', p.video_views,
                      'thumb_stop_rate', p.thumb_stop_rate, 'hold_rate', p.hold_rate,
                      'frequency', p.frequency, 'video_avg_play_time', p.video_avg_play_time)
                 ORDER BY CASE WHEN v_asc AND NOT v_text THEN p.sort_num END ASC NULLS LAST,
                          CASE WHEN NOT v_asc AND NOT v_text THEN p.sort_num END DESC NULLS LAST,
                          CASE WHEN v_asc AND v_text THEN p.sort_text END ASC NULLS LAST,
                          CASE WHEN NOT v_asc AND v_text THEN p.sort_text END DESC NULLS LAST,
                          p.ad_id)
          FROM page p
          JOIN public.creatives c ON c.ad_id = p.ad_id
      ), '[]'::jsonb),
      'total', (SELECT count(*) FROM calc),
      'aggregates', (
        SELECT jsonb_build_object(
          'total_spend', COALESCE(SUM(k.spend), 0),
          'avg_cpa',  CASE WHEN COALESCE(SUM(k.purchases), 0) > 0 THEN SUM(k.spend) / SUM(k.purchases) ELSE 0 END,
          'avg_roas', CASE WHEN COALESCE(SUM(k.spend), 0) > 0 THEN SUM(k.purchase_value) / SUM(k.spend) ELSE 0 END)
          FROM calc k)
    ) INTO v_result;

    RETURN v_result;
  END IF;

  -- No date filter: lifetime totals stored on creatives.
  WITH f AS (
    SELECT c.ad_id, COALESCE(c.spend, 0) AS spend, COALESCE(c.purchases, 0) AS purchases,
           COALESCE(c.purchase_value, 0) AS purchase_value,
           CASE v_sort
             WHEN 'spend' THEN c.spend::numeric WHEN 'roas' THEN c.roas::numeric
             WHEN 'cpa' THEN c.cpa::numeric WHEN 'ctr' THEN c.ctr::numeric
             WHEN 'cpm' THEN c.cpm::numeric WHEN 'cpc' THEN c.cpc::numeric
             WHEN 'purchases' THEN c.purchases::numeric
             WHEN 'purchase_value' THEN c.purchase_value::numeric
             WHEN 'impressions' THEN c.impressions::numeric WHEN 'clicks' THEN c.clicks::numeric
             WHEN 'adds_to_cart' THEN c.adds_to_cart::numeric
             WHEN 'cost_per_add_to_cart' THEN c.cost_per_add_to_cart::numeric
             WHEN 'video_views' THEN c.video_views::numeric
             WHEN 'thumb_stop_rate' THEN c.thumb_stop_rate::numeric
             WHEN 'hold_rate' THEN c.hold_rate::numeric WHEN 'frequency' THEN c.frequency::numeric
             WHEN 'video_avg_play_time' THEN c.video_avg_play_time::numeric
             WHEN 'retention_p25' THEN c.retention_p25::numeric
             WHEN 'retention_p50' THEN c.retention_p50::numeric
             WHEN 'retention_p75' THEN c.retention_p75::numeric
             WHEN 'retention_p100' THEN c.retention_p100::numeric
           END AS sort_num,
           CASE v_sort
             WHEN 'ad_name' THEN lower(c.ad_name) WHEN 'ad_type' THEN lower(c.ad_type)
             WHEN 'ad_status' THEN lower(c.ad_status) WHEN 'person' THEN lower(c.person)
             WHEN 'style' THEN lower(c.style) WHEN 'hook' THEN lower(c.hook)
             WHEN 'product' THEN lower(c.product) WHEN 'theme' THEN lower(c.theme)
             WHEN 'campaign_name' THEN lower(c.campaign_name)
             WHEN 'adset_name' THEN lower(c.adset_name)
           END AS sort_text
      FROM public.creatives c
     WHERE (p_allowed_ids IS NULL OR c.account_id = ANY (p_allowed_ids))
       AND (p_account_id  IS NULL OR c.account_id = p_account_id)
       AND (p_ad_types    IS NULL OR c.ad_type = ANY (p_ad_types))
       AND (p_person      IS NULL OR c.person      = p_person)
       AND (p_style       IS NULL OR c.style       = p_style)
       AND (p_hook        IS NULL OR c.hook        = p_hook)
       AND (p_product     IS NULL OR c.product     = p_product)
       AND (p_theme       IS NULL OR c.theme       = p_theme)
       AND (p_tag_source  IS NULL OR c.tag_source  = p_tag_source)
       AND (p_ad_status   IS NULL OR c.ad_status   = p_ad_status)
       AND (p_delivery IS DISTINCT FROM 'had_delivery' OR c.spend > 0)
       AND (p_delivery IS DISTINCT FROM 'active' OR c.ad_status = 'ACTIVE')
       AND (v_search IS NULL
            OR c.ad_name       ILIKE '%' || v_search || '%'
            OR c.unique_code   ILIKE '%' || v_search || '%'
            OR c.campaign_name ILIKE '%' || v_search || '%')
  ),
  page AS (
    SELECT f.ad_id, f.sort_num, f.sort_text
      FROM f
     ORDER BY CASE WHEN v_asc AND NOT v_text THEN f.sort_num END ASC NULLS LAST,
              CASE WHEN NOT v_asc AND NOT v_text THEN f.sort_num END DESC NULLS LAST,
              CASE WHEN v_asc AND v_text THEN f.sort_text END ASC NULLS LAST,
              CASE WHEN NOT v_asc AND v_text THEN f.sort_text END DESC NULLS LAST,
              f.ad_id
     LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'data', COALESCE((
      SELECT jsonb_agg(
               (SELECT jsonb_object_agg(e.key, e.value)
                  FROM jsonb_each(to_jsonb(c)) e
                 WHERE e.key = ANY (v_cols))
               ORDER BY CASE WHEN v_asc AND NOT v_text THEN p.sort_num END ASC NULLS LAST,
                        CASE WHEN NOT v_asc AND NOT v_text THEN p.sort_num END DESC NULLS LAST,
                        CASE WHEN v_asc AND v_text THEN p.sort_text END ASC NULLS LAST,
                        CASE WHEN NOT v_asc AND v_text THEN p.sort_text END DESC NULLS LAST,
                        p.ad_id)
        FROM page p
        JOIN public.creatives c ON c.ad_id = p.ad_id
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM f),
    'aggregates', (
      SELECT jsonb_build_object(
        'total_spend', COALESCE(SUM(f.spend), 0),
        'avg_cpa',  CASE WHEN COALESCE(SUM(f.purchases), 0) > 0 THEN SUM(f.spend) / SUM(f.purchases) ELSE 0 END,
        'avg_roas', CASE WHEN COALESCE(SUM(f.spend), 0) > 0 THEN SUM(f.purchase_value) / SUM(f.spend) ELSE 0 END)
        FROM f)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.creatives_list_page(
  text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer, text, text
) IS
  'One-statement page for the creatives edge function (GET /creatives). Trusts p_allowed_ids / p_account_id, so service_role only. Sorts the whole filtered set by p_sort / p_sort_dir before paging (audit 7.1). Same math as _shared/creatives-aggregate.ts.';

REVOKE ALL ON FUNCTION public.creatives_list_page(
  text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creatives_list_page(
  text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer, text, text
) TO service_role;
