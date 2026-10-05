/**
 * Camp operations — who is who.
 *
 * Three questions, answered once for every screen:
 *   1. Which registry record is this SoWork account? (matchAccounts)
 *   2. Which accounts are probably the same person? (findDuplicatePairs,
 *      registryChecks — Module 2)
 *   3. Which accounts count as ONE person in reports? (mergePersons —
 *      BR-ATT-06: a confirmed duplicate counts once)
 *
 * Nothing here merges or links on its own authority beyond the documented
 * automatic link: every pair goes to the review queue (§5), and an operator's
 * decision always wins over a score.
 */
import { compareTokenLists, levenshtein, nameTokens, toWesternDigits } from "./text.ts";

export type RegistryKind = "participant" | "guider" | "coach";

export type RegistryPerson = {
  id: string;
  kind: RegistryKind;
  name: string;
  teamNo: number | null;
  phone: string | null;
  email: string | null;
};

export type AccountForMatch = {
  swUserId: string;
  coreTokens: string[];
  /** Team number read from the name (suffix or inferred). */
  nameTeamNo: number | null;
  /** Enabler role read from the name. */
  nameRole: string | null;
};

export type LinkDecision =
  { status: "linked"; personId: string } | { status: "not_in_registry" } | { status: "unlinked" };

export type MatchStatus =
  /** Operator linked it. */
  | "manual"
  /** Score at or above the automatic threshold. */
  | "auto"
  /** 80–89, corroborated by the team number or role in the name. */
  | "probable"
  /** 80–89 and nothing corroborates it: offered, not linked. */
  | "candidate"
  /** Below 80, or an operator said so. */
  | "none"
  | "not_in_registry";

export type AccountMatch = {
  status: MatchStatus;
  /** Linked registry record (manual, auto, probable). */
  personId: string | null;
  /** Best candidate even when not linked (for the profile and N10). */
  candidateId: string | null;
  /** Name score of the linked record, else of the best candidate. */
  score: number;
};

export type TokenCache = Map<string, string[]>;

export function registryTokens(people: readonly RegistryPerson[]): TokenCache {
  const cache: TokenCache = new Map();
  for (const person of people) cache.set(person.id, nameTokens(person.name));
  return cache;
}

/**
 * Match accounts to registry records. A team number or role in the account
 * name that agrees with a record breaks ties and lifts an 80–89 score into a
 * link; it never makes a weak name match strong on its own.
 */
