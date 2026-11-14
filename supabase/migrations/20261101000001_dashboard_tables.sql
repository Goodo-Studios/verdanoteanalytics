-- Dashboard data foundation 1/6: tables
--
-- Brings the 32 staff tables of the old Goodo Studios dashboard (project
-- qlvdvpchriyrsjtewwxx) into Verdanote. Column types, defaults, constraints and
-- indexes are the end state of the dashboard's 77 migrations.
--
-- Name clash: Verdanote already has a public.creators table (ad creators). The
-- dashboard's creators table (applicants with headshots, videos, ratings) lands as
-- dashboard_creators, together with its constraint and index names. Everything
-- that pointed at it points at the new name.
--
-- Left behind on purpose: public_error_reports, upload_url_rate_limits and
-- actor_upload_url_rate_limits. They only support the public forms, which stay on
-- the old dashboard.
--
-- app_users.auth_user_id keeps its column but loses the foreign key to auth.users.
-- Dashboard logins are a different login pool from Verdanote, so those ids do not
-- exist here. Verdanote staff are matched to app_users rows by email.
--
-- Row rules, grants and policies are in migration 3, which runs before any data
-- is copied in.

create table public.actor_application_videos (
  id uuid default gen_random_uuid() not null,
  application_id uuid not null,
  storage_path text not null,
  thumbnail_path text,
  title text,
  sort_order integer not null,
  size_bytes bigint,
  mime_type text,
  created_at timestamp with time zone default now() not null,
  constraint actor_application_videos_pkey PRIMARY KEY (id),
  constraint actor_application_videos_application_id_sort_order_key UNIQUE (application_id, sort_order)
);

