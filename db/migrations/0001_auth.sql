-- ===========================================================================
-- 0001 — Sign-in: the app's own users and sessions.
--
--   app_users      one row per operator. role is the whole permission model:
--                    viewer  reads every screen
--                    editor  + decisions, messages, imports, overrides
--                    admin   + settings, sending switch, templates and cues,
--                              broadcasts, event capture, user management
--   app_sessions   one row per signed-in browser. The cookie carries a random
--                  token; only its SHA-256 is stored, so a database read does
--                  not hand anyone a live session.
--   app_login_failures  recent failed sign-ins, for throttling.
-- ===========================================================================

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null default '',
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  password_hash text not null,
  active boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists app_users_email_key on public.app_users (lower(email));

create table if not exists public.app_sessions (
  token_hash text primary key,
  user_id uuid not null references public.app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);
create index if not exists app_sessions_user_idx on public.app_sessions (user_id);
create index if not exists app_sessions_expires_idx on public.app_sessions (expires_at);

create table if not exists public.app_login_failures (
  id bigserial primary key,
  email text not null,
  ip text,
  at timestamptz not null default now()
);
create index if not exists app_login_failures_email_idx on public.app_login_failures (lower(email), at desc);
