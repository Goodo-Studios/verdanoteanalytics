-- Audit plan item 7.1, part 3: the Creatives page's advanced filters cover the whole list.
--
-- The advanced filter panel (ROAS, spend, CTR, hook rate, CPA, grade, ad type, hook, status,
-- campaign, days running) ran over the 100 rows the page had loaded, so matching ads on
-- other pages never showed and the total ignored the filter. creatives_list_page takes the
-- panel's conditions as p_conditions (the same JSON the page keeps in the URL) and applies
-- them to the whole set before sorting, paging and totals. Grades stay over the set before
-- the advanced conditions, as on the page. Status uses frequency plus week-over-week ROAS
-- over two full UTC weeks ending yesterday (the rule from audit 6.5).
--
-- Builds on 20261216330001. Adds a parameter, so the old signature is dropped first.
-- Ship before the creatives edge function that passes p_conditions.

DROP FUNCTION IF EXISTS public.creatives_list_page(
  text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer, text, text
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
  p_sort_dir    text    DEFAULT 'desc',
  p_conditions  jsonb   DEFAULT NULL
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
    'grade', 'spend', 'roas', 'cpa', 'ctr', 'cpm', 'cpc', 'purchases', 'purchase_value',
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
        a.ad_id, c.account_id AS acct,
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
    dist AS (
      -- Grade sort only: one sorted spend list per account over the whole filtered set.
      SELECT s.acct, array_agg(-(s.spend)::float8 ORDER BY -(s.spend)::float8) AS neg,
             count(*) AS n, min(s.spend) AS mn, max(s.spend) AS mx
        FROM calc s
       WHERE s.spend > 0
       GROUP BY s.acct
    ),
    keyed AS (
      SELECT k.*,
             CASE v_sort
               WHEN 'grade' THEN (SELECT CASE WHEN (CASE WHEN k.spend > 0 THEN CASE WHEN d.mn = d.mx THEN 50::numeric ELSE (d.n - width_bucket(-(k.spend)::float8, d.neg)) * 100.0 / d.n END END) IS NULL THEN 6 WHEN (CASE WHEN k.spend > 0 THEN CASE WHEN d.mn = d.mx THEN 50::numeric ELSE (d.n - width_bucket(-(k.spend)::float8, d.neg)) * 100.0 / d.n END END) >= 80 THEN 1 WHEN (CASE WHEN k.spend > 0 THEN CASE WHEN d.mn = d.mx THEN 50::numeric ELSE (d.n - width_bucket(-(k.spend)::float8, d.neg)) * 100.0 / d.n END END) >= 60 THEN 2 WHEN (CASE WHEN k.spend > 0 THEN CASE WHEN d.mn = d.mx THEN 50::numeric ELSE (d.n - width_bucket(-(k.spend)::float8, d.neg)) * 100.0 / d.n END END) >= 40 THEN 3 WHEN (CASE WHEN k.spend > 0 THEN CASE WHEN d.mn = d.mx THEN 50::numeric ELSE (d.n - width_bucket(-(k.spend)::float8, d.neg)) * 100.0 / d.n END END) >= 20 THEN 4 ELSE 5 END FROM dist d WHERE d.acct = k.acct)
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
    ),
    -- Grades for the page's rows over the whole filtered set within each account (audit 7.1).
    -- edges: the page's distinct spends. hits: every spending ad in the account counted into the
    -- bucket width_bucket gives it (b = edges at or below its spend). An ad at edge j has
    -- cum(b = j - 1) ads spending strictly less.
    pv AS (
      SELECT p.acct, array_agg(DISTINCT p.spend::float8 ORDER BY p.spend::float8) AS edges
        FROM page p
       WHERE p.spend > 0
       GROUP BY p.acct
    ),
    hits AS MATERIALIZED (
      SELECT s.acct, width_bucket(s.spend::float8, pv.edges) AS b, count(*) AS c,
             min(s.spend) AS bmn, max(s.spend) AS bmx
        FROM calc s
        JOIN pv ON pv.acct = s.acct
       WHERE s.spend > 0
       GROUP BY s.acct, width_bucket(s.spend::float8, pv.edges)
    ),
    cum AS (
      SELECT h.acct, h.b, sum(h.c) OVER (PARTITION BY h.acct ORDER BY h.b) AS below_next
        FROM hits h
    ),
    accs AS (
      SELECT h.acct, sum(h.c) AS n, min(h.bmn) AS mn, max(h.bmx) AS mx
        FROM hits h
       GROUP BY h.acct
    ),
    pg AS MATERIALIZED (
      SELECT p.*,
             CASE WHEN p.spend > 0 THEN
               CASE WHEN st.mn = st.mx THEN 50::numeric
                    ELSE COALESCE(cb.below_next, 0) * 100.0 / st.n END
             END AS spend_pct
        FROM page p
        LEFT JOIN pv ON pv.acct = p.acct
        LEFT JOIN accs st ON st.acct = p.acct
        LEFT JOIN cum cb ON cb.acct = p.acct
                        AND cb.b = array_position(pv.edges, p.spend::float8) - 1
    )
    SELECT jsonb_build_object(
      'data', COALESCE((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'ad_id', c.ad_id, 'account_id', c.account_id, 'ad_name', c.ad_name, 'unique_code', c.unique_code,
                   'ad_type', c.ad_type, 'ad_status', c.ad_status, 'person', c.person, 'style', c.style,
                   'hook', c.hook, 'product', c.product, 'theme', c.theme, 'tag_source', c.tag_source,
                   'notes', c.notes, 'spend', c.spend, 'impressions', c.impressions, 'clicks', c.clicks,
                   'ctr', c.ctr, 'cpm', c.cpm, 'cpc', c.cpc, 'cpa', c.cpa,
                   'roas', c.roas, 'purchases', c.purchases, 'purchase_value', c.purchase_value, 'adds_to_cart', c.adds_to_cart,
                   'cost_per_add_to_cart', c.cost_per_add_to_cart, 'video_views', c.video_views, 'thumb_stop_rate', c.thumb_stop_rate, 'hold_rate', c.hold_rate,
                   'frequency', c.frequency, 'video_avg_play_time', c.video_avg_play_time, 'play_curve', c.play_curve, 'retention_p25', c.retention_p25,
                   'retention_p50', c.retention_p50, 'retention_p75', c.retention_p75, 'retention_p100', c.retention_p100, 'campaign_name', c.campaign_name,
                   'adset_name', c.adset_name, 'ad_post_url', c.ad_post_url, 'thumbnail_url', c.thumbnail_url, 'full_res_url', c.full_res_url,
                   'video_url', c.video_url, 'meta_video_ids', c.meta_video_ids)
                 || jsonb_build_object(
                      'spend', p.spend, 'impressions', p.impressions, 'clicks', p.clicks,
                      'ctr', p.ctr, 'cpm', p.cpm, 'cpc', p.cpc, 'cpa', p.cpa, 'roas', p.roas,
                      'purchases', p.purchases, 'purchase_value', p.purchase_value,
                      'adds_to_cart', p.adds_to_cart,
                      'cost_per_add_to_cart', p.cost_per_add_to_cart,
                      'video_views', p.video_views,
                      'thumb_stop_rate', p.thumb_stop_rate, 'hold_rate', p.hold_rate,
                      'frequency', p.frequency, 'video_avg_play_time', p.video_avg_play_time,
                      'grade', CASE WHEN p.spend_pct IS NULL THEN NULL WHEN p.spend_pct >= 80 THEN 'A' WHEN p.spend_pct >= 60 THEN 'B' WHEN p.spend_pct >= 40 THEN 'C' WHEN p.spend_pct >= 20 THEN 'D' ELSE 'F' END,
                      'spend_percentile', round(p.spend_pct))
                 ORDER BY CASE WHEN v_asc AND NOT v_text THEN p.sort_num END ASC NULLS LAST,
                          CASE WHEN NOT v_asc AND NOT v_text THEN p.sort_num END DESC NULLS LAST,
                          CASE WHEN v_asc AND v_text THEN p.sort_text END ASC NULLS LAST,
                          CASE WHEN NOT v_asc AND v_text THEN p.sort_text END DESC NULLS LAST,
                          p.ad_id)
          FROM pg p
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
    SELECT c.ad_id, c.account_id AS acct, COALESCE(c.spend, 0) AS spend, COALESCE(c.purchases, 0) AS purchases,
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
  dist AS (
    -- Grade sort only: one sorted spend list per account over the whole filtered set.
    SELECT s.acct, array_agg(-(s.spend)::float8 ORDER BY -(s.spend)::float8) AS neg,
           count(*) AS n, min(s.spend) AS mn, max(s.spend) AS mx
      FROM f s
     WHERE s.spend > 0
     GROUP BY s.acct
  ),
  graded AS (
    SELECT q.ad_id, q.acct, q.spend, q.sort_text,
           CASE WHEN v_sort = 'grade'
                THEN (SELECT CASE WHEN (CASE WHEN q.spend > 0 THEN CASE WHEN d.mn = d.mx THEN 50::numeric ELSE (d.n - width_bucket(-(q.spend)::float8, d.neg)) * 100.0 / d.n END END) IS NULL THEN 6 WHEN (CASE WHEN q.spend > 0 THEN CASE WHEN d.mn = d.mx THEN 50::numeric ELSE (d.n - width_bucket(-(q.spend)::float8, d.neg)) * 100.0 / d.n END END) >= 80 THEN 1 WHEN (CASE WHEN q.spend > 0 THEN CASE WHEN d.mn = d.mx THEN 50::numeric ELSE (d.n - width_bucket(-(q.spend)::float8, d.neg)) * 100.0 / d.n END END) >= 60 THEN 2 WHEN (CASE WHEN q.spend > 0 THEN CASE WHEN d.mn = d.mx THEN 50::numeric ELSE (d.n - width_bucket(-(q.spend)::float8, d.neg)) * 100.0 / d.n END END) >= 40 THEN 3 WHEN (CASE WHEN q.spend > 0 THEN CASE WHEN d.mn = d.mx THEN 50::numeric ELSE (d.n - width_bucket(-(q.spend)::float8, d.neg)) * 100.0 / d.n END END) >= 20 THEN 4 ELSE 5 END FROM dist d WHERE d.acct = q.acct)
                ELSE q.sort_num END AS sort_num
      FROM f q
  ),
  page AS (
    SELECT f.ad_id, f.acct, f.spend, f.sort_num, f.sort_text
      FROM graded f
     ORDER BY CASE WHEN v_asc AND NOT v_text THEN f.sort_num END ASC NULLS LAST,
              CASE WHEN NOT v_asc AND NOT v_text THEN f.sort_num END DESC NULLS LAST,
              CASE WHEN v_asc AND v_text THEN f.sort_text END ASC NULLS LAST,
              CASE WHEN NOT v_asc AND v_text THEN f.sort_text END DESC NULLS LAST,
              f.ad_id
     LIMIT v_limit OFFSET v_offset
  ),
  -- Grades for the page's rows over the whole filtered set within each account (audit 7.1).
  -- edges: the page's distinct spends. hits: every spending ad in the account counted into the
  -- bucket width_bucket gives it (b = edges at or below its spend). An ad at edge j has
  -- cum(b = j - 1) ads spending strictly less.
  pv AS (
    SELECT p.acct, array_agg(DISTINCT p.spend::float8 ORDER BY p.spend::float8) AS edges
      FROM page p
     WHERE p.spend > 0
     GROUP BY p.acct
  ),
  hits AS MATERIALIZED (
    SELECT s.acct, width_bucket(s.spend::float8, pv.edges) AS b, count(*) AS c,
           min(s.spend) AS bmn, max(s.spend) AS bmx
      FROM f s
      JOIN pv ON pv.acct = s.acct
     WHERE s.spend > 0
     GROUP BY s.acct, width_bucket(s.spend::float8, pv.edges)
  ),
  cum AS (
    SELECT h.acct, h.b, sum(h.c) OVER (PARTITION BY h.acct ORDER BY h.b) AS below_next
      FROM hits h
  ),
  accs AS (
    SELECT h.acct, sum(h.c) AS n, min(h.bmn) AS mn, max(h.bmx) AS mx
      FROM hits h
     GROUP BY h.acct
  ),
  pg AS MATERIALIZED (
    SELECT p.*,
           CASE WHEN p.spend > 0 THEN
             CASE WHEN st.mn = st.mx THEN 50::numeric
                  ELSE COALESCE(cb.below_next, 0) * 100.0 / st.n END
           END AS spend_pct
      FROM page p
      LEFT JOIN pv ON pv.acct = p.acct
      LEFT JOIN accs st ON st.acct = p.acct
      LEFT JOIN cum cb ON cb.acct = p.acct
                      AND cb.b = array_position(pv.edges, p.spend::float8) - 1
  )
  SELECT jsonb_build_object(
    'data', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'ad_id', c.ad_id, 'account_id', c.account_id, 'ad_name', c.ad_name, 'unique_code', c.unique_code,
                 'ad_type', c.ad_type, 'ad_status', c.ad_status, 'person', c.person, 'style', c.style,
                 'hook', c.hook, 'product', c.product, 'theme', c.theme, 'tag_source', c.tag_source,
                 'notes', c.notes, 'spend', c.spend, 'impressions', c.impressions, 'clicks', c.clicks,
                 'ctr', c.ctr, 'cpm', c.cpm, 'cpc', c.cpc, 'cpa', c.cpa,
                 'roas', c.roas, 'purchases', c.purchases, 'purchase_value', c.purchase_value, 'adds_to_cart', c.adds_to_cart,
                 'cost_per_add_to_cart', c.cost_per_add_to_cart, 'video_views', c.video_views, 'thumb_stop_rate', c.thumb_stop_rate, 'hold_rate', c.hold_rate,
                 'frequency', c.frequency, 'video_avg_play_time', c.video_avg_play_time, 'play_curve', c.play_curve, 'retention_p25', c.retention_p25,
                 'retention_p50', c.retention_p50, 'retention_p75', c.retention_p75, 'retention_p100', c.retention_p100, 'campaign_name', c.campaign_name,
                 'adset_name', c.adset_name, 'ad_post_url', c.ad_post_url, 'thumbnail_url', c.thumbnail_url, 'full_res_url', c.full_res_url,
                 'video_url', c.video_url, 'meta_video_ids', c.meta_video_ids)
               || jsonb_build_object(
                    'grade', CASE WHEN p.spend_pct IS NULL THEN NULL WHEN p.spend_pct >= 80 THEN 'A' WHEN p.spend_pct >= 60 THEN 'B' WHEN p.spend_pct >= 40 THEN 'C' WHEN p.spend_pct >= 20 THEN 'D' ELSE 'F' END,
                    'spend_percentile', round(p.spend_pct))
               ORDER BY CASE WHEN v_asc AND NOT v_text THEN p.sort_num END ASC NULLS LAST,
                        CASE WHEN NOT v_asc AND NOT v_text THEN p.sort_num END DESC NULLS LAST,
                        CASE WHEN v_asc AND v_text THEN p.sort_text END ASC NULLS LAST,
                        CASE WHEN NOT v_asc AND v_text THEN p.sort_text END DESC NULLS LAST,
                        p.ad_id)
        FROM pg p
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
  text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer, text, text, jsonb
) IS
  'One-statement page for the creatives edge function (GET /creatives). Trusts p_allowed_ids / p_account_id, so service_role only. Filters (including the advanced p_conditions), sorts by p_sort / p_sort_dir and grades by spend percentile within each account over the whole set before paging (audit 7.1). Same math as _shared/creatives-aggregate.ts.';

REVOKE ALL ON FUNCTION public.creatives_list_page(
  text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creatives_list_page(
  text[], text, date, date, text[], text, text, text, text, text, text, text, text, text, integer, integer, text, text, jsonb
) TO service_role;
