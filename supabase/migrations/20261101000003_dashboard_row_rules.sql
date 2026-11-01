-- Dashboard data foundation 3/6: row rules and staff-only policies
--
-- Every new table has row rules on and no access for clients or anon. Policies
-- mirror the dashboard's: reads for staff, direct writes only where the dashboard
-- allowed them (everything else is written through the staff functions in
-- migration 2). The old checks map as follows:
--
--   is_active_user(), is_active_non_viewer()  ->  builder or employee
--   is_active_admin()                         ->  builder
--   "using (true)" on clients, deliverables and app_users  ->  builder or employee
--
-- Grants are reset explicitly because Supabase grants new tables to anon and
-- authenticated by default.

alter table public.actor_application_videos enable row level security;
revoke all on table public.actor_application_videos from public, anon, authenticated;
grant select on table public.actor_application_videos to authenticated;

alter table public.actor_applications enable row level security;
revoke all on table public.actor_applications from public, anon, authenticated;
grant select on table public.actor_applications to authenticated;

alter table public.actor_approval_votes enable row level security;
revoke all on table public.actor_approval_votes from public, anon, authenticated;
grant select, insert, update, delete on table public.actor_approval_votes to authenticated;

alter table public.actor_assignments enable row level security;
revoke all on table public.actor_assignments from public, anon, authenticated;
grant select, insert, update, delete on table public.actor_assignments to authenticated;

alter table public.actor_photos enable row level security;
revoke all on table public.actor_photos from public, anon, authenticated;
grant select, insert, update, delete on table public.actor_photos to authenticated;

alter table public.actor_videos enable row level security;
revoke all on table public.actor_videos from public, anon, authenticated;
grant select, insert, update, delete on table public.actor_videos to authenticated;

alter table public.actors enable row level security;
revoke all on table public.actors from public, anon, authenticated;
grant select, insert, update, delete on table public.actors to authenticated;

alter table public.app_users enable row level security;
revoke all on table public.app_users from public, anon, authenticated;
grant select, insert, update, delete on table public.app_users to authenticated;

alter table public.application_videos enable row level security;
revoke all on table public.application_videos from public, anon, authenticated;
grant select on table public.application_videos to authenticated;

alter table public.approval_boards enable row level security;
revoke all on table public.approval_boards from public, anon, authenticated;
grant select, insert, update, delete on table public.approval_boards to authenticated;

alter table public.approval_votes enable row level security;
revoke all on table public.approval_votes from public, anon, authenticated;
grant select, insert, update, delete on table public.approval_votes to authenticated;

alter table public.call_sheet_crew enable row level security;
revoke all on table public.call_sheet_crew from public, anon, authenticated;
grant select on table public.call_sheet_crew to authenticated;

alter table public.call_sheets enable row level security;
revoke all on table public.call_sheets from public, anon, authenticated;
grant select on table public.call_sheets to authenticated;

alter table public.clients enable row level security;
revoke all on table public.clients from public, anon, authenticated;
grant select on table public.clients to authenticated;

alter table public.creator_applications enable row level security;
revoke all on table public.creator_applications from public, anon, authenticated;
grant select on table public.creator_applications to authenticated;

alter table public.creator_assignments enable row level security;
revoke all on table public.creator_assignments from public, anon, authenticated;
grant select, insert, update, delete on table public.creator_assignments to authenticated;

alter table public.creator_filming_locations enable row level security;
revoke all on table public.creator_filming_locations from public, anon, authenticated;
grant select, insert, update, delete on table public.creator_filming_locations to authenticated;

alter table public.creator_photos enable row level security;
revoke all on table public.creator_photos from public, anon, authenticated;
grant select, insert, update, delete on table public.creator_photos to authenticated;

alter table public.creator_videos enable row level security;
revoke all on table public.creator_videos from public, anon, authenticated;
grant select, insert, update, delete on table public.creator_videos to authenticated;

alter table public.dashboard_creators enable row level security;
revoke all on table public.dashboard_creators from public, anon, authenticated;
grant select, insert, update, delete on table public.dashboard_creators to authenticated;

alter table public.crew_members enable row level security;
revoke all on table public.crew_members from public, anon, authenticated;
grant select on table public.crew_members to authenticated;