create table public.actor_applications (
  id uuid default gen_random_uuid() not null,
  status text default 'pending'::text not null,
  name text not null,
  email text not null,
  phone text,
  gender text,
  age_range text[] default '{}'::text[] not null,
  notes text,
  dog_owner boolean,
  kids_in_videos text,
  social_url text,
  additional_social_url text,
  headshot_path text,
  submitted_at timestamp with time zone default now() not null,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_notes text,
  submitter_ip_hash text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint actor_applications_pkey PRIMARY KEY (id),
  constraint actor_applications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

create table public.actor_approval_votes (
  id uuid default gen_random_uuid() not null,
  board_id uuid not null,
  assignment_id uuid not null,
  vote text not null,
  voted_at timestamp with time zone default now() not null,
  voted_by text,
  constraint actor_approval_votes_pkey PRIMARY KEY (id),
  constraint actor_approval_votes_board_assignment_key UNIQUE (board_id, assignment_id),
  constraint actor_approval_votes_vote_check CHECK ((vote = ANY (ARRAY['up'::text, 'down'::text]))),
  constraint actor_approval_votes_voted_by_length CHECK (((voted_by IS NULL) OR (char_length(voted_by) <= 40)))
);

create table public.actor_assignments (
  id uuid default gen_random_uuid() not null,
  actor_id uuid not null,
  client_slug text not null,
  stage text default 'sourced'::text not null,
  owner_id uuid,
  next_follow_up_at date,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  scheduled_shoot_date date,
  shoot_location text,
  google_calendar_event_id text,
  shoot_id uuid,
  constraint actor_assignments_pkey PRIMARY KEY (id),
  constraint actor_assignments_actor_id_client_slug_key UNIQUE (actor_id, client_slug),
  constraint actor_assignments_stage_check CHECK ((stage = ANY (ARRAY['sourced'::text, 'outreach_sent'::text, 'interested'::text, 'shortlisted'::text, 'client_approved'::text, 'booked'::text, 'shooting'::text, 'wrapped'::text, 'declined'::text, 'passed'::text])))
);

create table public.actor_photos (
  id uuid default gen_random_uuid() not null,
  actor_id uuid not null,
  storage_path text not null,
  caption text,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint actor_photos_pkey PRIMARY KEY (id)
);

create table public.actor_videos (
  id uuid default gen_random_uuid() not null,
  actor_id uuid not null,
  storage_path text not null,
  thumbnail_path text,
  title text,
  sort_order integer not null,
  duration_seconds numeric,
  size_bytes bigint,
  mime_type text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint actor_videos_pkey PRIMARY KEY (id),
  constraint actor_videos_actor_id_sort_order_key UNIQUE (actor_id, sort_order)
);

create table public.actors (
  id uuid default gen_random_uuid() not null,
  name text not null,
  email text,
  phone text,
  gender text,
  age_range text[] default '{}'::text[] not null,
  notes text,
  dog_owner boolean,
  do_not_use_again boolean default false not null,
  kids_in_videos text,
  social_url text,
  additional_social_url text,
  headshot_path text,
  source text default 'manual'::text not null,
  import_notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  skills text[] default '{}'::text[] not null,
  constraint actors_pkey PRIMARY KEY (id)
);

create table public.app_users (
  id uuid default gen_random_uuid() not null,
  auth_user_id uuid,
  name text not null,
  email text not null,
  role text default 'producer'::text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  constraint app_users_pkey PRIMARY KEY (id),
  constraint app_users_auth_user_id_key UNIQUE (auth_user_id),
  constraint app_users_email_key UNIQUE (email),
  constraint app_users_role_check CHECK ((role = ANY (ARRAY['producer'::text, 'admin'::text, 'viewer'::text])))
);

create table public.application_videos (
  id uuid default gen_random_uuid() not null,
  application_id uuid not null,
  storage_path text not null,
  thumbnail_path text,
  title text,
  sort_order integer not null,
  size_bytes bigint,
  mime_type text,
  created_at timestamp with time zone default now() not null,
  constraint application_videos_pkey PRIMARY KEY (id),
  constraint application_videos_application_id_sort_order_key UNIQUE (application_id, sort_order)
);

create table public.approval_boards (
  id uuid default gen_random_uuid() not null,
  client_slug text not null,
  month text,
  token text not null,
  expires_at timestamp with time zone not null,
  revoked boolean default false not null,
  created_at timestamp with time zone default now() not null,
  board_type text default 'creators'::text not null,
  constraint approval_boards_pkey PRIMARY KEY (id),
  constraint approval_boards_board_type_check CHECK ((board_type = ANY (ARRAY['creators'::text, 'actors'::text]))),
  constraint approval_boards_token_key UNIQUE (token)
);

create table public.approval_votes (
  id uuid default gen_random_uuid() not null,
  board_id uuid not null,
  assignment_id uuid not null,
  vote text not null,
  voted_at timestamp with time zone default now() not null,
  voted_by text,
  constraint approval_votes_pkey PRIMARY KEY (id),
  constraint approval_votes_board_id_assignment_id_key UNIQUE (board_id, assignment_id),
  constraint approval_votes_vote_check CHECK ((vote = ANY (ARRAY['up'::text, 'down'::text]))),
  constraint approval_votes_voted_by_length CHECK (((voted_by IS NULL) OR (char_length(voted_by) <= 40)))
);

create table public.call_sheet_crew (
  call_sheet_id uuid not null,
  crew_member_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint call_sheet_crew_pkey PRIMARY KEY (call_sheet_id, crew_member_id)
);

create table public.call_sheets (
  id uuid default gen_random_uuid() not null,
  token text not null,
  call_time time without time zone,
  wrap_time_estimate text,
  general_notes text,
  revoked boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  shoot_id uuid not null,
  constraint call_sheets_pkey PRIMARY KEY (id),
  constraint call_sheets_token_key UNIQUE (token)
);

create table public.clients (
  slug text not null,
  name text not null,
  status text not null,
  service_type text,
  strategist text,
  pct_complete integer,
  contract_start date,
  contract_end date,
  last_synced timestamp with time zone,
  month text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  active boolean default true not null,
  verdanote_account_id text,
  origin text default 'coda'::text not null,
  does_creators boolean default true not null,
  does_production boolean default false not null,
  scope text,
  constraint clients_pkey PRIMARY KEY (slug),
  constraint clients_at_least_one_service_line CHECK ((does_creators OR does_production)),
  constraint clients_origin_check CHECK ((origin = ANY (ARRAY['coda'::text, 'manual'::text]))),
  constraint clients_verdanote_account_id_shape CHECK (((verdanote_account_id IS NULL) OR (verdanote_account_id ~ '^act_[0-9]+$'::text)))
);

create table public.creator_applications (
  id uuid default gen_random_uuid() not null,
  status text default 'pending'::text not null,
  name text not null,
  email text not null,
  socials jsonb,
  website text,
  categories text[] default '{}'::text[] not null,
  age_range text[] default '{}'::text[] not null,
  gender text,
  location text,
  shipping_address text,
  alcohol_ok boolean default false not null,
  cbd_ok boolean default false not null,
  thc_ok boolean default false not null,
  family_inclusive_ok boolean default false not null,
  headshot_path text,
  submitted_at timestamp with time zone default now() not null,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_notes text,
  submitter_ip_hash text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint creator_applications_pkey PRIMARY KEY (id),
  constraint creator_applications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

create table public.creator_assignments (
  id uuid default gen_random_uuid() not null,
  creator_id uuid not null,
  client_slug text not null,
  month text,
  stage text default 'sourced'::text not null,
  owner_id uuid,
  next_follow_up_at date,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  tracking_number text,
  product_delivered_at date,
  delivery_notes text,
  stage_changed_at timestamp with time zone,
  next_follow_up_source text,
  brief_name text,
  air_folder_link text,
  constraint creator_assignments_pkey PRIMARY KEY (id),
  constraint creator_assignments_creator_id_client_slug_key UNIQUE (creator_id, client_slug),
  constraint creator_assignments_next_follow_up_source_check CHECK (((next_follow_up_source IS NULL) OR (next_follow_up_source = ANY (ARRAY['manual'::text, 'delivery'::text, 'stage_rule'::text])))),
  constraint creator_assignments_stage_check CHECK ((stage = ANY (ARRAY['sourced'::text, 'outreach_sent'::text, 'interested'::text, 'shortlisted'::text, 'client_approved'::text, 'details_collected'::text, 'contract_sent'::text, 'contract_signed'::text, 'product_shipped'::text, 'brief_sent'::text, 'product_delivered'::text, 'shooting'::text, 'footage_delivered'::text, 'invoice_received'::text, 'payment_logged'::text, 'completed'::text, 'declined'::text, 'passed'::text])))
);

create table public.creator_filming_locations (
  id uuid default gen_random_uuid() not null,
  creator_id uuid not null,
  storage_path text not null,
  label text,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint creator_filming_locations_pkey PRIMARY KEY (id)
);

create table public.creator_photos (
  id uuid default gen_random_uuid() not null,
  creator_id uuid not null,
  storage_path text not null,
  category text not null,
  caption text,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint creator_photos_pkey PRIMARY KEY (id),
  constraint creator_photos_category_check CHECK ((category = ANY (ARRAY['family'::text, 'pet'::text])))
);

create table public.creator_videos (
  id uuid default gen_random_uuid() not null,
  creator_id uuid not null,
  storage_path text not null,
  thumbnail_path text,
  title text,
  sort_order integer not null,
  duration_seconds numeric,
  size_bytes bigint,
  mime_type text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  format text,
  constraint creator_videos_pkey PRIMARY KEY (id),
  constraint creator_videos_creator_id_sort_order_key UNIQUE (creator_id, sort_order),
  constraint creator_videos_format_check CHECK (((format IS NULL) OR (format = ANY (ARRAY['talking_head'::text, 'green_screen'::text, 'skit'::text, 'podcast'::text, 'other'::text]))))
);

create table public.dashboard_creators (
  id uuid default gen_random_uuid() not null,
  name text not null,
  email text,
  website text,
  portfolio_url text,
  gender text,
  scale integer,
  categories text[] default '{}'::text[] not null,
  age_range text[] default '{}'::text[] not null,
  location text,
  shipping_address text,
  contact_notes text,
  trialed boolean default false not null,
  do_not_use_again boolean default false not null,
  alcohol_ok boolean default false not null,
  cbd_ok boolean default false not null,
  thc_ok boolean default false not null,
  family_inclusive_ok boolean default false not null,
  source text default 'manual'::text not null,
  import_notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  headshot_path text,
  categories_needs_review boolean default false not null,
  constraint dashboard_creators_pkey PRIMARY KEY (id),
  constraint dashboard_creators_scale_check CHECK (((scale >= 1) AND (scale <= 5)))
);

create table public.crew_members (
  id uuid default gen_random_uuid() not null,
  name text not null,
  role text not null,
  rate_notes text,
  phone text,
  email text,
  notes text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint crew_members_pkey PRIMARY KEY (id)
);

create table public.deliverables (
  id uuid default gen_random_uuid() not null,
  client_slug text not null,
  month text not null,
  type text not null,
  status text not null,
  file_path text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint deliverables_pkey PRIMARY KEY (id),
  constraint deliverables_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'complete'::text]))),
  constraint deliverables_type_check CHECK ((type = ANY (ARRAY['cycle_brief'::text, 'production'::text, 'delivery'::text, 'report'::text, 'performance'::text])))
);

