-- ===========================================================================
-- 0002 — Camp data: the SoWork virtual-camp mirror, the registry and agenda,
-- operator decisions, messaging and the audit trail.
--
-- THE SHAPE
--
--   * SoWork is the source of truth for what HAPPENED (camp_sw_users,
--     camp_events, camp_meetings, camp_intervals, camp_presence_spans,
--     camp_working_hours). Written only by the sync worker
--     (src/lib/camp/sync.server.ts), never by a user.
--   * The registry and agenda are the source of truth for what was EXPECTED
--     (camp_teams, camp_people, camp_guider_teams, camp_days, camp_sessions).
--     Written only by an applied import (camp_imports), so every change has a
--     reviewed diff behind it (FR-IMP-07).
--   * Operator DECISIONS are their own tables (links, duplicate decisions,
--     overrides, room assignments, the account-type change list), each carrying
--     who and why. Derived facts are recomputed from inputs + decisions on
--     read; nothing derived is stored except the per-day naming snapshot,
--     which IS history (the trend of FR-NAM-06 cannot be recomputed later).
--
-- AUTHORIZATION
--
--   The database is reachable only from the app server. Every write goes
--   through a server function that checks the caller's role first
--   (src/lib/auth/guards.ts); the *_by / actor columns hold app_users ids.
--
-- SENDING IS OFF BY DEFAULT
--
--   Every cue and nudge is seeded DISABLED and the global switch
--   (camp_settings.settings->>'sendingEnabled') defaults to false. The cues
--   ring a gong or post an announcement to the whole office; nothing may do
--   that until an operator has reviewed the text and switched it on.
-- ===========================================================================

-- 1. Settings, sync state, worker lease --------------------------------------
create table if not exists public.camp_settings (
  id boolean primary key default true check (id),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.camp_settings (id) values (true) on conflict (id) do nothing;

comment on table public.camp_settings is
  'Singleton. Partial settings document merged over the defaults in src/lib/camp/settings.ts at read time, so a new setting needs no migration.';

create table if not exists public.camp_sync_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.camp_leases (
  name text primary key,
  holder text not null,
  expires_at timestamptz not null
);

-- 2. SoWork mirror -----------------------------------------------------------
create table if not exists public.camp_sw_users (
  sw_user_id text primary key,
  name text not null default '',
  avatar_url text,
  -- Present in the latest GET /v1/users (teammates and admins). An account
  -- seen only in activity is a guest (BR-USR-01).
  in_directory boolean not null default false,
  directory_seen_at timestamptz,
  -- From the working-hours report; absent for guests.
  wh_role text check (wh_role in ('admin', 'teammate')),
  presence text check (presence in ('available', 'busy', 'away', 'offline')),
  presence_text text,
  presence_at timestamptz,
  timezone text,
  sources text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_activity_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.camp_sw_name_history (
  id bigserial primary key,
  sw_user_id text not null references public.camp_sw_users (sw_user_id) on delete cascade,
  name text not null,
  seen_at timestamptz not null default now()
);
create index if not exists camp_sw_name_history_user_idx
  on public.camp_sw_name_history (sw_user_id, seen_at);

-- Raw event log. SoWork keeps events 72 hours; this table keeps them for the
-- camp. Delivery is at-least-once, so event_id is the idempotency key.
create table if not exists public.camp_events (
  event_id text primary key,
  type text not null,
  created_at timestamptz not null,
  occurred_at timestamptz,
  data jsonb not null,
  source text not null default 'poll' check (source in ('poll', 'webhook')),
  received_at timestamptz not null default now()
);
create index if not exists camp_events_created_idx on public.camp_events (created_at);
create index if not exists camp_events_type_idx on public.camp_events (type, created_at);

-- 3. Agenda, registry, rooms (expected) -------------------------------------
create table if not exists public.camp_days (
  day_no int primary key check (day_no between 1 and 60),
  date date not null unique,
  phase text,
  header text,
  sheet_name text
);

create table if not exists public.camp_sessions (
  id uuid primary key default gen_random_uuid(),
  day_no int not null references public.camp_days (day_no) on delete cascade,
  seq int not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text not null,
  auto_type text not null,
  type_override text,
  -- day|normalized title|occurrence: survives a time edit, so an override and
  -- the cue shift of FR-NOT-07 follow the session rather than its old time.
  natural_key text not null unique,
  check (ends_at >= starts_at)
);
create index if not exists camp_sessions_day_idx on public.camp_sessions (day_no, starts_at);

create table if not exists public.camp_teams (
  team_no int primary key check (team_no between 1 and 999),
  application_no text,
  guider_name text,
  declared_members int,
  notes text
);

create table if not exists public.camp_people (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('participant', 'guider', 'coach')),
  name text not null,
  team_no int,
  member_order int,
  title text check (title in ('leader', 'member')),
  email text,
  phone text,
  notes text,
  source_sheet text,
  source_row int,
  natural_key text not null unique,
  updated_at timestamptz not null default now()
);
create index if not exists camp_people_team_idx on public.camp_people (team_no);

create table if not exists public.camp_guider_teams (
  guider_id uuid not null references public.camp_people (id) on delete cascade,
  team_no int not null,
  primary key (guider_id, team_no)
);

create table if not exists public.camp_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('main_hall', 'team', 'committee', 'other')),
  team_no int,
  committee_no int,
  label text not null,
  -- Meeting topics SoWork gives this room's meetings (FR-ATT-04 step 1).
  topics text[] not null default '{}',
  -- Zone id copied from the office; NPC wayfinding needs it.
  zone_id text,
  created_at timestamptz not null default now(),
  check (kind <> 'team' or team_no is not null),
  check (kind <> 'committee' or committee_no is not null)
);
create unique index if not exists camp_rooms_team_uidx
  on public.camp_rooms (team_no) where kind = 'team';
