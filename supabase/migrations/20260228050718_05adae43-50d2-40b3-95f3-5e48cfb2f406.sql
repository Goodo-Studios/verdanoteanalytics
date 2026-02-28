
-- Client onboarding checklist per account
CREATE TABLE public.client_transitions (
  account_id text NOT NULL PRIMARY KEY REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  contract_signed_at date,
  meta_access_granted boolean NOT NULL DEFAULT false,
  account_added boolean NOT NULL DEFAULT false,
  first_sync_completed boolean NOT NULL DEFAULT false,
  historical_data_notes text,
  historical_data_reviewed boolean NOT NULL DEFAULT false,
  kickoff_call_at date,
  brief_templates_setup boolean NOT NULL DEFAULT false,
  client_user_created boolean NOT NULL DEFAULT false,
  first_report_at date,
  thirty_day_checkin_at date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.client_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder can manage client_transitions"
  ON public.client_transitions FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role));

-- Timeline events for client relationship milestones
CREATE TABLE public.client_timeline_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id text NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.client_timeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builder can manage client_timeline_events"
  ON public.client_timeline_events FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role));

CREATE INDEX idx_client_timeline_account ON public.client_timeline_events(account_id, event_date DESC);