export function matchAccounts(
  accounts: readonly AccountForMatch[],
  people: readonly RegistryPerson[],
  decisions: ReadonlyMap<string, LinkDecision>,
  opts: { autoLinkScore: number; noteScore?: number },
): Map<string, AccountMatch> {
  const noteScore = opts.noteScore ?? 80;
  const tokens = registryTokens(people);
  const byId = new Map(people.map((p) => [p.id, p]));
  const out = new Map<string, AccountMatch>();

  for (const account of accounts) {
    const decision = decisions.get(account.swUserId);
    const scored: { person: RegistryPerson; score: number; corroborated: boolean }[] = [];
    if (account.coreTokens.length) {
      for (const person of people) {
        const { score } = compareTokenLists(account.coreTokens, tokens.get(person.id) ?? []);
        if (score < noteScore - 10) continue;
        const corroborated =
          (person.kind === "participant" &&
            account.nameTeamNo !== null &&
            account.nameTeamNo === person.teamNo) ||
          (person.kind !== "participant" && account.nameRole === person.kind);
        scored.push({ person, score, corroborated });
      }
    }
    scored.sort(
      (a, b) => b.score + (b.corroborated ? 3 : 0) - (a.score + (a.corroborated ? 3 : 0)),
    );
    const best = scored[0];
    const second = scored[1];

    if (decision?.status === "linked" && byId.has(decision.personId)) {
      const own = scored.find((s) => s.person.id === decision.personId);
      out.set(account.swUserId, {
        status: "manual",
        personId: decision.personId,
        candidateId: decision.personId,
        score: own?.score ?? 0,
      });
      continue;
    }
    if (decision?.status === "not_in_registry") {
      out.set(account.swUserId, {
        status: "not_in_registry",
        personId: null,
        candidateId: best?.person.id ?? null,
        score: best?.score ?? 0,
      });
      continue;
    }
    if (!best || decision?.status === "unlinked") {
      out.set(account.swUserId, {
        status: "none",
        personId: null,
        candidateId: best?.person.id ?? null,
        score: best?.score ?? 0,
      });
      continue;
    }

    // Two records the account fits equally well, neither corroborated: a
    // coin toss is not a link.
    const ambiguous =
      !!second &&
      second.person.id !== best.person.id &&
      second.score >= best.score - 2 &&
      !best.corroborated;

    let status: MatchStatus;
    if (best.score >= opts.autoLinkScore && !ambiguous) status = "auto";
    else if (best.score >= noteScore && best.corroborated) status = "probable";
    else if (best.score >= noteScore) status = "candidate";
    else status = "none";

    const linked = status === "auto" || status === "probable";
    out.set(account.swUserId, {
      status,
      personId: linked ? best.person.id : null,
      candidateId: best.person.id,
      score: best.score,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persons (BR-ATT-06)
// ---------------------------------------------------------------------------

export type DuplicateDecision = {
  aId: string;
  bId: string;
  decision: "duplicate" | "not_duplicate" | "follow_up";
  primaryId: string | null;
};

export type MergedPerson = {
  /** 'p:<registry id>' when any account is linked, else 'u:<primary account>'. */
  key: string;
  registryId: string | null;
  /** Primary first. */
  accountIds: string[];
};

/**
 * Group accounts into persons: accounts linked to the same registry record,
 * and pairs an operator confirmed as duplicates, are one person. Registry
 * people with no account are persons too (key 'p:<id>', no accounts).
 */
export function mergePersons(
  accountIds: readonly string[],
  matches: ReadonlyMap<string, AccountMatch>,
  decisions: readonly DuplicateDecision[],
  registryIds: readonly string[],
): { persons: MergedPerson[]; personOfAccount: Map<string, string> } {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) ?? root;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const id of accountIds) parent.set(`u:${id}`, `u:${id}`);
  for (const id of registryIds) parent.set(`p:${id}`, `p:${id}`);

  for (const id of accountIds) {
    const personId = matches.get(id)?.personId;
    if (personId && parent.has(`p:${personId}`)) union(`p:${personId}`, `u:${id}`);
  }
  const primaries = new Set<string>();
  for (const d of decisions) {
    if (d.decision !== "duplicate") continue;
    if (!parent.has(`u:${d.aId}`) || !parent.has(`u:${d.bId}`)) continue;
    union(`u:${d.aId}`, `u:${d.bId}`);
    if (d.primaryId) primaries.add(d.primaryId);
  }

  const groups = new Map<string, string[]>();
  for (const node of parent.keys()) {
    const root = find(node);
    const list = groups.get(root) ?? [];
    list.push(node);
    groups.set(root, list);
  }

  const persons: MergedPerson[] = [];
  const personOfAccount = new Map<string, string>();
  for (const members of groups.values()) {
    const registryNode = members.find((m) => m.startsWith("p:"));
    const accounts = members
      .filter((m) => m.startsWith("u:"))
      .map((m) => m.slice(2))
      .sort((a, b) => Number(primaries.has(b)) - Number(primaries.has(a)) || a.localeCompare(b));
    const key = registryNode ?? `u:${accounts[0] ?? ""}`;
    persons.push({
      key,
      registryId: registryNode ? registryNode.slice(2) : null,
      accountIds: accounts,
    });
    for (const account of accounts) personOfAccount.set(account, key);
  }
  return { persons, personOfAccount };
}

// ---------------------------------------------------------------------------
// Duplicate pairs (FR-DUP-01..05)
// ---------------------------------------------------------------------------

export type DuplicateLevel = "confirmed" | "suspected" | "lookalike";

export type PairReason =
  /** Same normalized name, same (or no) suffix. */
  | "same_name"
  /** Both accounts linked to one registry record. */
  | "same_registry"
  /** Same normalized name, different suffix. */
  | "same_name_other_suffix"
  /** One name is the other plus a middle name. */
  | "middle_name"
  /** Score ≥ the suspected threshold. */
  | "score"
  /** Score in the lookalike band. */
  | "lookalike";

export type DuplicatePair = {
  key: string;
  aId: string;
  bId: string;
  score: number;
  level: DuplicateLevel;
  reasons: PairReason[];
};

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export type AccountForDuplicates = {
  swUserId: string;
  coreTokens: string[];
  /** Normalized suffix ("5", "guider", "") — tells "same name" from "same name, other suffix". */
  suffixKey: string;
  registryId: string | null;
};

/**
 * Every pair at or above the lookalike score, plus every pair sharing a
 * registry record, classified by the detection levels of §5. O(n²) over the
 * office's accounts (~150–300): a few tens of thousands of comparisons.
 */
export function findDuplicatePairs(
  accounts: readonly AccountForDuplicates[],
  opts: { suspectedScore: number; lookalikeScore: number },
): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < accounts.length; i += 1) {
    const a = accounts[i]!;
    for (let j = i + 1; j < accounts.length; j += 1) {
      const b = accounts[j]!;
      const reasons: PairReason[] = [];
      const sameRegistry = !!a.registryId && a.registryId === b.registryId;
      if (sameRegistry) reasons.push("same_registry");

      let score = 0;
      let plusMiddle = false;
      if (a.coreTokens.length && b.coreTokens.length) {
        const sameName = a.coreTokens.join(" ") === b.coreTokens.join(" ");
        if (sameName) {
          score = 100;
          reasons.push(
            a.suffixKey === b.suffixKey || !a.suffixKey || !b.suffixKey
              ? "same_name"
              : "same_name_other_suffix",
          );
        } else {
          const cmp = compareTokenLists(a.coreTokens, b.coreTokens);
          score = cmp.score;
          plusMiddle = cmp.plusMiddleName;
          if (plusMiddle) reasons.push("middle_name");
          if (score >= opts.suspectedScore) reasons.push("score");
          else if (score >= opts.lookalikeScore) reasons.push("lookalike");
        }
      }
      if (!reasons.length) continue;

      let level: DuplicateLevel;
      if (reasons.includes("same_registry") || reasons.includes("same_name")) level = "confirmed";
      else if (
        reasons.includes("same_name_other_suffix") ||
        reasons.includes("middle_name") ||
        reasons.includes("score")
      ) {
        level = "suspected";
      } else level = "lookalike";

      const [aId, bId] =
        a.swUserId < b.swUserId ? [a.swUserId, b.swUserId] : [b.swUserId, a.swUserId];
      pairs.push({
        key: pairKey(aId, bId),
        aId,
        bId,
        score: sameRegistry && !score ? 100 : score,
        level,
        reasons,
      });
    }
  }
  const rank: Record<DuplicateLevel, number> = { confirmed: 0, suspected: 1, lookalike: 2 };
  return pairs.sort((x, y) => rank[x.level] - rank[y.level] || y.score - x.score);
}

