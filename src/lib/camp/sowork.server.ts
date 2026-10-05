/**
 * SoWork public API v1 client (https://api.sowork.com/public, spec 1.28.0).
 *
 * Server-only: the API key is an OWNER key of the camp office with the admin
 * team-analytics permission (§2), so it reads every meeting in the office.
 * It lives in SOWORK_API_KEY and nowhere else — never in the database, never
 * in a settings document an operator can read back.
 *
 * Only the endpoints the camp dashboard uses are wrapped. Every method returns
 * the API's own JSON shape; mapping into camp tables happens in sync.server.ts.
 */
import process from "node:process";

export class SoworkConfigError extends Error {
  constructor() {
    super("SOWORK_API_KEY is not set");
    this.name = "SoworkConfigError";
  }
}

export class SoworkError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly path: string,
  ) {
    super(`SoWork ${status} ${code} on ${path}: ${message}`);
    this.name = "SoworkError";
  }
}

export function soworkConfigured(): boolean {
  return !!process.env.SOWORK_API_KEY;
}

function apiKey(): string {
  const key = process.env.SOWORK_API_KEY;
  if (!key) throw new SoworkConfigError();
  return key;
}

function baseUrl(): string {
  return (process.env.SOWORK_API_BASE ?? "https://api.sowork.com/public").replace(/\/+$/, "");
}

type Query = Record<string, string | number | boolean | readonly string[] | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(baseUrl() + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    // `include` is repeated, never `include[]=` (the API rejects that with 400).
    if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, String(v));
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { query?: Query; body?: unknown } = {},
): Promise<T> {
  const url = buildUrl(path, opts.query);
  // One retry on 429 / 5xx / network failure. Writes are retried only where
  // the API makes them safe (DMs are get-or-create per participant set; the
  // caller dedupes everything else through camp_send_log).
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          Accept: "application/json",
          ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      if (attempt === 0 && method === "GET") {
        await sleep(1_000);
        continue;
      }
      throw new SoworkError(
        0,
        "network",
        error instanceof Error ? error.message : String(error),
        path,
      );
    }
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1_500,
      );
      continue;
    }
    if (response.status === 204) return undefined as T;
    const textBody = await response.text();
    let json: unknown = null;
    try {
      json = textBody ? JSON.parse(textBody) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const err = (json ?? {}) as { error?: string; code?: string; message?: string };
      throw new SoworkError(
        response.status,
        err.code ?? err.error ?? "error",
        err.message ?? textBody.slice(0, 300),
        path,
      );
    }
    return json as T;
  }
}

// ---------------------------------------------------------------------------
// Shapes (only the fields the dashboard reads)
// ---------------------------------------------------------------------------

export type SwUserRef = { id: string; name?: string; avatarUrl?: string };
export type SwAvailability = "available" | "busy" | "away" | "offline";
export type SwPresence = { availability: SwAvailability; textStatus?: string };
export type SwUser = SwUserRef & { presence: SwPresence; timezone?: string };

export type SwMeeting = {
  id: string;
  officeId: string;
  startedAt: number;
  endedAt?: number;
  status: "active" | "ended";
  topic?: string;
  users: { user: SwUserRef; participation: { joinedAt?: number; leftAt?: number } }[];
};

export type SwLibraryItem = {
  id: string;
  topic?: string;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number | null;
  participants: (SwUserRef & { durationSeconds: number | null })[];
  deepLink?: string;
  hasRecording?: boolean;
  noteContents?: { notesId: string; language: string; contentMarkdown: string }[];
  transcript?: { turns: { speaker: SwUserRef; atMs: number; text: string }[] };
  chatMessages?: { authorId: string; authorName?: string; text: string; sentAt: number }[];
  videoUrl?: string;
};

export type SwWorkingHoursEntry = {
  userId: string;
  name?: string;
  role?: "admin" | "teammate";
  clockIn?: number;
  clockOut?: number;
  availableSeconds: number;
  meetingSeconds: number;
  busySeconds: number;
  awaySeconds: number;
  totalSeconds: number;
  isOnline: boolean;
  isOnPto: boolean;
};

