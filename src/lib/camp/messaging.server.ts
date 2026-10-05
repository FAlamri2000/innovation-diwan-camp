/**
 * Camp operations — sending (Module 6 primitives).
 *
 * Every send is logged in camp_send_log (FR-NOT-05) with what was sent, to
 * whom, and what failed. Scheduled items carry a dedupe key so a doubled
 * tick never sends twice; the unique index is the guard, not a read-check.
 */
import { CHANNEL_LIMITS, unfilled } from "./cues";
import { q } from "./db.server";
import { sowork, SoworkError } from "./sowork.server";

export type SendKind = "cue" | "nudge" | "alert" | "manual" | "test" | "summary";

export type DmTarget = { swUserId: string; text: string };

export type SendOutcome = {
  logId: string | null;
  status: "sent" | "partial" | "failed" | "skipped";
  delivered: number;
  failures: { userId?: string; error: string; text?: string }[];
};

const errorText = (error: unknown) =>
  error instanceof SoworkError
    ? `${error.status} ${error.code}`
    : error instanceof Error
      ? error.message
      : String(error);

/**
 * Reserve the dedupe key BEFORE sending: if two ticks race, one insert wins
 * and the other sends nothing. The row is completed after the send.
 */
async function reserve(meta: {
  kind: SendKind;
  itemKey: string | null;
  channel: "dm" | "channel" | "gong" | "announcement" | "npc";
  dayNo: number | null;
  recipients: string[];
  text: string;
  dedupeKey: string | null;
  sentBy: string | null;
}): Promise<string | null> {
  const rows = await q<{ id: string }>(
    `insert into public.camp_send_log (kind, item_key, channel, day_no, recipients, text, status, dedupe_key, sent_by)
     values ($1, $2, $3, $4, $5, $6, 'skipped', $7, $8)
     on conflict (dedupe_key) do nothing returning id`,
    [
      meta.kind,
      meta.itemKey,
      meta.channel,
      meta.dayNo,
      meta.recipients,
      meta.text,
      meta.dedupeKey,
      meta.sentBy,
    ],
  );
  return rows[0]?.id ?? null;
}

async function complete(id: string, outcome: Omit<SendOutcome, "logId">): Promise<void> {
  await q(
    `update public.camp_send_log set status = $2, delivered = $3, failures = $4::jsonb where id = $1`,
    [id, outcome.status, outcome.delivered, JSON.stringify(outcome.failures)],
  );
}

async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item as T);
    }
  });
  await Promise.all(runners);
}

/**
 * One direct message per target (personalised text). Group DMs are not used:
 * a group of 8 would reveal recipients to each other and could not carry a
 * per-person suggested name.
 */
export async function sendDms(
  targets: readonly DmTarget[],
  meta: {
    kind: SendKind;
    itemKey: string | null;
    dayNo: number | null;
    dedupeKey?: string | null;
    sentBy: string | null;
    logText?: string;
  },
): Promise<SendOutcome> {
  const valid = targets.filter((t) => t.swUserId && t.text.trim());
  if (!valid.length) return { logId: null, status: "skipped", delivered: 0, failures: [] };
  const logText = meta.logText ?? (valid.length === 1 ? valid[0]!.text : valid[0]!.text);
  const id = await reserve({
    kind: meta.kind,
    itemKey: meta.itemKey,
    channel: "dm",
    dayNo: meta.dayNo,
    recipients: valid.map((t) => t.swUserId),
    text: logText,
    dedupeKey: meta.dedupeKey ?? null,
    sentBy: meta.sentBy,
  });
  if (!id) return { logId: null, status: "skipped", delivered: 0, failures: [] };

  const failures: SendOutcome["failures"] = [];
  let delivered = 0;
  await mapLimit(valid, 4, async (target) => {
    const missing = unfilled(target.text);
    if (missing.length) {
      failures.push({
        userId: target.swUserId,
        error: `unfilled: ${missing.join(", ")}`,
        text: target.text,
      });
      return;
    }
    try {
      await sowork.sendDm([target.swUserId], target.text.slice(0, CHANNEL_LIMITS.dm));
      delivered += 1;
    } catch (error) {
      failures.push({ userId: target.swUserId, error: errorText(error), text: target.text });
    }
  });
  const status = failures.length === 0 ? "sent" : delivered === 0 ? "failed" : "partial";
  await complete(id, { status, delivered, failures });
  return { logId: id, status, delivered, failures };
}

