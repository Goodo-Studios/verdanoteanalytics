-- One set of video metric formulas (audit plan item 6.1, part 6).
--
-- There were three different hook / hold / play time / frequency rules: the sync rollup
-- (rollup_creatives_from_daily) divided views by ALL impressions, image days included, so
-- hook rates read low; the creatives list (creatives_list_page) and
-- _shared/creatives-aggregate.ts dropped days with a 0% hold, 0s play time or 0 frequency,
-- so those read high. All three now use the formulas in _shared/metric-math.ts:
--   hook rate  = video views / impressions, both from days with video views, x 100
--   hold rate  = sum(hold_rate / 100 x video views) / video views, x 100
--   play time  = sum(play time x video views) / video views
--   frequency  = sum(frequency x impressions) / impressions, over every day
-- Test: supabase/tests/video_metric_formulas_test.sql (same fixture as
-- _shared/creatives-aggregate.test.ts).
--
-- Both functions are replaced whole; grants and comments carry over with CREATE OR REPLACE.
-- The rollup keeps its 180s statement_timeout from 20260721000002.

CREATE OR REPLACE FUNCTION public.rollup_creatives_from_daily(
  p_account_id text,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
-- Kept from 20260721000002 (CREATE OR REPLACE resets per-function settings).
SET statement_timeout = '180s'
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'rollup_creatives_from_daily: p_account_id is required';
  END IF;

  WITH agg AS (
    SELECT
      m.ad_id                                                             AS ad_id,
      -- ── Summable base metrics ────────────────────────────────────────
      COALESCE(SUM(m.spend), 0)::numeric                                  AS spend,
      COALESCE(SUM(m.impressions), 0)::bigint                             AS impressions,
      COALESCE(SUM(m.clicks), 0)::bigint                                  AS clicks,
      COALESCE(SUM(m.purchases), 0)::bigint                               AS purchases,
      COALESCE(SUM(m.purchase_value), 0)::numeric                         AS purchase_value,
      COALESCE(SUM(m.adds_to_cart), 0)::bigint                            AS adds_to_cart,
      COALESCE(SUM(m.video_views), 0)::bigint                             AS video_views,
      -- Impressions from days that had video views (hook rate denominator, audit 6.1).
      COALESCE(SUM(m.impressions) FILTER (WHERE m.video_views > 0), 0)::bigint AS video_impressions,
      -- Reconstruct daily thruplays (hold_rate = thruplays / video_views)
      -- so aggregate hold_rate can be derived from summed base metrics.
      -- The daily table stores hold_rate but not the raw thruplay count.
      COALESCE(SUM(
        CASE WHEN m.hold_rate IS NOT NULL AND m.video_views IS NOT NULL
          THEN (m.hold_rate / 100.0) * m.video_views
          ELSE 0 END
      ), 0)::numeric                                                      AS thruplays,
      -- video_avg_play_time: view-weighted mean (approximate — Meta reports an
      -- avg per day, so we weight by that day's video_views).
      COALESCE(SUM(m.video_avg_play_time * m.video_views), 0)::numeric    AS vapt_weighted,
      -- APPROXIMATE frequency (see header): impression-weighted mean daily
      -- frequency. No reach column exists to compute exact aggregate frequency.
      COALESCE(SUM(m.frequency * m.impressions), 0)::numeric              AS freq_weighted
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id
      AND (p_from IS NULL OR m.date >= p_from)
      AND (p_to   IS NULL OR m.date <= p_to)
    GROUP BY m.ad_id
  ),
  -- ── Play-curve / retention rollup (US-001 daily columns) ─────────────
  -- video-view weighted average of the per-interval retention curves and the
  -- quartile scalars, so a high-volume day dominates. Days with a null curve /
  -- zero views are excluded rather than zero-filled (a zero curve would read as
  -- "everyone dropped off" and distort the aggregate).
  curve_agg AS (
    SELECT
      m.ad_id AS ad_id,
      -- Weighted retention scalars.
      SUM(m.retention_p25 * m.video_views) FILTER (
        WHERE m.retention_p25 IS NOT NULL AND m.video_views > 0)          AS p25_num,
      SUM(m.retention_p50 * m.video_views) FILTER (
        WHERE m.retention_p50 IS NOT NULL AND m.video_views > 0)          AS p50_num,
      SUM(m.retention_p75 * m.video_views) FILTER (
        WHERE m.retention_p75 IS NOT NULL AND m.video_views > 0)          AS p75_num,
      SUM(m.retention_p100 * m.video_views) FILTER (
        WHERE m.retention_p100 IS NOT NULL AND m.video_views > 0)         AS p100_num,
      SUM(m.video_views) FILTER (
        WHERE m.retention_p50 IS NOT NULL AND m.video_views > 0)          AS ret_weight
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id
      AND (p_from IS NULL OR m.date >= p_from)
      AND (p_to   IS NULL OR m.date <= p_to)
    GROUP BY m.ad_id
  ),
  -- Reconstruct the full normalized play_curve JSONB as a per-interval
  -- video-view weighted average across days that carry a curve. Each day's
  -- curve is a JSON array of true percentages [0,100]; we unnest with ordinality
  -- so interval i lines up across days, weight by that day's video_views, and
  -- re-aggregate back into an ordered array.
  curve_points AS (
    SELECT
      m.ad_id                                    AS ad_id,
      elem.ord                                   AS ord,
      SUM((elem.val)::numeric * m.video_views)   AS num,
      SUM(m.video_views)                         AS den
    FROM public.creative_daily_metrics m
    CROSS JOIN LATERAL jsonb_array_elements_text(m.video_play_curve_actions)
      WITH ORDINALITY AS elem(val, ord)
    WHERE m.account_id = p_account_id
      AND (p_from IS NULL OR m.date >= p_from)
      AND (p_to   IS NULL OR m.date <= p_to)
      AND m.video_play_curve_actions IS NOT NULL
      AND jsonb_typeof(m.video_play_curve_actions) = 'array'
      AND m.video_views > 0
    GROUP BY m.ad_id, elem.ord
  ),
  curve_json AS (
    SELECT
      cp.ad_id AS ad_id,
      jsonb_agg(
        CASE WHEN cp.den > 0 THEN round(cp.num / cp.den, 4) ELSE 0 END
        ORDER BY cp.ord
      ) AS play_curve
    FROM curve_points cp
    GROUP BY cp.ad_id
  )
  UPDATE public.creatives c SET
    spend          = a.spend,
    impressions    = a.impressions,
    clicks         = a.clicks,
    purchases      = a.purchases,
    purchase_value = a.purchase_value,
    adds_to_cart   = a.adds_to_cart,
    video_views    = a.video_views,
    -- ── Derived ratios (never averaged) ────────────────────────────────
    roas = CASE WHEN a.spend > 0 THEN a.purchase_value / a.spend ELSE 0 END,
    cpa  = CASE WHEN a.purchases > 0 THEN a.spend / a.purchases ELSE 0 END,
    ctr  = CASE WHEN a.impressions > 0 THEN (a.clicks::numeric / a.impressions) * 100 ELSE 0 END,
    cpm  = CASE WHEN a.impressions > 0 THEN (a.spend / a.impressions) * 1000 ELSE 0 END,
    cpc  = CASE WHEN a.clicks > 0 THEN a.spend / a.clicks ELSE 0 END,
    cost_per_add_to_cart = CASE WHEN a.adds_to_cart > 0 THEN a.spend / a.adds_to_cart ELSE 0 END,
    thumb_stop_rate = CASE WHEN a.video_impressions > 0 AND a.video_views > 0
      THEN (a.video_views::numeric / a.video_impressions) * 100 ELSE 0 END,
    hold_rate = CASE WHEN a.video_views > 0 AND a.thruplays > 0
      THEN (a.thruplays / a.video_views) * 100 ELSE 0 END,
    video_avg_play_time = CASE WHEN a.video_views > 0
      THEN a.vapt_weighted / a.video_views ELSE 0 END,
    -- APPROXIMATE frequency — impression-weighted mean daily frequency. Summed
    -- daily reach would overcount, so there is no exact aggregate reach/frequency
    -- available locally. Accepted product tradeoff (prd nonGoals).
    frequency = CASE WHEN a.impressions > 0
      THEN a.freq_weighted / a.impressions ELSE 0 END,
    -- Generic outcome columns mirror purchases/cpa for PURCHASE accounts. The
    -- daily grain does not carry objective-specific result columns, so the
    -- rollup keeps result_count/cost_per_result aligned with purchases/cpa
    -- (the parseInsightsRow default). SESSION_CONVERSION accounts fall back to
    -- purchase-derived results in the local rollup.
    result_count    = a.purchases,
    cost_per_result = CASE WHEN a.purchases > 0 THEN a.spend / a.purchases ELSE 0 END,
    -- ── Retention rollup (view-weighted) ───────────────────────────────
    retention_p25  = CASE WHEN cv.ret_weight > 0 THEN cv.p25_num  / cv.ret_weight ELSE c.retention_p25  END,
    retention_p50  = CASE WHEN cv.ret_weight > 0 THEN cv.p50_num  / cv.ret_weight ELSE c.retention_p50  END,
    retention_p75  = CASE WHEN cv.ret_weight > 0 THEN cv.p75_num  / cv.ret_weight ELSE c.retention_p75  END,
    retention_p100 = CASE WHEN cv.ret_weight > 0 THEN cv.p100_num / cv.ret_weight ELSE c.retention_p100 END,
    play_curve     = COALESCE(cj.play_curve, c.play_curve)
  FROM agg a
  LEFT JOIN curve_agg  cv ON cv.ad_id = a.ad_id
  LEFT JOIN curve_json cj ON cj.ad_id = a.ad_id
  WHERE c.ad_id = a.ad_id
    AND c.account_id = p_account_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

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
  p_offset      integer DEFAULT 0
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
BEGIN
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
    page AS (
      SELECT k.*
        FROM calc k
       ORDER BY k.spend DESC, k.ad_id
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
                 ORDER BY p.spend DESC, p.ad_id)
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
           COALESCE(c.purchase_value, 0) AS purchase_value, c.spend AS raw_spend
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
    SELECT f.ad_id, f.raw_spend
      FROM f
     ORDER BY f.raw_spend DESC, f.ad_id
     LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'data', COALESCE((
      SELECT jsonb_agg(
               (SELECT jsonb_object_agg(e.key, e.value)
                  FROM jsonb_each(to_jsonb(c)) e
                 WHERE e.key = ANY (v_cols))
               ORDER BY p.raw_spend DESC, p.ad_id)
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
