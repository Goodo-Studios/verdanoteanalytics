-- Account objective metrics: adds optimization_goal to ad_accounts so each
-- account can track whether it is optimizing for PURCHASE or SESSION_CONVERSION
-- conversions. Adds result_count and cost_per_result to creatives so per-creative
-- objective-based performance can be stored and surfaced in the analytics UI.

-- Add optimization_goal to ad_accounts
ALTER TABLE public.ad_accounts
  ADD COLUMN optimization_goal TEXT NOT NULL DEFAULT 'PURCHASE'
    CONSTRAINT ad_accounts_optimization_goal_check
    CHECK (optimization_goal IN ('PURCHASE', 'SESSION_CONVERSION'));

CREATE INDEX idx_ad_accounts_optimization_goal ON public.ad_accounts(optimization_goal);

-- Add result_count and cost_per_result to creatives
ALTER TABLE public.creatives
  ADD COLUMN result_count NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN cost_per_result NUMERIC NOT NULL DEFAULT 0;
