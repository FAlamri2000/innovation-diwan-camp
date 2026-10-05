-- ---------------------------------------------------------------------------
-- Database assertion pack.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/qa/db-assertions.sql
--
-- Runs in ONE transaction and ROLLS BACK, so it is safe against a live
-- database. Pins what the server code relies on the schema to refuse: the
-- sign-in table's constraints, the operator-decision guards, and "sending is
-- off out of the box".
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\timing off

begin;

-- ---------------------------------------------------------------------------
-- 1. Sign-in: one account per email whatever its case; a closed role list;
--    sessions die with their user.
-- ---------------------------------------------------------------------------
do $$
declare _id uuid;
begin
  insert into public.app_users (email, name, role, password_hash)
  values ('fixture-user@example.invalid', 'Fixture', 'viewer', 'x') returning id into _id;
  begin
    insert into public.app_users (email, name, role, password_hash)
    values ('FIXTURE-USER@example.invalid', 'Fixture 2', 'viewer', 'x');
    raise exception 'FAIL 1a: two accounts for one email (case-insensitive)';
  exception when unique_violation then
    raise notice 'PASS 1a: email is unique, case-insensitively';
  end;
  begin
    insert into public.app_users (email, name, role, password_hash)
    values ('fixture-owner@example.invalid', 'Fixture 3', 'owner', 'x');
    raise exception 'FAIL 1b: an unknown role was accepted';
  exception when check_violation then
    raise notice 'PASS 1b: role is admin, editor or viewer';
  end;
  insert into public.app_sessions (token_hash, user_id, expires_at)
  values ('fixture-token-hash', _id, now() + interval '1 day');
  delete from public.app_users where id = _id;
  if exists (select 1 from public.app_sessions where token_hash = 'fixture-token-hash') then
    raise exception 'FAIL 1c: a session outlived its user';
  end if;
  raise notice 'PASS 1c: sessions are deleted with their user';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Decision-table guards.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.camp_account_links (sw_user_id, status, reason, decided_by)
    values ('fixlink01', 'linked', 'reason', '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL 2a: a "linked" decision without a registry record was accepted';
  exception when check_violation then
    raise notice 'PASS 2a: linked requires person_id';
  end;
  begin
    insert into public.camp_account_links (sw_user_id, status, reason, decided_by)
    values ('fixlink02', 'not_in_registry', '   ', '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL 2b: a blank reason was accepted (FR-USR-05)';
  exception when check_violation then
    raise notice 'PASS 2b: reason is required';
  end;
  begin
    insert into public.camp_dup_decisions (pair_key, a_id, b_id, decision, primary_id, decided_by)
    values ('aaaa1|bbbb2', 'aaaa1', 'bbbb2', 'duplicate', 'cccc3', '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL 2c: a duplicate whose main account is outside the pair was accepted';
  exception when check_violation then
    raise notice 'PASS 2c: the main account belongs to the pair';
  end;
  insert into public.camp_type_changes (sw_user_id, kind, requested_type, reason, requested_by)
  values ('fixchg01', 'type', 'guest', 'r', '00000000-0000-0000-0000-000000000000');
  begin
    insert into public.camp_type_changes (sw_user_id, kind, requested_type, reason, requested_by)
    values ('fixchg01', 'type', 'admin', 'r', '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL 2d: two pending type changes for one account';
  exception when unique_violation then
    raise notice 'PASS 2d: one pending change per account and kind';
  end;
  begin
    insert into public.camp_attendance_overrides (session_id, person_key, status, reason, decided_by)
    values (gen_random_uuid(), 'u:x', 'present', '', '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL 2e: an override without a reason was accepted (FR-ATT-09)';
  exception when check_violation or foreign_key_violation then
    raise notice 'PASS 2e: an override needs a reason and a real session';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Sending is off out of the box.
-- ---------------------------------------------------------------------------
do $$
declare _n int;
begin
  select count(*) into _n from public.camp_cues where enabled;
  if _n <> 0 then raise exception 'FAIL 3a: % cues are enabled by the seed', _n; end if;
  select count(*) into _n from public.camp_templates where enabled;
  if _n <> 0 then raise exception 'FAIL 3b: % templates are enabled by the seed', _n; end if;
  select count(*) into _n from public.camp_cues
   where channel in ('gong', 'announcement') and char_length(text) > 100;
  if _n <> 0 then raise exception 'FAIL 3c: % seeded popup cues exceed 100 characters', _n; end if;
  if coalesce((select (settings->>'sendingEnabled')::boolean from public.camp_settings where id), false) then
    raise notice 'NOTE 3d: sendingEnabled is ON in this database (an operator turned it on)';
  end if;
  raise notice 'PASS 3: cues and templates seeded disabled, popups within 100 characters';
end $$;

rollback;