/** Gong, announcement or channel post: one call, office-wide (or channel-wide). */
export async function broadcast(
  channel: "gong" | "announcement" | "channel",
  text: string,
  meta: {
    kind: SendKind;
    itemKey: string | null;
    dayNo: number | null;
    dedupeKey?: string | null;
    sentBy: string | null;
    channelId?: string;
  },
): Promise<SendOutcome> {
  const missing = unfilled(text);
  const limit = CHANNEL_LIMITS[channel];
  const id = await reserve({
    kind: meta.kind,
    itemKey: meta.itemKey,
    channel,
    dayNo: meta.dayNo,
    recipients: meta.channelId ? [meta.channelId] : [],
    text,
    dedupeKey: meta.dedupeKey ?? null,
    sentBy: meta.sentBy,
  });
  if (!id) return { logId: null, status: "skipped", delivered: 0, failures: [] };
  let outcome: Omit<SendOutcome, "logId">;
  if (missing.length)
    outcome = {
      status: "failed",
      delivered: 0,
      failures: [{ error: `unfilled: ${missing.join(", ")}` }],
    };
  else if (text.length > limit)
    outcome = {
      status: "failed",
      delivered: 0,
      failures: [{ error: `too long: ${text.length} > ${limit}` }],
    };
  else {
    try {
      if (channel === "gong") await sowork.gong(text);
      else if (channel === "announcement") await sowork.announcement(text);
      else {
        if (!meta.channelId) throw new Error("no channel configured");
        await sowork.postToChannel(meta.channelId, text);
      }
      outcome = { status: "sent", delivered: 1, failures: [] };
    } catch (error) {
      outcome = { status: "failed", delivered: 0, failures: [{ error: errorText(error) }] };
    }
  }
  await complete(id, outcome);
  return { logId: id, ...outcome };
}

/** Wayfinding NPC (S09): place it in the main hall with a bubble, or hide it. */
export async function npcWayfinding(
  action: { show: true; text: string; zoneId: string } | { show: false },
  meta: { npcId: string | null; dayNo: number | null; dedupeKey: string; itemKey: string },
): Promise<{ outcome: SendOutcome; npcId: string | null }> {
  const text = action.show ? action.text : "";
  const id = await reserve({
    kind: "cue",
    itemKey: meta.itemKey,
    channel: "npc",
    dayNo: meta.dayNo,
    recipients: [],
    text: action.show ? text : "—",
    dedupeKey: meta.dedupeKey,
    sentBy: null,
  });
  if (!id)
    return {
      outcome: { logId: null, status: "skipped", delivered: 0, failures: [] },
      npcId: meta.npcId,
    };
  let npcId = meta.npcId;
  try {
    if (action.show) {
      if (text.length > CHANNEL_LIMITS.npc)
        throw new Error(`too long: ${text.length} > ${CHANNEL_LIMITS.npc}`);
      if (!npcId) {
        const created = await sowork.createNpc({
          name: "دليل المعسكر",
          location: { type: "zone", zoneId: action.zoneId },
          visible: true,
        });
        npcId = created.id;
      }
      await sowork.patchNpc(npcId, {
        location: { type: "zone", zoneId: action.zoneId },
        visible: true,
        say: { text },
      });
    } else if (npcId) {
      await sowork.patchNpc(npcId, { say: null, visible: false });
    }
    const outcome = { status: "sent" as const, delivered: 1, failures: [] };
    await complete(id, outcome);
    return { outcome: { logId: id, ...outcome }, npcId };
  } catch (error) {
    const outcome = {
      status: "failed" as const,
      delivered: 0,
      failures: [{ error: errorText(error) }],
    };
    await complete(id, outcome);
    return { outcome: { logId: id, ...outcome }, npcId };
  }
}

/** FR-NOT-04: personal nudges already sent to this account today (Riyadh day). */
export async function nudgesToday(dayNo: number): Promise<Map<string, number>> {
  const rows = await q<{ sw: string; n: string }>(
    `select r as sw, count(*)::text as n from public.camp_send_log, unnest(recipients) as r
      where kind = 'nudge' and day_no = $1 and status in ('sent', 'partial') group by r`,
    [dayNo],
  );
  return new Map(rows.map((r) => [r.sw, Number(r.n)]));
}