// ---------------------------------------------------------------------------
// Registry checks (FR-DUP-04) and phone/email hygiene (FR-IMP-03)
// ---------------------------------------------------------------------------

/** Digits only, Saudi international prefixes folded to the local 0. */
export function normalizePhone(value: string | null | undefined): string {
  if (!value) return "";
  let digits = toWesternDigits(String(value)).replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `0${digits.slice(5)}`;
  else if (digits.startsWith("966") && digits.length === 12) digits = `0${digits.slice(3)}`;
  else if (digits.length === 9 && digits.startsWith("5")) digits = `0${digits}`;
  return digits;
}

/** FR-IMP-03: 10 digits starting 05. */
export function isValidSaudiMobile(value: string | null | undefined): boolean {
  return /^05\d{8}$/.test(normalizePhone(value));
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export type RegistryCheckKind =
  "same_phone" | "same_email" | "similar_email" | "two_teams" | "guider_and_coach";

export type RegistryCheck = {
  kind: RegistryCheckKind;
  personIds: string[];
  /** The shared or near value, for display. */
  value: string;
};

export function registryChecks(people: readonly RegistryPerson[]): RegistryCheck[] {
  const out: RegistryCheck[] = [];
  const group = (key: (p: RegistryPerson) => string, kind: RegistryCheckKind) => {
    const map = new Map<string, string[]>();
    for (const p of people) {
      const k = key(p);
      if (!k) continue;
      const list = map.get(k) ?? [];
      list.push(p.id);
      map.set(k, list);
    }
    for (const [value, ids] of map) if (ids.length > 1) out.push({ kind, personIds: ids, value });
  };
  group((p) => normalizePhone(p.phone), "same_phone");
  group((p) => normalizeEmail(p.email), "same_email");

  const withEmail = people.filter((p) => normalizeEmail(p.email));
  for (let i = 0; i < withEmail.length; i += 1) {
    for (let j = i + 1; j < withEmail.length; j += 1) {
      const a = normalizeEmail(withEmail[i]!.email);
      const b = normalizeEmail(withEmail[j]!.email);
      if (a === b || Math.abs(a.length - b.length) > 2) continue;
      const distance = levenshtein(a, b);
      if (distance >= 1 && distance <= 2) {
        out.push({
          kind: "similar_email",
          personIds: [withEmail[i]!.id, withEmail[j]!.id],
          value: `${a} / ${b}`,
        });
      }
    }
  }

  const participants = people.filter((p) => p.kind === "participant");
  const byName = new Map<string, RegistryPerson[]>();
  for (const p of participants) {
    const key = nameTokens(p.name).join(" ");
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  for (const [name, list] of byName) {
    const teams = new Set(list.map((p) => p.teamNo));
    if (teams.size > 1)
      out.push({ kind: "two_teams", personIds: list.map((p) => p.id), value: name });
  }

  const guiders = people.filter((p) => p.kind === "guider");
  const coaches = people.filter((p) => p.kind === "coach");
  for (const g of guiders) {
    const gt = nameTokens(g.name);
    for (const c of coaches) {
      if (compareTokenLists(gt, nameTokens(c.name)).score >= 90) {
        out.push({ kind: "guider_and_coach", personIds: [g.id, c.id], value: g.name });
      }
    }
  }
  return out;
}
