/**
 * Camp operations — linking meeting-library items to meetings (Module 5).
 *
 * Library items carry no meeting id (§2). The document's rule is "same topic,
 * started within 2 minutes" (FR-REC-01); live data showed it does not hold.
 * Most meetings have NO topic while their library item gets a generated one,
 * and an item starts when recording or notes start, not when the meeting
 * does: 187 s, 364 s and 28 minutes after the meeting on day 1, with the same
 * topic and the same people. So:
 *
 *   gate      the item starts inside the meeting, give or take `window`
 *             (setting, default 180 s)
 *   strong    the item and the meeting share at least half of the larger
 *             participant list, or the topics are equal and non-empty
 *   score     participant overlap, then how much of the item lies inside the
 *             meeting, then the topic
 *
 * Exactly one strong candidate → linked. Two or more → غير مؤكد (FR-REC-07)
 * and an operator chooses. None → keep retrying until `retryMinutes` after the
 * meeting ended, then "no library item" (FR-REC-06).
 */
import { normalizeArabicLetters } from "./text.ts";

export type LibraryItemLite = {
  id: string;
  topic: string | null;
  startedAt: number;
  endedAt: number | null;
  participantIds: string[];
};

export type MeetingLite = {
  id: string;
  topic: string | null;
  startedAt: number;
  endedAt: number | null;
  accountIds: string[];
};

export type LibraryCandidate = {
  itemId: string;
  score: number;
  overlap: number;
  deltaSeconds: number;
  topicMatch: boolean;
  /** For the operator choosing between candidates (FR-REC-07). */
  topic: string | null;
  startedAt: number;
};

const normTopic = (t: string | null) =>
  t ? normalizeArabicLetters(t).toLowerCase().replace(/\s+/g, " ").trim() : "";

export function libraryCandidates(
  meeting: MeetingLite,
  items: readonly LibraryItemLite[],
  windowSeconds: number,
): LibraryCandidate[] {
  const accounts = new Set(meeting.accountIds);
  const topic = normTopic(meeting.topic);
  const out: LibraryCandidate[] = [];
  const windowMs = windowSeconds * 1000;
  const meetingEnd = meeting.endedAt ?? Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.startedAt < meeting.startedAt - windowMs || item.startedAt > meetingEnd + windowMs)
      continue;
    const delta = Math.abs(item.startedAt - meeting.startedAt) / 1000;
    const itemIds = new Set(item.participantIds);
    const shared = [...itemIds].filter((id) => accounts.has(id)).length;
    // Symmetric: shared over the LARGER side. Relative to the meeting alone, a
    // 2-person side chat that starts beside a 50-person workshop "fully
    // overlaps" the workshop's library item.
    const larger = Math.max(accounts.size, itemIds.size);
    const overlap = larger ? shared / larger : 0;
    const topicMatch = !!topic && topic === normTopic(item.topic);
    if (overlap < 0.5 && !topicMatch) continue;
    // Share of the item's own span that falls inside the meeting (1 while open).
    const itemEnd = item.endedAt ?? item.startedAt;
    const inside =
      itemEnd > item.startedAt
        ? Math.max(0, Math.min(itemEnd, meetingEnd) - Math.max(item.startedAt, meeting.startedAt)) /
          (itemEnd - item.startedAt)
        : 1;
    const score = overlap * 0.6 + inside * 0.3 + (topicMatch ? 0.1 : 0);
    out.push({
      itemId: item.id,
      score: Math.round(score * 1000) / 1000,
      overlap,
      deltaSeconds: Math.round(delta),
      topicMatch,
      topic: item.topic,
      startedAt: item.startedAt,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export type LibraryDecision =
  | { status: "linked"; itemId: string; candidates: LibraryCandidate[] }
  | { status: "uncertain"; candidates: LibraryCandidate[] }
  | { status: "pending"; candidates: [] }
  | { status: "none"; candidates: [] };

export function decideLibrary(
  meeting: MeetingLite,
  items: readonly LibraryItemLite[],
  opts: { windowSeconds: number; retryMinutes: number; now: number },
  /** Library items already linked to OTHER meetings. */
  taken: ReadonlySet<string>,
): LibraryDecision {
  const candidates = libraryCandidates(meeting, items, opts.windowSeconds).filter(
    (c) => !taken.has(c.itemId),
  );
  if (candidates.length === 1)
    return { status: "linked", itemId: candidates[0]!.itemId, candidates };
  if (candidates.length > 1) {
    const [first, second] = candidates;
    // A clear winner (full overlap against partial) is not a real tie.
    if (
      first &&
      second &&
      first.overlap >= 0.9 &&
      second.overlap < 0.6 &&
      first.score - second.score >= 0.2
    ) {
      return { status: "linked", itemId: first.itemId, candidates };
    }
    return { status: "uncertain", candidates };
  }
  const ended = meeting.endedAt ?? opts.now;
  if (opts.now - ended < opts.retryMinutes * 60_000) return { status: "pending", candidates: [] };
  return { status: "none", candidates: [] };
}