create table public.location_board_items (
  id uuid default gen_random_uuid() not null,
  board_id uuid not null,
  location_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint location_board_items_pkey PRIMARY KEY (id),
  constraint location_board_items_board_id_location_id_key UNIQUE (board_id, location_id)
);

create table public.location_boards (
  id uuid default gen_random_uuid() not null,
  client_slug text,
  label text,
  token text not null,
  revoked boolean default false not null,
  created_at timestamp with time zone default now() not null,
  constraint location_boards_pkey PRIMARY KEY (id),
  constraint location_boards_token_key UNIQUE (token)
);

create table public.location_photos (
  id uuid default gen_random_uuid() not null,
  location_id uuid not null,
  storage_path text not null,
  caption text,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint location_photos_pkey PRIMARY KEY (id)
);

create table public.locations (
  id uuid default gen_random_uuid() not null,
  name text not null,
  neighborhood text,
  rental_type text,
  notes text,
  cost numeric(10,2),
  cost_period text,
  listing_url text,
  rooms text[] default '{}'::text[] not null,
  attributes text[] default '{}'::text[] not null,
  have_rented boolean default false not null,
  dont_rent_again boolean default false not null,
  contact_name text,
  contact_email text,
  parking_instructions text,
  wifi_name text,
  wifi_password text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  bedrooms integer,
  bathrooms numeric(3,1),
  max_guests integer,
  entry_instructions text,
  constraint locations_pkey PRIMARY KEY (id),
  constraint locations_bathrooms_nonneg CHECK (((bathrooms IS NULL) OR (bathrooms >= (0)::numeric))),
  constraint locations_bedrooms_nonneg CHECK (((bedrooms IS NULL) OR (bedrooms >= 0))),
  constraint locations_cost_period_check CHECK ((cost_period = ANY (ARRAY['hourly'::text, 'daily'::text]))),
  constraint locations_max_guests_nonneg CHECK (((max_guests IS NULL) OR (max_guests >= 0)))
);