create unique index if not exists camp_rooms_committee_uidx
  on public.camp_rooms (committee_no) where kind = 'committee';
create unique index if not exists camp_rooms_main_hall_uidx
  on public.camp_rooms (kind) where kind = 'main_hall';

-- Which committee room each team goes to on a checkpoint day (4, 8, 12).
create table if not exists public.camp_committee_teams (
  day_no int not null,
  team_no int not null,
  committee_no int not null,
  primary key (day_no, team_no)
);

-- Day-14 judging order, so P07 reaches each team at its own time.
create table if not exists public.camp_judging_slots (
  team_no int primary key,
  round int not null,
  starts_at timestamptz not null
);

-- 4. Meetings and what happened in them -------------------------------------
create table if not exists public.camp_meetings (
  meeting_id text primary key,
  topic text,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null,
  ended_at timestamptz,
  participant_count int not null default 0,
  -- Manual placement only. Automatic placement (topic, participant mix) is
  -- derived on read so a corrected registry or room map re-places old meetings.
  room_id uuid references public.camp_rooms (id) on delete set null,
  room_set_by uuid,
  room_set_at timestamptz,
  -- Meeting library link (FR-REC-01..07). The video URL is NEVER stored: it
  -- is a signed link that expires after 24 hours (FR-REC-03).
  library_status text not null default 'pending'
    check (library_status in ('pending', 'linked', 'uncertain', 'none', 'manual')),
  library_item_id text,
  library_topic text,
  library_deep_link text,
  library_has_recording boolean,
  library_duration_seconds int,
  library_participants jsonb,
  library_candidates jsonb not null default '[]'::jsonb,
  library_checked_at timestamptz,
  library_attempts int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists camp_meetings_started_idx on public.camp_meetings (started_at);
create index if not exists camp_meetings_library_idx
  on public.camp_meetings (library_status) where library_status in ('pending', 'uncertain');

-- Snapshot of GET /v1/meetings participation (one join/leave per user).
create table if not exists public.camp_meeting_users (
  meeting_id text not null references public.camp_meetings (meeting_id) on delete cascade,
  sw_user_id text not null,
  joined_at timestamptz,
  left_at timestamptz,
  primary key (meeting_id, sw_user_id)
);

-- Time intervals per person per meeting (FR-ATT-03). Event-sourced rows are
-- authoritative; an 'api' row exists only for a (meeting, user) pair the
-- event log never saw, which is how BR-ATT-07 fills a gap.
create table if not exists public.camp_intervals (
  id bigserial primary key,
  meeting_id text not null references public.camp_meetings (meeting_id) on delete cascade,
  sw_user_id text not null,
  joined_at timestamptz not null,
  left_at timestamptz,
  source text not null check (source in ('event', 'api')),
  join_event_id text,
  left_event_id text
);
create index if not exists camp_intervals_pair_idx on public.camp_intervals (meeting_id, sw_user_id);
create index if not exists camp_intervals_joined_idx on public.camp_intervals (joined_at);
create index if not exists camp_intervals_open_idx
  on public.camp_intervals (meeting_id) where left_at is null;

create table if not exists public.camp_presence_spans (
  id bigserial primary key,
  sw_user_id text not null,
  availability text not null,
  started_at timestamptz not null,
  ended_at timestamptz
);
create index if not exists camp_presence_spans_user_idx
  on public.camp_presence_spans (sw_user_id, started_at);
create index if not exists camp_presence_spans_open_idx
  on public.camp_presence_spans (sw_user_id) where ended_at is null;

create table if not exists public.camp_working_hours (
  day date not null,
  sw_user_id text not null,
  name text,
  role text,
  clock_in timestamptz,
  clock_out timestamptz,
  available_seconds int not null default 0,
  meeting_seconds int not null default 0,
  busy_seconds int not null default 0,
  away_seconds int not null default 0,
  total_seconds int not null default 0,
  is_online boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (day, sw_user_id)
);

-- 5. Operator decisions -----------------------------------------------------
create table if not exists public.camp_account_links (
  sw_user_id text primary key,
  -- 'linked' → person_id is the registry record; 'not_in_registry' and
  -- 'unlinked' both suppress automatic matching for this account.
  status text not null check (status in ('linked', 'not_in_registry', 'unlinked')),
  person_id uuid references public.camp_people (id) on delete cascade,
  reason text not null check (length(btrim(reason)) > 0),
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  check (status <> 'linked' or person_id is not null)
);

create table if not exists public.camp_dup_decisions (
  pair_key text primary key,
  a_id text not null,
  b_id text not null,
  decision text not null check (decision in ('duplicate', 'not_duplicate', 'follow_up')),
  primary_id text,
  note text,
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  check (decision <> 'duplicate' or primary_id in (a_id, b_id))
);

create table if not exists public.camp_account_reviews (
  sw_user_id text primary key,
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now()
);

-- The account-type change list (FR-USR-07): the API cannot change a type,
-- rename or remove an account, so the dashboard prepares the list and an
-- owner applies it in SoWork admin. kind 'remove' carries a confirmed
-- duplicate's second account (FR-DUP-06).
create table if not exists public.camp_type_changes (
  id uuid primary key default gen_random_uuid(),
  sw_user_id text not null,
  kind text not null default 'type' check (kind in ('type', 'remove')),
  current_type text,
  requested_type text,
  reason text not null check (length(btrim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  done_at timestamptz,
  done_by text
);
create unique index if not exists camp_type_changes_pending_uidx
  on public.camp_type_changes (sw_user_id, kind) where status = 'pending';

create table if not exists public.camp_attendance_overrides (
  session_id uuid not null references public.camp_sessions (id) on delete cascade,
  -- 'p:<registry person uuid>' or 'u:<SoWork user id>' — the merged person.
  person_key text not null,
  -- Scope of a guider override: the team whose room it scores (BR-ATT-04).
  team_no int not null default 0,
  status text not null check (status in ('present', 'partial', 'absent', 'elsewhere', 'off_platform')),
  reason text not null check (length(btrim(reason)) > 0),
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  primary key (session_id, person_key, team_no)
);

-- 6. Naming history ----------------------------------------------------------
-- One row per account per camp day: the status that day's last refresh saw.
-- History by definition — the trend cannot be recomputed after a rename.
create table if not exists public.camp_naming_daily (
  day_no int not null,
  sw_user_id text not null,
  status text not null check (status in ('ok', 'note', 'violation')),
  issues text[] not null default '{}',
  name text not null,
  updated_at timestamptz not null default now(),
  primary key (day_no, sw_user_id)
);

create table if not exists public.camp_name_tracking (
  sw_user_id text primary key,
  first_violation_at timestamptz,
  fixed_at timestamptz,
  last_status text,
  last_name text,
  updated_at timestamptz not null default now()
);

-- 7. Messaging ---------------------------------------------------------------
create table if not exists public.camp_templates (
  key text primary key,
  kind text not null check (kind in ('message', 'nudge')),
  text text not null,
  enabled boolean not null default false,
  sort int not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.camp_cues (
  key text primary key,
  time_of_day time not null,
  end_time time,
  days int[] not null,
  disabled_days int[] not null default '{}',
  -- Per-day time shifts written when a re-imported agenda moves a session
  -- (FR-NOT-07): {"5": "18:32"}.
  day_times jsonb not null default '{}'::jsonb,
  channel text not null check (channel in ('channel', 'gong', 'announcement', 'npc')),
  text text not null,
  enabled boolean not null default false,
  sort int not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.camp_send_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('cue', 'nudge', 'alert', 'manual', 'test', 'summary')),
  item_key text,
  channel text not null check (channel in ('dm', 'channel', 'gong', 'announcement', 'npc')),
  day_no int,
  recipients text[] not null default '{}',
  text text not null,
  status text not null check (status in ('sent', 'partial', 'failed', 'skipped')),
  delivered int not null default 0,
  failures jsonb not null default '[]'::jsonb,
  -- Guards a scheduled item against a second send (cue key + day, nudge key +
  -- person + session...). Manual sends carry none.
  dedupe_key text unique,
  sent_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists camp_send_log_created_idx on public.camp_send_log (created_at desc);
create index if not exists camp_send_log_recipients_idx on public.camp_send_log using gin (recipients);

create table if not exists public.camp_alerts (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  day_no int,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  acknowledged_by uuid,
  acknowledged_at timestamptz
);
create index if not exists camp_alerts_created_idx on public.camp_alerts (created_at desc);

-- An app user operating the camp, and the SoWork account that is theirs:
-- tests go to it (FR-NOT-03) and on-duty operators receive alerts (FR-NOT-06).
create table if not exists public.camp_operators (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  sw_user_id text,
  on_duty boolean not null default true,
  updated_at timestamptz not null default now()
);

-- 8. Imports and audit -------------------------------------------------------
create table if not exists public.camp_imports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('registry', 'agenda')),
  file_name text not null,
  status text not null default 'preview' check (status in ('preview', 'applied', 'discarded')),
  parsed jsonb not null,
  issues jsonb not null default '[]'::jsonb,
  diff jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  applied_by uuid,
  applied_at timestamptz
);

-- FR-USR-11: every bulk action — who, when, which people, which template.
create table if not exists public.camp_audit (
  id bigserial primary key,
  actor uuid,
  action text not null,
  targets text[] not null default '{}',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists camp_audit_created_idx on public.camp_audit (created_at desc);

-- 9. Seeds ---------------------------------------------------------------------
-- Copy is the requirements document's, verbatim (sections 9 and 11). Every
-- template and cue starts disabled.
insert into public.camp_templates (key, kind, text, sort) values
  ('M01', 'message', 'مرحبًا {الاسم}، نرجو تعديل اسمك في المنصة ليظهر بهذه الصيغة: الاسم الكامل - رقم الفريق. الاسم المقترح لك: {الاسم المقترح}. يساعدنا ذلك في متابعة حضورك بدقة.', 1),
  ('M02', 'message', 'مرحبًا {الاسم}، نرجو تعديل اسمك في المنصة ليظهر بهذه الصيغة: الاسم الكامل - الصفة. الاسم المقترح لك: {الاسم المقترح}.', 2),
  ('P01', 'nudge', 'مرحبًا {الاسم}، بدأت {الفقرة} الساعة {الوقت}، وننتظرك في {المكان}.', 11),
  ('P02', 'nudge', 'مرحبًا {الاسم}، بدأت الجلسة الإرشادية، والفريق {الرقم} بانتظارك في غرفته.', 12),
  ('P03', 'nudge', 'مرحبًا {الاسم}، بدأت {الفقرة}، نرجو انضمام الفريق {الرقم} إلى غرفته الآن.', 13),
  ('P04', 'nudge', 'M01 / M02', 14),
  ('P05', 'nudge', 'لاحظنا وجود أكثر من حساب باسمك في المنصة، نرجو استخدام حساب واحد فقط: {اسم الحساب}.', 15),
  ('P06', 'nudge', 'افتقدنا حضورك في اليومين الماضيين. هل تواجه صعوبة في الدخول إلى المنصة؟ يسعدنا مساعدتك.', 16),
  ('P07', 'nudge', 'تبدأ جولة عروض فريقك الساعة {الوقت}، نرجو الحضور إلى القاعة الرئيسية قبل الموعد بـ 5 دقائق.', 17)
on conflict (key) do nothing;

insert into public.camp_cues (key, time_of_day, end_time, days, channel, text, sort) values
  ('S00', '16:30', null, array[2,3,4,5,6,7,8,9,10,11,12,13], 'channel', 'برنامج اليوم {التاريخ}: {الفقرات وأوقاتها}. نلقاكم الساعة 5:30 مساءً في القاعة الرئيسية', 0),
  ('S01', '17:20', null, array[2,3,4,5,6,7,8,9,10,11,12,13], 'gong', 'يبدأ برنامج اليوم بعد 10 دقائق في القاعة الرئيسية', 1),
  ('S02', '17:30', null, array[2,3,4,5,6,7,8,9,10,11,12,13], 'announcement', 'بدأ برنامج اليوم، وننتظركم في القاعة الرئيسية', 2),
  ('S03', '17:33', null, array[5,11], 'gong', 'يبدأ اللقاء الملهم بعد دقيقتين في القاعة الرئيسية', 3),
  ('S04', '18:00', null, array[2,3,4,5,6,7,8,9,10,11,12,13], 'announcement', 'استراحة لصلاة المغرب، ونعود إلى القاعة الرئيسية الساعة 6:25 مساءً', 4),
  ('S05', '18:22', null, array[2,3,4,5,6,7,8,9,10,11,12,13], 'gong', 'تبدأ الورشة الساعة 6:30 مساءً، نرجو العودة إلى القاعة الرئيسية', 5),
  ('S06', '19:30', null, array[2,3,4,5,6,7,8,9,10,11,12,13], 'announcement', 'استراحة لصلاة العشاء، وتُستأنف الورشة الساعة 8:00 مساءً', 6),
  ('S07', '19:55', null, array[2,3,4,5,6,7,8,9,10,11,12,13], 'gong', 'تُستأنف الورشة بعد 5 دقائق في القاعة الرئيسية', 7),
  ('S08', '20:25', null, array[2,3,5,6,7,9,10,11], 'announcement', 'تبدأ الجلسة الإرشادية الأولى الساعة 8:30 مساءً، نرجو التوجه إلى غرف الفرق', 8),
  ('S09', '20:25', '20:45', array[2,3,5,6,7,9,10,11], 'npc', 'غرف الفرق من هنا', 9),
  ('S10', '21:07', null, array[2,3,5,6,7,9,10,11], 'gong', 'تبدأ الجلسة الإرشادية الثانية بعد 3 دقائق', 10),
  ('S11', '20:25', null, array[4,8,12], 'announcement', 'تبدأ نقطة التحقق الساعة 8:30 مساءً، نرجو التوجه إلى غرفة اللجنة المحددة لفريقك', 11),
  ('S12', '20:25', null, array[13], 'announcement', 'تبدأ جلسة التدريب على الإلقاء الساعة 8:30 مساءً في غرف الفرق', 12),
  ('S13', '21:45', null, array[2,3,4,5,6,7,8,9,10,11,12], 'announcement', 'يبدأ تسليم مخرج اليوم الساعة 9:50 مساءً، ويُغلق الساعة 9:55 مساءً', 13),
  ('S14', '21:45', null, array[13], 'announcement', 'يبدأ اعتماد ملف العرض الساعة 9:50 مساءً', 14),
  ('S15', '21:55', null, array[2,3,4,5,6,7,8,9,10,11,12], 'announcement', 'شكرًا لحضوركم اليوم، نلقاكم غدًا الساعة 5:30 مساءً', 15),
  ('S16', '21:55', null, array[13], 'announcement', 'شكرًا لكم، يبدأ يوم التحكيم غدًا الساعة 1:45 ظهرًا', 16),
  ('S17', '13:35', null, array[14], 'gong', 'يبدأ يوم التحكيم بعد 10 دقائق في القاعة الرئيسية', 17),
  ('S18', '13:55', null, array[14], 'announcement', 'تبدأ الجولة الأولى لعروض الفرق من 1 إلى 10 الساعة 2:00 ظهرًا', 18),
  ('S19', '15:00', null, array[14], 'announcement', 'استراحة لصلاة العصر، ونعود إلى القاعة الرئيسية الساعة 3:30 مساءً', 19),
  ('S20', '15:30', null, array[14], 'announcement', 'تبدأ الجولة الثانية لعروض الفرق من 11 إلى 20 الساعة 3:35 مساءً', 20),
  ('S21', '17:05', null, array[14], 'announcement', 'استراحة لصلاة المغرب، ونعود إلى القاعة الرئيسية الساعة 5:45 مساءً', 21),
  ('S22', '17:45', null, array[14], 'announcement', 'تبدأ الجولة الثالثة لعروض الفرق من 21 إلى 29 الساعة 5:50 مساءً', 22),
  ('S23', '19:08', null, array[14], 'gong', 'يُعلَن المتأهلون بعد دقيقتين في القاعة الرئيسية', 23)
on conflict (key) do nothing;

-- The room map starts with the shared rooms; team rooms are added from the
-- registry on the first import (one per team), committee rooms 1–4 here.
insert into public.camp_rooms (kind, label)
select 'main_hall', 'القاعة الرئيسية'
where not exists (select 1 from public.camp_rooms where kind = 'main_hall');

insert into public.camp_rooms (kind, committee_no, label)
select 'committee', n, 'غرفة اللجنة ' || n
from generate_series(1, 4) as n
where not exists (select 1 from public.camp_rooms r where r.kind = 'committee' and r.committee_no = n);