export type SwEventEnvelope = {
  id: string;
  type: string;
  createdAt: number;
  officeId: string;
  data: unknown;
};

export type SwSubscription = {
  id: string;
  url?: string;
  events: string[];
  officeId: string;
  createdAt: number;
  disabledAt?: number;
  lastDeliveredAt?: number;
  creator?: SwUserRef;
};

export type SwChannel = { id: string; name?: string; type: "public" | "private" };

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const sowork = {
  me: () => request<SwUser>("GET", "/v1/me"),

  users: () => request<{ users: SwUser[] }>("GET", "/v1/users"),

  meetings: (q: {
    since?: number;
    until?: number;
    before?: string;
    limit?: number;
    active?: boolean;
  }) =>
    request<{ meetings: SwMeeting[]; nextCursor?: string }>("GET", "/v1/meetings", { query: q }),

  meeting: (id: string) => request<SwMeeting>("GET", `/v1/meetings/${encodeURIComponent(id)}`),

  library: (q: { since?: number; until?: number; cursor?: string; limit?: number }) =>
    request<{
      items: SwLibraryItem[];
      nextCursor?: string;
      hydration?: { indexed: number; total: number };
    }>("GET", "/v1/meeting-library", { query: q }),

  libraryItem: (
    id: string,
    include: readonly ("notes" | "transcript" | "video" | "chat" | "none")[],
  ) =>
    request<SwLibraryItem>("GET", `/v1/meeting-library/${encodeURIComponent(id)}`, {
      query: { include },
    }),

  workingHours: (q: { date?: string; from?: string; to?: string; timezone: string }) =>
    request<{
      timezone: string;
      days: { date: string; entries: SwWorkingHoursEntry[]; truncated?: boolean }[];
    }>("GET", "/v1/insights/working-hours", { query: q }),

  events: (q: { after?: string; limit?: number; subscriptionId?: string }) =>
    request<{ items: { logId: string; event: SwEventEnvelope }[]; hasMore: boolean }>(
      "GET",
      "/v1/events",
      {
        query: q,
      },
    ),

  subscriptions: () => request<{ webhooks: SwSubscription[] }>("GET", "/v1/subscriptions"),

  /** Inbox-only (no url): drained by polling /v1/events. */
  createInboxSubscription: (events: readonly string[]) =>
    request<SwSubscription>("POST", "/v1/subscriptions", { body: { events } }),

  channels: () =>
    request<{ channels: SwChannel[] }>("GET", "/v1/chat/channels", { query: { limit: 100 } }),

  postToChannel: (channelId: string, text: string) =>
    request<{ id: string }>("POST", `/v1/chat/channels/${encodeURIComponent(channelId)}/messages`, {
      body: { text },
    }),

  /** 1 recipient = their 1:1 conversation; 2–8 = a group DM. */
  sendDm: (userIds: readonly string[], text: string) =>
    request<{ id: string; channel: { id: string } }>("POST", "/v1/chat/dms", {
      body: { userIds, text },
    }),

  gong: (text: string) => request<void>("POST", "/v1/gong", { body: { text } }),

  announcement: (text: string) => request<void>("POST", "/v1/announcement", { body: { text } }),

  createNpc: (body: {
    name?: string;
    location?: { type: "zone"; zoneId: string };
    visible?: boolean | null;
  }) => request<{ id: string }>("POST", "/v1/npcs", { body }),

  patchNpc: (
    id: string,
    body: {
      location?: { type: "zone"; zoneId: string };
      visible?: boolean | null;
      say?: { text: string } | null;
    },
  ) => request<{ id: string }>("PATCH", `/v1/npcs/${encodeURIComponent(id)}`, { body }),
};

/** The five event types the camp subscribes to (FR-ATT-01). */
export const CAMP_EVENT_TYPES = [
  "meeting.started",
  "meeting.ended",
  "meeting.user_joined",
  "meeting.user_left",
  "office.member_presence_updated",
] as const;