create table public.props (
  id uuid default gen_random_uuid() not null,
  name text not null,
  store text,
  price numeric(10,2),
  return_status text,
  client text,
  at_studio boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  client_supplied boolean default false not null,
  bin_number text,
  notes text,
  constraint props_pkey PRIMARY KEY (id),
  constraint props_return_status_check CHECK ((return_status = ANY (ARRAY['Returned'::text, 'Thrown away'::text, 'Kept'::text])))
);

create table public.shoot_schedule_block_crew (
  block_id uuid not null,
  crew_member_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint shoot_schedule_block_crew_pkey PRIMARY KEY (block_id, crew_member_id)
);

create table public.shoot_schedule_block_talent (
  block_id uuid not null,
  actor_assignment_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint shoot_schedule_block_talent_pkey PRIMARY KEY (block_id, actor_assignment_id)
);

create table public.shoot_schedule_blocks (
  id uuid default gen_random_uuid() not null,
  shoot_id uuid not null,
  label text not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  location text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint shoot_schedule_blocks_pkey PRIMARY KEY (id),
  constraint shoot_schedule_blocks_time_order_check CHECK ((end_time > start_time))
);

create table public.shoots (
  id uuid default gen_random_uuid() not null,
  client_slug text not null,
  shoot_date date not null,
  location text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  google_calendar_event_id text,
  location_id uuid,
  constraint shoots_pkey PRIMARY KEY (id)
);

