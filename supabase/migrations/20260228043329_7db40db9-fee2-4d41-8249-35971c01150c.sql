ALTER TABLE public.user_preferences 
ADD COLUMN IF NOT EXISTS alerts_config jsonb DEFAULT '{
  "scale_threshold": {"enabled": true, "value": 2.0},
  "kill_threshold": {"enabled": true, "value": 0.8},
  "fatigue_threshold": {"enabled": true, "value": 70},
  "zero_spend_days": {"enabled": true, "value": 3},
  "frequency_spike": {"enabled": true, "value": 5.0},
  "new_creative": {"enabled": false},
  "sync_completed": "errors_only",
  "pacing_range": {"enabled": true, "min": 80, "max": 120},
  "email_enabled": false,
  "slack_webhook": null,
  "account_filter": [],
  "quiet_hours": {"enabled": false, "start": 22, "end": 7}
}'::jsonb;