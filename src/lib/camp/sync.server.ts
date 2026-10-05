/**
 * Camp operations — the sync worker.
 *
 * One `runCampTick()` per minute (the in-process scheduler,
 * src/lib/scheduler.server.ts, or POST /api/tick), plus "تحديث الآن" from the
 * screens. A lease keeps ticks from overlapping; every step is idempotent, so
 * a crashed or doubled tick costs nothing but time.
 *
 * Steps, in order of how much harm a gap does:
 *   1. drain the event inbox — SoWork keeps events 72 hours (FR-ATT-01)
 *   2. meetings: active + recent, and a backward backfill to camp start
 *      (FR-ATT-02, BR-ATT-07)
 *   3. directory and working hours, on the FR-USR-10 cadence
 *   4. meeting library links (FR-REC-01)
 *   5. derived bookkeeping + messaging (camp/automation.server.ts)
 */
import { randomUUID } from "node:crypto";
import { decideLibrary, type LibraryItemLite } from "./recordings";
import { addDays, fromRiyadh, riyadhDate } from "./text";
import type { CampSettings } from "./settings";
import {
  acquireLease,
  getState,
  loadSettings,
  q,
  releaseLease,
  setState,
  toIso,
  tx,
  type Db,
} from "./db.server";
import {
  CAMP_EVENT_TYPES,
  sowork,
  soworkConfigured,
  SoworkError,
  type SwEventEnvelope,
  type SwMeeting,
  type SwSubscription,
  type SwUserRef,
} from "./sowork.server";

const RIYADH_TZ = "Asia/Riyadh";

export type StepResult = { ok: boolean; detail?: unknown; error?: string; ms: number };
export type TickResult = {
  skipped?: "busy" | "not_configured";
  startedAt: string;
  durationMs: number;
  steps: Record<string, StepResult>;
};