create table public.studio_shipments (
  id uuid default gen_random_uuid() not null,
  client_slug text not null,
  actor_assignment_id uuid,
  description text not null,
  carrier text,
  tracking_number text,
  shipped_at date,
  expected_delivery_at date,
  delivered_at date,
  delivery_notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint studio_shipments_pkey PRIMARY KEY (id)
);

CREATE INDEX actor_application_videos_application_id_idx ON public.actor_application_videos USING btree (application_id);
CREATE INDEX actor_applications_email_status_idx ON public.actor_applications USING btree (lower(email), status);
CREATE INDEX actor_applications_ip_hash_created_at_idx ON public.actor_applications USING btree (submitter_ip_hash, created_at DESC);
CREATE UNIQUE INDEX actor_applications_one_pending_per_email_idx ON public.actor_applications USING btree (lower(email)) WHERE (status = 'pending'::text);
CREATE INDEX actor_applications_status_idx ON public.actor_applications USING btree (status);
CREATE INDEX actor_approval_votes_board_id_idx ON public.actor_approval_votes USING btree (board_id);
CREATE INDEX actor_assignments_actor_id_idx ON public.actor_assignments USING btree (actor_id);
CREATE INDEX actor_assignments_client_slug_idx ON public.actor_assignments USING btree (client_slug);
CREATE INDEX actor_assignments_next_follow_up_at_idx ON public.actor_assignments USING btree (next_follow_up_at);
CREATE INDEX actor_assignments_owner_id_idx ON public.actor_assignments USING btree (owner_id);
CREATE INDEX actor_assignments_scheduled_shoot_date_idx ON public.actor_assignments USING btree (scheduled_shoot_date);
CREATE INDEX actor_assignments_shoot_id_idx ON public.actor_assignments USING btree (shoot_id);
CREATE INDEX actor_assignments_stage_idx ON public.actor_assignments USING btree (stage);
CREATE INDEX actor_photos_actor_id_idx ON public.actor_photos USING btree (actor_id);
CREATE INDEX actor_videos_actor_id_idx ON public.actor_videos USING btree (actor_id);
CREATE INDEX actors_do_not_use_again_idx ON public.actors USING btree (do_not_use_again);
CREATE INDEX actors_name_idx ON public.actors USING btree (name);
CREATE INDEX application_videos_application_id_idx ON public.application_videos USING btree (application_id);
CREATE INDEX approval_boards_client_slug_board_type_idx ON public.approval_boards USING btree (client_slug, board_type);
CREATE INDEX approval_boards_client_slug_idx ON public.approval_boards USING btree (client_slug);
CREATE INDEX approval_votes_board_id_idx ON public.approval_votes USING btree (board_id);
CREATE INDEX call_sheet_crew_crew_member_id_idx ON public.call_sheet_crew USING btree (crew_member_id);
CREATE UNIQUE INDEX call_sheets_shoot_id_key ON public.call_sheets USING btree (shoot_id);
CREATE INDEX clients_active_idx ON public.clients USING btree (active);
CREATE INDEX clients_pct_complete_idx ON public.clients USING btree (pct_complete);
CREATE INDEX clients_status_idx ON public.clients USING btree (status);
CREATE INDEX creator_applications_email_status_idx ON public.creator_applications USING btree (lower(email), status);
CREATE INDEX creator_applications_ip_hash_created_at_idx ON public.creator_applications USING btree (submitter_ip_hash, created_at DESC);
CREATE UNIQUE INDEX creator_applications_one_pending_per_email_idx ON public.creator_applications USING btree (lower(email)) WHERE (status = 'pending'::text);
CREATE INDEX creator_applications_status_idx ON public.creator_applications USING btree (status);
CREATE INDEX creator_assignments_client_slug_idx ON public.creator_assignments USING btree (client_slug);
CREATE INDEX creator_assignments_next_follow_up_at_idx ON public.creator_assignments USING btree (next_follow_up_at);
CREATE INDEX creator_assignments_owner_id_idx ON public.creator_assignments USING btree (owner_id);
CREATE INDEX creator_assignments_stage_idx ON public.creator_assignments USING btree (stage);
CREATE INDEX creator_filming_locations_creator_id_idx ON public.creator_filming_locations USING btree (creator_id);
CREATE INDEX creator_photos_creator_id_idx ON public.creator_photos USING btree (creator_id);
CREATE INDEX creator_videos_creator_id_idx ON public.creator_videos USING btree (creator_id);
CREATE INDEX dashboard_creators_categories_needs_review_idx ON public.dashboard_creators USING btree (categories_needs_review) WHERE categories_needs_review;
CREATE INDEX dashboard_creators_do_not_use_again_idx ON public.dashboard_creators USING btree (do_not_use_again);
CREATE INDEX dashboard_creators_scale_idx ON public.dashboard_creators USING btree (scale);
CREATE INDEX crew_members_active_idx ON public.crew_members USING btree (active);
CREATE INDEX crew_members_role_idx ON public.crew_members USING btree (role);
CREATE INDEX deliverables_client_slug_idx ON public.deliverables USING btree (client_slug);
CREATE INDEX deliverables_month_idx ON public.deliverables USING btree (month);
CREATE UNIQUE INDEX deliverables_unique_per_client_month_type ON public.deliverables USING btree (client_slug, month, type);
CREATE INDEX location_board_items_board_id_idx ON public.location_board_items USING btree (board_id);
CREATE INDEX location_board_items_location_id_idx ON public.location_board_items USING btree (location_id);
CREATE INDEX location_boards_client_slug_idx ON public.location_boards USING btree (client_slug);
CREATE INDEX location_photos_location_id_idx ON public.location_photos USING btree (location_id);
CREATE INDEX locations_bedrooms_idx ON public.locations USING btree (bedrooms);
CREATE INDEX locations_neighborhood_idx ON public.locations USING btree (neighborhood);
CREATE INDEX props_at_studio_idx ON public.props USING btree (at_studio);
CREATE INDEX props_client_idx ON public.props USING btree (client);
CREATE INDEX props_client_supplied_idx ON public.props USING btree (client_supplied);
CREATE INDEX shoot_schedule_block_crew_crew_member_idx ON public.shoot_schedule_block_crew USING btree (crew_member_id);
CREATE INDEX shoot_schedule_block_talent_assignment_idx ON public.shoot_schedule_block_talent USING btree (actor_assignment_id);
CREATE INDEX shoot_schedule_blocks_shoot_id_start_time_idx ON public.shoot_schedule_blocks USING btree (shoot_id, start_time);
CREATE INDEX shoots_client_slug_idx ON public.shoots USING btree (client_slug);
CREATE INDEX shoots_location_id_idx ON public.shoots USING btree (location_id);
CREATE INDEX shoots_shoot_date_idx ON public.shoots USING btree (shoot_date);
CREATE INDEX studio_shipments_actor_assignment_id_idx ON public.studio_shipments USING btree (actor_assignment_id);
CREATE INDEX studio_shipments_client_slug_idx ON public.studio_shipments USING btree (client_slug);
CREATE INDEX studio_shipments_delivered_at_idx ON public.studio_shipments USING btree (delivered_at);
CREATE INDEX studio_shipments_expected_delivery_at_idx ON public.studio_shipments USING btree (expected_delivery_at);