alter table public.deliverables enable row level security;
revoke all on table public.deliverables from public, anon, authenticated;
grant select on table public.deliverables to authenticated;

alter table public.location_board_items enable row level security;
revoke all on table public.location_board_items from public, anon, authenticated;
grant select, insert, update, delete on table public.location_board_items to authenticated;

alter table public.location_boards enable row level security;
revoke all on table public.location_boards from public, anon, authenticated;
grant select, insert, update, delete on table public.location_boards to authenticated;

alter table public.location_photos enable row level security;
revoke all on table public.location_photos from public, anon, authenticated;
grant select, insert, update, delete on table public.location_photos to authenticated;

alter table public.locations enable row level security;
revoke all on table public.locations from public, anon, authenticated;
grant select on table public.locations to authenticated;

alter table public.props enable row level security;
revoke all on table public.props from public, anon, authenticated;
grant select on table public.props to authenticated;

alter table public.shoot_schedule_block_crew enable row level security;
revoke all on table public.shoot_schedule_block_crew from public, anon, authenticated;
grant select on table public.shoot_schedule_block_crew to authenticated;

alter table public.shoot_schedule_block_talent enable row level security;
revoke all on table public.shoot_schedule_block_talent from public, anon, authenticated;
grant select on table public.shoot_schedule_block_talent to authenticated;

alter table public.shoot_schedule_blocks enable row level security;
revoke all on table public.shoot_schedule_blocks from public, anon, authenticated;
grant select on table public.shoot_schedule_blocks to authenticated;

alter table public.shoots enable row level security;
revoke all on table public.shoots from public, anon, authenticated;
grant select on table public.shoots to authenticated;

alter table public.studio_shipments enable row level security;
revoke all on table public.studio_shipments from public, anon, authenticated;
grant select on table public.studio_shipments to authenticated;

create policy "Staff read actor_application_videos" on public.actor_application_videos
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read actor_applications" on public.actor_applications
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read actor_approval_votes" on public.actor_approval_votes
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage actor_approval_votes" on public.actor_approval_votes
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read actor_assignments" on public.actor_assignments
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage actor_assignments" on public.actor_assignments
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read actor_photos" on public.actor_photos
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage actor_photos" on public.actor_photos
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read actor_videos" on public.actor_videos
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage actor_videos" on public.actor_videos
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read actors" on public.actors
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage actors" on public.actors
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder delete app_users" on public.app_users
  for delete to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Builder insert app_users" on public.app_users
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Builder update app_users" on public.app_users
  for update to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Staff read app_users" on public.app_users
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read application_videos" on public.application_videos
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read approval_boards" on public.approval_boards
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage approval_boards" on public.approval_boards
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read approval_votes" on public.approval_votes
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage approval_votes" on public.approval_votes
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read call_sheet_crew" on public.call_sheet_crew
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read call_sheets" on public.call_sheets
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read clients" on public.clients
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read creator_applications" on public.creator_applications
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read creator_assignments" on public.creator_assignments
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage creator_assignments" on public.creator_assignments
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read creator_filming_locations" on public.creator_filming_locations
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage creator_filming_locations" on public.creator_filming_locations
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read creator_photos" on public.creator_photos
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage creator_photos" on public.creator_photos
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read creator_videos" on public.creator_videos
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage creator_videos" on public.creator_videos
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read dashboard_creators" on public.dashboard_creators
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage dashboard_creators" on public.dashboard_creators
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read crew_members" on public.crew_members
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read deliverables" on public.deliverables
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read location_board_items" on public.location_board_items
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage location_board_items" on public.location_board_items
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read location_boards" on public.location_boards
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage location_boards" on public.location_boards
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read location_photos" on public.location_photos
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff manage location_photos" on public.location_photos
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read locations" on public.locations
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read props" on public.props
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read shoot_schedule_block_crew" on public.shoot_schedule_block_crew
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read shoot_schedule_block_talent" on public.shoot_schedule_block_talent
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read shoot_schedule_blocks" on public.shoot_schedule_blocks
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read shoots" on public.shoots
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Staff read studio_shipments" on public.studio_shipments
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