async function step(steps: Record<string, StepResult>, name: string, work: () => Promise<unknown>) {
  const started = Date.now();
  try {
    const detail = await work();
    steps[name] = { ok: true, detail, ms: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[camp] ${name} failed:`, message);
    steps[name] = { ok: false, error: message.slice(0, 500), ms: Date.now() - started };
  }
}

// ---------------------------------------------------------------------------
// Accounts seen anywhere
// ---------------------------------------------------------------------------

async function touchUsers(
  db: Db,
  users: readonly SwUserRef[],
  source: string,
  at: string | null,
): Promise<void> {
  const seen = new Map<string, SwUserRef>();
  for (const u of users) if (u?.id) seen.set(u.id, u);
  if (!seen.size) return;
  const list = [...seen.values()];
  await db.query(
    `insert into public.camp_sw_users (sw_user_id, name, avatar_url, sources, last_activity_at)
     select x.id, coalesce(x.name, ''), x.avatar, array[$2::text], $3::timestamptz
       from jsonb_to_recordset($1::jsonb) as x(id text, name text, avatar text)
     on conflict (sw_user_id) do update set
       -- /v1/users is the authority on a member's current name; a drained
       -- 72-hour backlog must not write yesterday's name back over it.
       name = case when camp_sw_users.in_directory or coalesce(excluded.name, '') = '' then camp_sw_users.name
                   else excluded.name end,
       avatar_url = coalesce(excluded.avatar_url, camp_sw_users.avatar_url),
       sources = case when $2 = any(camp_sw_users.sources) then camp_sw_users.sources
                      else array_append(camp_sw_users.sources, $2::text) end,
       last_activity_at = greatest(camp_sw_users.last_activity_at, excluded.last_activity_at),
       updated_at = now()`,
    [
      JSON.stringify(
        list.map((u) => ({ id: u.id, name: u.name ?? null, avatar: u.avatarUrl ?? null })),
      ),
      source,
      at,
    ],
  );
  await recordNames(db, list);
}

/** Keep every distinct display name an account has had (FR-NAM-05 "fixed on"). */
async function recordNames(
  db: Db,
  users: readonly SwUserRef[],
  fromDirectory = false,
): Promise<void> {
  const named = users.filter((u) => u.name);
  if (!named.length) return;
  await db.query(
    `insert into public.camp_sw_name_history (sw_user_id, name)
     select x.id, x.name from jsonb_to_recordset($1::jsonb) as x(id text, name text)
      where exists (select 1 from public.camp_sw_users u where u.sw_user_id = x.id and (not u.in_directory or $2))
        and not exists (
          select 1 from public.camp_sw_name_history h
           where h.sw_user_id = x.id
             and h.id = (select max(h2.id) from public.camp_sw_name_history h2 where h2.sw_user_id = x.id)
             and h.name = x.name)`,
    [JSON.stringify(named.map((u) => ({ id: u.id, name: u.name }))), fromDirectory],
  );
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

async function upsertMeeting(db: Db, m: SwMeeting): Promise<void> {
  await db.query(
    `insert into public.camp_meetings (meeting_id, topic, status, started_at, ended_at, participant_count, updated_at)
     values ($1, nullif($2, ''), $3, $4, $5, $6, now())
     on conflict (meeting_id) do update set
       topic = coalesce(excluded.topic, camp_meetings.topic),
       status = case when camp_meetings.status = 'ended' then 'ended' else excluded.status end,
       started_at = least(camp_meetings.started_at, excluded.started_at),
       ended_at = coalesce(excluded.ended_at, camp_meetings.ended_at),
       participant_count = greatest(camp_meetings.participant_count, excluded.participant_count),
       updated_at = now()`,
    [m.id, m.topic ?? "", m.status, toIso(m.startedAt), toIso(m.endedAt), m.users?.length ?? 0],
  );
  const users = (m.users ?? []).filter((u) => u.user?.id);
  if (users.length) {
    await db.query(
      `insert into public.camp_meeting_users (meeting_id, sw_user_id, joined_at, left_at)
       select $1, x.id, x.joined, x.left_at
         from jsonb_to_recordset($2::jsonb) as x(id text, joined timestamptz, left_at timestamptz)
       on conflict (meeting_id, sw_user_id) do update set
         joined_at = least(coalesce(camp_meeting_users.joined_at, excluded.joined_at), excluded.joined_at),
         left_at = case
           when excluded.left_at is null then camp_meeting_users.left_at
           when camp_meeting_users.left_at is null then excluded.left_at
           else greatest(camp_meeting_users.left_at, excluded.left_at) end`,
      [
        m.id,
        JSON.stringify(
          users.map((u) => ({
            id: u.user.id,
            joined: toIso(u.participation?.joinedAt) ?? toIso(m.startedAt),
            left_at: toIso(u.participation?.leftAt),
          })),
        ),
      ],
    );
    await touchUsers(
      db,
      users.map((u) => u.user),
      "meeting",
      toIso(m.endedAt ?? m.startedAt),
    );
  }
  // BR-ATT-07: the API's one join/leave per user fills any (meeting, user)
  // pair the event log never saw. Event-sourced rows are left alone.
  // Rewritten only when the API's figures changed, so a meeting re-read every
  // minute does not churn its rows.
  await db.query(
    `with pairs as (
       select mu.meeting_id, mu.sw_user_id, mu.joined_at,
              coalesce(mu.left_at, case when mt.status = 'ended' then mt.ended_at end) as left_at
         from public.camp_meeting_users mu
         join public.camp_meetings mt on mt.meeting_id = mu.meeting_id
        where mu.meeting_id = $1 and mu.joined_at is not null
          and not exists (select 1 from public.camp_intervals e
                           where e.meeting_id = mu.meeting_id and e.sw_user_id = mu.sw_user_id and e.source = 'event')
     ), removed as (
       delete from public.camp_intervals i
        where i.meeting_id = $1 and i.source = 'api'
          and not exists (select 1 from pairs p
                           where p.sw_user_id = i.sw_user_id and p.joined_at = i.joined_at
                             and p.left_at is not distinct from i.left_at)
     )
     insert into public.camp_intervals (meeting_id, sw_user_id, joined_at, left_at, source)
     select p.meeting_id, p.sw_user_id, p.joined_at, p.left_at, 'api' from pairs p
      where not exists (select 1 from public.camp_intervals i
                         where i.meeting_id = p.meeting_id and i.sw_user_id = p.sw_user_id and i.source = 'api'
                           and i.joined_at = p.joined_at and i.left_at is not distinct from p.left_at)`,
    [m.id],
  );
}

/** Active meetings and the last half hour, every tick. */
async function syncRecentMeetings(): Promise<{ active: number; recent: number }> {
  const now = Math.floor(Date.now() / 1000);
  const active = await sowork.meetings({ active: true, limit: 100 });
  const recent = await sowork.meetings({ since: now - 45 * 60, limit: 100 });
  const all = new Map<string, SwMeeting>();
  for (const m of [...recent.meetings, ...active.meetings]) all.set(m.id, m);
  // A meeting we still hold as active but SoWork no longer lists as active has
  // ended between ticks; fetch its canonical record to close it.
  const stale = await q<{ meeting_id: string }>(
    `select meeting_id from public.camp_meetings where status = 'active' and not (meeting_id = any($1::text[]))`,
    [active.meetings.map((m) => m.id)],
  );
  for (const row of stale.slice(0, 20)) {
    if (all.has(row.meeting_id)) continue;
    try {
      all.set(row.meeting_id, await sowork.meeting(row.meeting_id));
    } catch (error) {
      if (error instanceof SoworkError && error.status === 404) {
        await q(
          `update public.camp_meetings set status = 'ended', ended_at = coalesce(ended_at, now()) where meeting_id = $1`,
          [row.meeting_id],
        );
      } else throw error;
    }
  }
  await tx(async (db) => {
    for (const m of all.values()) await upsertMeeting(db, m);
  });
  return { active: active.meetings.length, recent: recent.meetings.length };
}

type BackfillState = {
  before?: string | null;
  done?: boolean;
  pages?: number;
  lastFullAt?: string;
};

/**
 * Walk GET /v1/meetings backwards from now to the day before the camp, a few
 * pages per tick (FR-ATT-02). Once done, re-walk the last 26 hours hourly so
 * late leave times land.
 */
async function backfillMeetings(
  settings: CampSettings,
  pagesPerTick: number,
): Promise<BackfillState> {
  const state = (await getState<BackfillState>("meetings_backfill")) ?? {};
  const floor = Math.floor(fromRiyadh(addDays(settings.startDate, -1), "00:00").getTime() / 1000);
  const lastFull = state.lastFullAt ? Date.parse(state.lastFullAt) : 0;
  let cursor = state.before ?? null;
  const done = !!state.done;
  let since = floor;
  if (done) {
    if (Date.now() - lastFull < 60 * 60_000) return state;
    since = Math.floor(Date.now() / 1000) - 26 * 3600;
    cursor = null;
  }
  let pages = 0;
  let reachedEnd = false;
  while (pages < pagesPerTick) {
    const page = await sowork.meetings({ since, limit: 100, before: cursor ?? undefined });
    pages += 1;
    await tx(async (db) => {
      for (const m of page.meetings) await upsertMeeting(db, m);
    });
    if (!page.nextCursor || !page.meetings.length) {
      reachedEnd = true;
      break;
    }
    cursor = page.nextCursor;
  }
  const next: BackfillState = done
    ? { ...state, lastFullAt: reachedEnd ? new Date().toISOString() : state.lastFullAt, pages }
    : reachedEnd
      ? {
          done: true,
          before: null,
          pages: (state.pages ?? 0) + pages,
          lastFullAt: new Date().toISOString(),
        }
      : { done: false, before: cursor, pages: (state.pages ?? 0) + pages };
  // A re-walk that did not finish in one tick simply starts over next hour.
  await setState("meetings_backfill", next);
  return next;
}

// ---------------------------------------------------------------------------
// Events (FR-ATT-01)
// ---------------------------------------------------------------------------

type SubscriptionState = { id: string; events: string[] } | null;

function coversCampEvents(sub: SwSubscription): boolean {
  return !sub.url && !sub.disabledAt && CAMP_EVENT_TYPES.every((type) => sub.events.includes(type));
}

/** Find the inbox subscription this office already has for the camp events. */
export async function findInboxSubscription(): Promise<SwSubscription | null> {
  const list = await sowork.subscriptions();
  return list.webhooks.find(coversCampEvents) ?? null;
}

/** Operator action (Settings): create the inbox subscription if none exists. */
export async function ensureInboxSubscription(): Promise<{ id: string; created: boolean }> {
  const existing = await findInboxSubscription();
  if (existing) {
    await setState("subscription", { id: existing.id, events: existing.events });
    return { id: existing.id, created: false };
  }
  const created = await sowork.createInboxSubscription(CAMP_EVENT_TYPES);
  await setState("subscription", { id: created.id, events: created.events });
  return { id: created.id, created: true };
}

const eventTime = (event: SwEventEnvelope): number => {
  const data = event.data as { occurredAt?: number } | null;
  return data?.occurredAt ?? event.createdAt;
};

async function applyEvent(db: Db, event: SwEventEnvelope): Promise<void> {
  const at = toIso(eventTime(event)) ?? new Date().toISOString();
  const data = (event.data ?? {}) as {
    meeting?: SwMeeting;
    user?: SwUserRef;
    presence?: { availability: string; textStatus?: string };
  };
  switch (event.type) {
    case "meeting.started": {
      if (data.meeting) await upsertMeeting(db, { ...data.meeting, status: "active" });
      return;
    }
    case "meeting.ended": {
      if (!data.meeting) return;
      const endedAt = toIso(data.meeting.endedAt) ?? at;
      await upsertMeeting(db, {
        ...data.meeting,
        status: "ended",
        endedAt: data.meeting.endedAt ?? eventTime(event),
      });
      await db.query(
        `update public.camp_meetings set status = 'ended', ended_at = coalesce(ended_at, $2), library_status =
           case when library_status in ('linked', 'manual', 'uncertain') then library_status else 'pending' end
          where meeting_id = $1`,
        [data.meeting.id, endedAt],
      );
      // FR-ATT-03: a join with no leave closes at the meeting's end.
      await db.query(
        `update public.camp_intervals set left_at = greatest(joined_at, $2::timestamptz)
          where meeting_id = $1 and left_at is null`,
        [data.meeting.id, endedAt],
      );
      return;
    }
    case "meeting.user_joined": {
      if (!data.meeting || !data.user?.id) return;
      await ensureMeetingRow(db, data.meeting);
      await touchUsers(db, [data.user], "event", at);
      // Events are authoritative for this pair from now on.
      await db.query(
        `delete from public.camp_intervals where meeting_id = $1 and sw_user_id = $2 and source = 'api'`,
        [data.meeting.id, data.user.id],
      );
      await db.query(
        `insert into public.camp_intervals (meeting_id, sw_user_id, joined_at, source, join_event_id)
         select $1, $2, $3, 'event', $4
          where not exists (
            select 1 from public.camp_intervals i
             where i.meeting_id = $1 and i.sw_user_id = $2 and i.source = 'event'
               and (i.left_at is null or (i.joined_at <= $3::timestamptz and i.left_at >= $3::timestamptz)))`,
        [data.meeting.id, data.user.id, at, event.id],
      );
      return;
    }
    case "meeting.user_left": {
      if (!data.meeting || !data.user?.id) return;
      await ensureMeetingRow(db, data.meeting);
      await touchUsers(db, [data.user], "event", at);
      const closed = await db.query(
        `update public.camp_intervals set left_at = greatest(joined_at, $3::timestamptz), left_event_id = $4
          where id = (select id from public.camp_intervals
                       where meeting_id = $1 and sw_user_id = $2 and source = 'event' and left_at is null
                       order by joined_at desc limit 1)`,
        [data.meeting.id, data.user.id, at, event.id],
      );
      if (!closed.rowCount) {
        // A leave whose join predates the subscription: start it at the API's
        // join time, else the meeting's start.
        await db.query(
          `delete from public.camp_intervals where meeting_id = $1 and sw_user_id = $2 and source = 'api'`,
          [data.meeting.id, data.user.id],
        );
        await db.query(
          `insert into public.camp_intervals (meeting_id, sw_user_id, joined_at, left_at, source, left_event_id)
           select $1, $2,
                  least($3::timestamptz, coalesce(
                    (select joined_at from public.camp_meeting_users where meeting_id = $1 and sw_user_id = $2),
                    (select started_at from public.camp_meetings where meeting_id = $1), $3::timestamptz)),
                  $3, 'event', $4
            where not exists (select 1 from public.camp_intervals where left_event_id = $4)`,
          [data.meeting.id, data.user.id, at, event.id],
        );
      }
      return;
    }
    case "office.member_presence_updated": {
      const user = data.user;
      const availability = data.presence?.availability;
      if (!user?.id || !availability) return;
      await touchUsers(db, [user], "event", null);
      await db.query(
        `update public.camp_sw_users set presence = $2, presence_text = $3, presence_at = $4, updated_at = now()
          where sw_user_id = $1 and (presence_at is null or presence_at <= $4::timestamptz)`,
        [user.id, availability, data.presence?.textStatus ?? null, at],
      );
      await db.query(
        `update public.camp_presence_spans set ended_at = greatest(started_at, $2::timestamptz)
          where sw_user_id = $1 and ended_at is null`,
        [user.id, at],
      );
      if (availability !== "offline") {
        await db.query(
          `insert into public.camp_presence_spans (sw_user_id, availability, started_at) values ($1, $2, $3)`,
          [user.id, availability, at],
        );
      }
      return;
    }
    default:
      return;
  }
}

async function ensureMeetingRow(db: Db, m: SwMeeting): Promise<void> {
  await db.query(
    `insert into public.camp_meetings (meeting_id, topic, status, started_at, participant_count)
     values ($1, nullif($2, ''), $3, $4, 0)
     on conflict (meeting_id) do update set topic = coalesce(camp_meetings.topic, excluded.topic)`,
    [m.id, m.topic ?? "", m.status ?? "active", toIso(m.startedAt) ?? new Date().toISOString()],
  );
}

type CursorState = { after: string | null; lastEventAt?: string; drained?: number };

async function drainEvents(
  maxPages: number,
): Promise<{ received: number; inserted: number; subscription: string | null }> {
  let sub = await getState<SubscriptionState>("subscription");
  if (!sub) {
    const found = await findInboxSubscription();
    if (!found) return { received: 0, inserted: 0, subscription: null };
    sub = { id: found.id, events: found.events };
    await setState("subscription", sub);
  }
  const cursor = (await getState<CursorState>("events_cursor")) ?? { after: null };
  let after = cursor.after;
  let received = 0;
  let inserted = 0;
  let lastEventAt = cursor.lastEventAt;
  for (let page = 0; page < maxPages; page += 1) {
    let res;
    try {
      res = await sowork.events({ after: after ?? undefined, limit: 100, subscriptionId: sub.id });
    } catch (error) {
      // The subscription was deleted in SoWork: forget it, find or wait for another.
      if (error instanceof SoworkError && (error.status === 404 || error.status === 403)) {
        await setState("subscription", null);
      }
      throw error;
    }
    if (!res.items.length) break;
    received += res.items.length;
    const pageLast = res.items[res.items.length - 1]!.logId;
    inserted += await tx(async (db) => {
      let fresh = 0;
      for (const { event } of res.items) {
        const ins = await db.query(
          `insert into public.camp_events (event_id, type, created_at, occurred_at, data, source)
           values ($1, $2, $3, $4, $5::jsonb, 'poll') on conflict (event_id) do nothing returning event_id`,
          [
            event.id,
            event.type,
            toIso(event.createdAt),
            toIso(eventTime(event)),
            JSON.stringify(event.data ?? {}),
          ],
        );
        if (!ins.rowCount) continue; // at-least-once delivery: dedupe on event.id
        fresh += 1;
        await applyEvent(db, event);
      }
      // Cursor moves in the same transaction as the effects it covers.
      lastEventAt = toIso(res.items[res.items.length - 1]!.event.createdAt) ?? lastEventAt;
      await setState(
        "events_cursor",
        { after: pageLast, lastEventAt, drained: (cursor.drained ?? 0) + fresh },
        db,
      );
      return fresh;
    });
    after = pageLast;
    if (!res.hasMore) break;
  }
  return { received, inserted, subscription: sub.id };
}

// ---------------------------------------------------------------------------
// Directory and working hours (FR-USR-01, FR-USR-10)
// ---------------------------------------------------------------------------

async function refreshDirectory(): Promise<{ users: number }> {
  const { users } = await sowork.users();
  await tx(async (db) => {
    await db.query(
      `insert into public.camp_sw_users (sw_user_id, name, avatar_url, in_directory, directory_seen_at, presence,
                                         presence_text, presence_at, timezone, sources)
       select x.id, coalesce(x.name, ''), x.avatar, true, now(), x.availability, x.text_status, now(), x.tz,
              array['users']
         from jsonb_to_recordset($1::jsonb) as x(id text, name text, avatar text, availability text, text_status text, tz text)
       on conflict (sw_user_id) do update set
         name = coalesce(nullif(excluded.name, ''), camp_sw_users.name),
         avatar_url = coalesce(excluded.avatar_url, camp_sw_users.avatar_url),
         in_directory = true,
         directory_seen_at = now(),
         presence = excluded.presence,
         presence_text = excluded.presence_text,
         presence_at = now(),
         timezone = coalesce(excluded.timezone, camp_sw_users.timezone),
         sources = case when 'users' = any(camp_sw_users.sources) then camp_sw_users.sources
                        else array_append(camp_sw_users.sources, 'users') end,
         updated_at = now()`,
      [
        JSON.stringify(
          users.map((u) => ({
            id: u.id,
            name: u.name ?? null,
            avatar: u.avatarUrl ?? null,
            availability: u.presence?.availability ?? null,
            text_status: u.presence?.textStatus ?? null,
            tz: u.timezone ?? null,
          })),
        ),
      ],
    );
    await db.query(
      `update public.camp_sw_users set in_directory = false, updated_at = now()
        where in_directory and not (sw_user_id = any($1::text[]))`,
      [users.map((u) => u.id)],
    );
    await recordNames(db, users, true);
  });
  return { users: users.length };
}

async function refreshWorkingHours(
  settings: CampSettings,
  full: boolean,
): Promise<{ days: number; entries: number }> {
  const today = riyadhDate(Date.now());
  const campEnd = addDays(settings.startDate, settings.dayCount - 1);
  const to = today < campEnd ? today : campEnd;
  if (to < settings.startDate) return { days: 0, entries: 0 };
  // Today (and yesterday until it is final) each refresh; the whole camp hourly.
  const from = full
    ? settings.startDate
    : addDays(to, -1) < settings.startDate
      ? settings.startDate
      : addDays(to, -1);
  const report = await sowork.workingHours({ from, to, timezone: RIYADH_TZ });
  let entries = 0;
  await tx(async (db) => {
    for (const day of report.days) {
      if (!day.entries.length) continue;
      entries += day.entries.length;
      await db.query(
        `insert into public.camp_working_hours (day, sw_user_id, name, role, clock_in, clock_out, available_seconds,
                                                meeting_seconds, busy_seconds, away_seconds, total_seconds, is_online, updated_at)
         select $1::date, x.id, x.name, x.role, x.clock_in, x.clock_out, x.available, x.meeting, x.busy, x.away, x.total,
                x.online, now()
           from jsonb_to_recordset($2::jsonb) as x(id text, name text, role text, clock_in timestamptz, clock_out timestamptz,
                available int, meeting int, busy int, away int, total int, online boolean)
         on conflict (day, sw_user_id) do update set
           name = excluded.name, role = excluded.role, clock_in = excluded.clock_in, clock_out = excluded.clock_out,
           available_seconds = excluded.available_seconds, meeting_seconds = excluded.meeting_seconds,
           busy_seconds = excluded.busy_seconds, away_seconds = excluded.away_seconds,
           total_seconds = excluded.total_seconds, is_online = excluded.is_online, updated_at = now()`,
        [
          day.date,
          JSON.stringify(
            day.entries.map((e) => ({
              id: e.userId,
              name: e.name ?? null,
              role: e.role ?? null,
              clock_in: toIso(e.clockIn),
              clock_out: toIso(e.clockOut),
              available: Math.round(e.availableSeconds),
              meeting: Math.round(e.meetingSeconds),
              busy: Math.round(e.busySeconds),
              away: Math.round(e.awaySeconds),
              total: Math.round(e.totalSeconds),
              online: e.isOnline,
            })),
          ),
        ],
      );
      await touchUsers(
        db,
        day.entries.map((e) => ({ id: e.userId, name: e.name })),
        "working_hours",
        toIso(day.entries.reduce((max, e) => Math.max(max, e.clockOut ?? e.clockIn ?? 0), 0)),
      );
    }
    // The role field marks current admins/teammates (BR-USR-01).
    const latest = report.days[report.days.length - 1];
    if (latest) {
      await db.query(
        `update public.camp_sw_users u set wh_role = x.role
           from jsonb_to_recordset($1::jsonb) as x(id text, role text)
          where u.sw_user_id = x.id and x.role is not null and u.wh_role is distinct from x.role`,
        [JSON.stringify(latest.entries.map((e) => ({ id: e.userId, role: e.role ?? null })))],
      );
    }
  });
  return { days: report.days.length, entries };
}

// ---------------------------------------------------------------------------
// Meeting library (FR-REC-01..07)
// ---------------------------------------------------------------------------

type LibraryCounts = { checked: number; linked: number; uncertain: number; none: number };

/**
 * Two batches per tick, so neither starves the other: meetings still inside
 * their retry window (items appear shortly after a meeting ends, FR-REC-01),
 * and the backlog past it — which this pass always finalises, so a backfill of
 * a thousand old meetings drains instead of waiting behind tonight's.
 */
async function linkLibrary(settings: CampSettings): Promise<LibraryCounts> {
  const recent = await linkLibraryBatch(settings, "recent");
  const backlog = await linkLibraryBatch(settings, "backlog");
  return {
    checked: recent.checked + backlog.checked,
    linked: recent.linked + backlog.linked,
    uncertain: recent.uncertain + backlog.uncertain,
    none: recent.none + backlog.none,
  };
}

async function linkLibraryBatch(
  settings: CampSettings,
  scope: "recent" | "backlog",
): Promise<LibraryCounts> {
  const inWindow =
    scope === "recent"
      ? "coalesce(ended_at, now()) >= now() - make_interval(mins => $1)"
      : "coalesce(ended_at, now()) < now() - make_interval(mins => $1)";
  const pending = await q<{
    meeting_id: string;
    topic: string | null;
    started_at: Date;
    ended_at: Date | null;
  }>(
    // A time-local batch: the newest pending meeting of this scope and those
    // that started within six hours before it. One library listing then
    // covers the batch without running into the page cap below.
    `with candidates as (
       select meeting_id, topic, started_at, ended_at from public.camp_meetings
        where status = 'ended' and library_status = 'pending' and ${inWindow}
     ), newest as (select max(started_at) as at from candidates)
     select c.meeting_id, c.topic, c.started_at, c.ended_at from candidates c, newest
      where c.started_at > newest.at - interval '6 hours'
      order by c.started_at desc limit 80`,
    [settings.libraryRetryMinutes],
  );
  if (!pending.length) return { checked: 0, linked: 0, uncertain: 0, none: 0 };
  const window = settings.libraryMatchSeconds;
  const since = Math.floor(Math.min(...pending.map((m) => m.started_at.getTime())) / 1000) - window;
  // Items start whenever recording or notes start, so cover each meeting's span.
  const until =
    Math.floor(Math.max(...pending.map((m) => (m.ended_at ?? m.started_at).getTime())) / 1000) +
    window;
  const items: (LibraryItemLite & {
    raw: {
      deepLink?: string;
      hasRecording?: boolean;
      durationSeconds: number | null;
      topic?: string;
      participants: unknown[];
    };
  })[] = [];
  let cursor: string | undefined;
  // A truncated listing must not turn "not fetched" into "no recording".
  let complete = false;
  for (let page = 0; page < 12; page += 1) {
    const res = await sowork.library({ since, until, limit: 50, cursor });
    for (const it of res.items) {
      items.push({
        id: it.id,
        topic: it.topic ?? null,
        startedAt: it.startedAt * 1000,
        endedAt: it.endedAt ? it.endedAt * 1000 : null,
        participantIds: (it.participants ?? []).map((p) => p.id),
        raw: {
          deepLink: it.deepLink,
          hasRecording: it.hasRecording,
          durationSeconds: it.durationSeconds,
          topic: it.topic,
          participants: it.participants ?? [],
        },
      });
    }
    if (!res.nextCursor) {
      complete = true;
      break;
    }
    cursor = res.nextCursor;
  }
  const accountsByMeeting = new Map<string, string[]>();
  const rows = await q<{ meeting_id: string; sw_user_id: string }>(
    `select meeting_id, sw_user_id from public.camp_meeting_users where meeting_id = any($1::text[])
     union select meeting_id, sw_user_id from public.camp_intervals where meeting_id = any($1::text[])`,
    [pending.map((m) => m.meeting_id)],
  );
  for (const r of rows)
    accountsByMeeting.set(r.meeting_id, [
      ...(accountsByMeeting.get(r.meeting_id) ?? []),
      r.sw_user_id,
    ]);
  const takenRows = await q<{ library_item_id: string }>(
    `select library_item_id from public.camp_meetings where library_item_id is not null`,
  );
  const taken = new Set(takenRows.map((r) => r.library_item_id));

  const counts = { checked: pending.length, linked: 0, uncertain: 0, none: 0 };
  await tx(async (db) => {
    for (const m of pending) {
      const decision = decideLibrary(
        {
          id: m.meeting_id,
          topic: m.topic,
          startedAt: m.started_at.getTime(),
          endedAt: m.ended_at?.getTime() ?? null,
          accountIds: [...new Set(accountsByMeeting.get(m.meeting_id) ?? [])],
        },
        items,
        { windowSeconds: window, retryMinutes: settings.libraryRetryMinutes, now: Date.now() },
        taken,
      );
      if (decision.status === "linked") {
        const item = items.find((it) => it.id === decision.itemId)!;
        taken.add(item.id);
        counts.linked += 1;
        await db.query(
          `update public.camp_meetings set library_status = 'linked', library_item_id = $2, library_topic = $3,
                  library_deep_link = $4, library_has_recording = $5, library_duration_seconds = $6,
                  library_participants = $7::jsonb, library_candidates = $8::jsonb, library_checked_at = now(),
                  library_attempts = library_attempts + 1
            where meeting_id = $1`,
          [
            m.meeting_id,
            item.id,
            item.raw.topic ?? null,
            item.raw.deepLink ?? null,
            item.raw.hasRecording ?? null,
            item.raw.durationSeconds,
            JSON.stringify(item.raw.participants),
            JSON.stringify(decision.candidates),
          ],
        );
        await touchUsers(
          db,
          item.raw.participants as SwUserRef[],
          "library",
          toIso(Math.floor(item.startedAt / 1000)),
        );
      } else {
        if (decision.status === "none" && !complete) continue;
        if (decision.status === "uncertain") counts.uncertain += 1;
        if (decision.status === "none") counts.none += 1;
        await db.query(
          `update public.camp_meetings set library_status = $2, library_candidates = $3::jsonb,
                  library_checked_at = now(), library_attempts = library_attempts + 1
            where meeting_id = $1`,
          [m.meeting_id, decision.status, JSON.stringify(decision.candidates)],
        );
      }
    }
  });
  return counts;
}

// ---------------------------------------------------------------------------
// Cadence (FR-USR-10)
// ---------------------------------------------------------------------------

/** Agenda hours: from 30 min before the day's first item to 15 min after its last. */
export async function inAgendaHours(now = Date.now()): Promise<boolean> {
  const rows = await q<{ first: Date | null; last: Date | null }>(
    `select min(starts_at) as first, max(ends_at) as last from public.camp_sessions s
       join public.camp_days d on d.day_no = s.day_no where d.date = $1::date`,
    [riyadhDate(now)],
  );
  const first = rows[0]?.first?.getTime();
  const last = rows[0]?.last?.getTime();
  if (!first || !last) return false;
  return now >= first - 30 * 60_000 && now <= last + 15 * 60_000;
}

async function due(key: string, minutes: number, force: boolean): Promise<boolean> {
  if (force) return true;
  const state = await getState<{ at: string }>(`last_${key}`);
  return !state || Date.now() - Date.parse(state.at) >= minutes * 60_000 - 5_000;
}

const markDone = (key: string) => setState(`last_${key}`, { at: new Date().toISOString() });

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export async function runCampTick(opts: {
  force?: boolean;
  trigger: "schedule" | "manual";
}): Promise<TickResult> {
  const startedAt = new Date();
  const steps: Record<string, StepResult> = {};
  if (!soworkConfigured()) {
    return { skipped: "not_configured", startedAt: startedAt.toISOString(), durationMs: 0, steps };
  }
  const holder = randomUUID();
  if (!(await acquireLease("tick", holder, 150))) {
    return { skipped: "busy", startedAt: startedAt.toISOString(), durationMs: 0, steps };
  }
  try {
    const settings = await loadSettings();
    const force = !!opts.force;
    const agendaHours = await inAgendaHours();
    const cadence = agendaHours ? settings.refreshAgendaMinutes : settings.refreshIdleMinutes;

    await step(steps, "events", () => drainEvents(force ? 40 : 20));
    await step(steps, "meetings", () => syncRecentMeetings());
    await step(steps, "backfill", () => backfillMeetings(settings, force ? 10 : 4));
    if (await due("directory", cadence, force)) {
      await step(steps, "directory", async () => {
        const r = await refreshDirectory();
        await markDone("directory");
        return r;
      });
    }
    if (await due("working_hours", cadence, force)) {
      await step(steps, "working_hours", async () => {
        const full = await due("working_hours_full", 60, false);
        const r = await refreshWorkingHours(settings, full);
        await markDone("working_hours");
        if (full) await markDone("working_hours_full");
        return r;
      });
    }
    await step(steps, "library", () => linkLibrary(settings));

    // Derived bookkeeping and messaging read the model the steps above wrote.
    const { runAutomation } = await import("./automation.server");
    await step(steps, "automation", () =>
      runAutomation(settings, { now: Date.now(), agendaHours }),
    );

    const result: TickResult = {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      steps,
    };
    await setState("last_tick", { ...result, trigger: opts.trigger });
    return result;
  } finally {
    await releaseLease("tick", holder);
  }
}

/** For the sync status card (M10) and A07. */
export async function syncStatus() {
  const rows = await q<{ key: string; value: unknown; updated_at: Date }>(
    `select key, value, updated_at from public.camp_sync_state
      where key in ('last_tick', 'subscription', 'events_cursor', 'meetings_backfill', 'last_directory', 'last_working_hours')`,
  );
  const map = Object.fromEntries(
    rows.map((r) => [r.key, { value: r.value, updatedAt: r.updated_at.toISOString() }]),
  );
  const counts = await q<{ events: string; meetings: string; accounts: string }>(
    `select (select count(*) from public.camp_events)::text as events,
            (select count(*) from public.camp_meetings)::text as meetings,
            (select count(*) from public.camp_sw_users)::text as accounts`,
  );
  return {
    configured: soworkConfigured(),
    state: map,
    counts: {
      events: Number(counts[0]?.events ?? 0),
      meetings: Number(counts[0]?.meetings ?? 0),
      accounts: Number(counts[0]?.accounts ?? 0),
    },
  };
}