alter table public.actor_application_videos add constraint actor_application_videos_application_id_fkey FOREIGN KEY (application_id) REFERENCES actor_applications(id) ON DELETE CASCADE;
alter table public.actor_applications add constraint actor_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES app_users(id);
alter table public.actor_approval_votes add constraint actor_approval_votes_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES actor_assignments(id) ON DELETE CASCADE;
alter table public.actor_approval_votes add constraint actor_approval_votes_board_id_fkey FOREIGN KEY (board_id) REFERENCES approval_boards(id) ON DELETE CASCADE;
alter table public.actor_assignments add constraint actor_assignments_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE;
alter table public.actor_assignments add constraint actor_assignments_client_slug_fkey FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE CASCADE;
alter table public.actor_assignments add constraint actor_assignments_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public.actor_assignments add constraint actor_assignments_shoot_id_fkey FOREIGN KEY (shoot_id) REFERENCES shoots(id);
alter table public.actor_photos add constraint actor_photos_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE;
alter table public.actor_videos add constraint actor_videos_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE;
alter table public.application_videos add constraint application_videos_application_id_fkey FOREIGN KEY (application_id) REFERENCES creator_applications(id) ON DELETE CASCADE;
alter table public.approval_boards add constraint approval_boards_client_slug_fkey FOREIGN KEY (client_slug) REFERENCES clients(slug);
alter table public.approval_votes add constraint approval_votes_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES creator_assignments(id) ON DELETE CASCADE;
alter table public.approval_votes add constraint approval_votes_board_id_fkey FOREIGN KEY (board_id) REFERENCES approval_boards(id) ON DELETE CASCADE;
alter table public.call_sheet_crew add constraint call_sheet_crew_call_sheet_id_fkey FOREIGN KEY (call_sheet_id) REFERENCES call_sheets(id) ON DELETE CASCADE;
alter table public.call_sheet_crew add constraint call_sheet_crew_crew_member_id_fkey FOREIGN KEY (crew_member_id) REFERENCES crew_members(id) ON DELETE CASCADE;
alter table public.call_sheets add constraint call_sheets_shoot_id_fkey FOREIGN KEY (shoot_id) REFERENCES shoots(id) ON DELETE CASCADE;
alter table public.creator_applications add constraint creator_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES app_users(id);
alter table public.creator_assignments add constraint creator_assignments_client_slug_fkey FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE CASCADE;
alter table public.creator_assignments add constraint creator_assignments_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES dashboard_creators(id) ON DELETE CASCADE;
alter table public.creator_assignments add constraint creator_assignments_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public.creator_filming_locations add constraint creator_filming_locations_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES dashboard_creators(id) ON DELETE CASCADE;
alter table public.creator_photos add constraint creator_photos_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES dashboard_creators(id) ON DELETE CASCADE;
alter table public.creator_videos add constraint creator_videos_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES dashboard_creators(id) ON DELETE CASCADE;
alter table public.deliverables add constraint deliverables_client_slug_fkey FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE CASCADE;
alter table public.location_board_items add constraint location_board_items_board_id_fkey FOREIGN KEY (board_id) REFERENCES location_boards(id) ON DELETE CASCADE;
alter table public.location_board_items add constraint location_board_items_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.location_boards add constraint location_boards_client_slug_fkey FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE SET NULL;
alter table public.location_photos add constraint location_photos_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.shoot_schedule_block_crew add constraint shoot_schedule_block_crew_block_id_fkey FOREIGN KEY (block_id) REFERENCES shoot_schedule_blocks(id) ON DELETE CASCADE;
alter table public.shoot_schedule_block_crew add constraint shoot_schedule_block_crew_crew_member_id_fkey FOREIGN KEY (crew_member_id) REFERENCES crew_members(id) ON DELETE CASCADE;
alter table public.shoot_schedule_block_talent add constraint shoot_schedule_block_talent_actor_assignment_id_fkey FOREIGN KEY (actor_assignment_id) REFERENCES actor_assignments(id) ON DELETE CASCADE;
alter table public.shoot_schedule_block_talent add constraint shoot_schedule_block_talent_block_id_fkey FOREIGN KEY (block_id) REFERENCES shoot_schedule_blocks(id) ON DELETE CASCADE;
alter table public.shoot_schedule_blocks add constraint shoot_schedule_blocks_shoot_id_fkey FOREIGN KEY (shoot_id) REFERENCES shoots(id) ON DELETE CASCADE;
alter table public.shoots add constraint shoots_client_slug_fkey FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE CASCADE;
alter table public.shoots add constraint shoots_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.studio_shipments add constraint studio_shipments_actor_assignment_id_fkey FOREIGN KEY (actor_assignment_id) REFERENCES actor_assignments(id) ON DELETE SET NULL;
alter table public.studio_shipments add constraint studio_shipments_client_slug_fkey FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE CASCADE;
