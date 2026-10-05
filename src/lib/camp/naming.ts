/**
 * Camp operations — display-name parsing and the naming checks (Module 3).
 *
 * Every display name must read "full name - suffix": the team number for a
 * participant, the role label for an enabler. This file splits a name
 * (FR-NAM-01), classifies its suffix, infers an event role from it
 * (BR-USR-02), and runs the N01–N13 checks (FR-NAM-02). The registry-dependent
 * checks (N06, N08, N10, N11) take the match as an input.
 *
 * Real names from the office shaped several rules here, beyond the document:
 * a team number typed BEFORE the name ("03-RAFIF …", "14-مهند"), a spaced
 * tatweel used as a dash ("غدير الرشيدي ـ 7"), a whole name in brackets, and
 * "Al-" / "ال-" family prefixes that are part of the name, not a separator.
 */
import type { EnablerRole, EventRole } from "./settings.ts";
import {
  hasArabic,
  hasLatin,
  nameTokens,
  normalizeArabicLetters,
  stripHonorifics,
  toWesternDigits,
} from "./text.ts";

export type NamingCode =
  | "N01"
  | "N02"
  | "N03"
  | "N04"
  | "N05"
  | "N06"
  | "N07"
  | "N08"
  | "N09"
  | "N10"
  | "N11"
  | "N12"
  | "N13";

/** N01–N09 make an account مخالف; N10–N13 only ملاحظة (section 6). */
export const VIOLATION_CODES: ReadonlySet<NamingCode> = new Set([
  "N01",
  "N02",
  "N03",
  "N04",
  "N05",
  "N06",
  "N07",
  "N08",
  "N09",
]);

export type NamingStatus = "ok" | "note" | "violation";

export type SuffixKind = "team" | "team_words" | "role" | "unknown" | "empty" | "none";

export type ParsedName = {
  /** As SoWork shows it. */
  raw: string;
  /** The name part (before the suffix), honorifics kept. */
  namePart: string;
  /** The suffix as typed, trimmed; "" when there is none. */
  suffix: string;
  suffixKind: SuffixKind;
  /** Separator used: "-" (correct), another listed one (N02), or null (N01). */
  separator: string | null;
  teamNo: number | null;
  role: EnablerRole | null;
  /** A hyphen inside the name part, e.g. "Al-Maliki" (N13). */
  internalHyphen: boolean;
  /** Team or role found somewhere other than a proper suffix (prefix, no separator). */
  inferredTeamNo: number | null;
  inferredRole: EnablerRole | null;
  /** Tokens identifying the PERSON (no suffix, labels, digits, honorifics). */
  coreTokens: string[];
  /** The person part as typed (original spelling), for suggesting a name. */
  personText: string;
};

export type RoleLabelIndex = {
  /** normalized label → role */
  byLabel: Map<string, EnablerRole>;
  /** labels sorted longest first, for phrase search */
  phrases: { label: string; role: EnablerRole }[];
};

function normalizeLabel(value: string): string {
  return normalizeArabicLetters(toWesternDigits(value))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRoleLabelIndex(labels: Record<EnablerRole, string[]>): RoleLabelIndex {
  const byLabel = new Map<string, EnablerRole>();
  for (const [role, list] of Object.entries(labels) as [EnablerRole, string[]][]) {
    for (const label of list) {
      const key = normalizeLabel(label);
      if (key && !byLabel.has(key)) byLabel.set(key, role);
    }
  }
  const phrases = [...byLabel.entries()]
    .map(([label, role]) => ({ label, role }))
    .sort((a, b) => b.label.length - a.label.length);
  return { byLabel, phrases };
}

const HYPHENS = new Set(["-", "‐", "‑", "−", "﹣", "－"]);
/** N02's list: – — _ / | ، plus look-alikes people type. */
const OTHER_SEPARATORS = new Set(["–", "—", "_", "/", "|", "،", "‒", "―", "｜", "\\"]);
const TEAM_WORDS =
  /^(?:فريق|الفريق|ف|team|t|tm|group|g)\s*\.?\s*#?\s*(\d{1,3})$|^(\d{1,3})\s*(?:فريق|team)$/i;
const DIGITS_ONLY = /^\d{1,3}$/;

function stripBrackets(value: string): string {
  let out = value.trim();
  for (let guard = 0; guard < 3; guard += 1) {
    const m = /^[([{«"'](.*)[)\]}»"']$/s.exec(out);
    if (!m) break;
    out = (m[1] ?? "").trim();
  }
  return out;
}

function classifySuffix(
  suffix: string,
  roles: RoleLabelIndex,
): { kind: SuffixKind; teamNo: number | null; role: EnablerRole | null } {
  const s = toWesternDigits(suffix)
    .replace(/[()[\]{}]/g, "")
    .trim();
  if (!s) return { kind: "empty", teamNo: null, role: null };
  const compact = s.replace(/\s+/g, " ");
  if (DIGITS_ONLY.test(compact.replace(/\s/g, ""))) {
    return { kind: "team", teamNo: Number(compact.replace(/\s/g, "")), role: null };
  }
  const words = TEAM_WORDS.exec(normalizeLabel(compact));
  if (words) return { kind: "team_words", teamNo: Number(words[1] ?? words[2]), role: null };
  const role = roles.byLabel.get(normalizeLabel(compact));
  if (role) return { kind: "role", teamNo: null, role };
  // Digits mixed with words that are not a team phrase ("اثر7", "T5a").
  const digits = /(\d{1,3})/.exec(compact);
  if (digits) return { kind: "team_words", teamNo: Number(digits[1]), role: null };
  return { kind: "unknown", teamNo: null, role: null };
}

/** The word immediately right of index `i` (to the next space). */
function wordAfter(value: string, i: number): string {
  const m = /^[^\s]+/.exec(value.slice(i + 1));
  return m ? m[0] : "";
}

/** The word immediately left of index `i`. */
function wordBefore(value: string, i: number): string {
  const m = /[^\s]+$/.exec(value.slice(0, i));
  return m ? m[0] : "";
}

/**
 * Is the hyphen at `i` part of the name (Al-Maliki, ال-شمري, Abdul-Rahman)
 * rather than the name/suffix separator?
 */
function isInternalHyphen(value: string, i: number, roles: RoleLabelIndex): boolean {
  const left = value[i - 1] ?? "";
  const right = value[i + 1] ?? "";
  const before = wordBefore(value, i).toLowerCase();
  if (/^(al|el|ال)$/.test(normalizeArabicLetters(before))) return true;
  // A separator has space on at least one side, or digits after it.
  if (/\s/.test(left) || /\s/.test(right)) return false;
  if (!/\p{L}/u.test(left) || !/\p{L}/u.test(right)) return false;
  const after = wordAfter(value, i);
  const rest = value.slice(i + 1).trim();
  if (classifySuffix(rest, roles).kind !== "unknown") return false;
  if (roles.byLabel.has(normalizeLabel(after))) return false;
  return true;
}

/** Remove role phrases, team phrases and digits; what is left names the person. */
function coreTokensOf(text: string, roles: RoleLabelIndex): string[] {
  let s = ` ${normalizeLabel(text)} `;
  for (const { label } of roles.phrases) {
    s = s.split(` ${label} `).join(" ");
  }
  s = s.replace(/\s(?:فريق|الفريق|team)\s/g, " ");
  return nameTokens(s);
}

/**
 * Split and classify a display name (FR-NAM-01). Never throws; a name with
 * nothing usable yields empty parts and is reported by the checks.
 */
export function parseDisplayName(
  raw: string,
  roles: RoleLabelIndex,
  honorifics: readonly string[],
): ParsedName {
  const original = raw ?? "";
  const s = stripBrackets(toWesternDigits(original.normalize("NFC")).replace(/\s+/g, " "));

  // The split hyphen is the LAST hyphen that is not part of the name.
  let split = -1;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    if (HYPHENS.has(s[i] ?? "") && !isInternalHyphen(s, i, roles)) {
      split = i;
      break;
    }
  }

  let separator: string | null = null;
  let namePart = s;
  let suffix = "";
  if (split >= 0) {
    separator = "-";
    namePart = s.slice(0, split).trim();
    suffix = s.slice(split + 1).trim();
  } else {
    // No hyphen: look for one of N02's separators (a spaced tatweel counts —
    // "غدير الرشيدي ـ 7" — while a tatweel INSIDE a word is just stretching).
    for (let i = s.length - 1; i >= 0; i -= 1) {
      const ch = s[i] ?? "";
      const spacedTatweel = ch === "ـ" && /\s/.test(s[i - 1] ?? " ") && /\s/.test(s[i + 1] ?? " ");
      if (OTHER_SEPARATORS.has(ch) || spacedTatweel) {
        separator = ch;
        namePart = s.slice(0, i).trim();
        suffix = s.slice(i + 1).trim();
        break;
      }
    }
  }

  const classified = separator
    ? classifySuffix(suffix, roles)
    : { kind: "none" as SuffixKind, teamNo: null, role: null };

  // Inference for BR-USR-02 when the suffix is not where it belongs.
  let inferredTeamNo: number | null = null;
  let inferredRole: EnablerRole | null = null;
  let personText = namePart;
  if (separator) {
    const reversed = classifySuffix(namePart, roles);
    if (
      (reversed.kind === "team" || reversed.kind === "team_words") &&
      classified.kind === "unknown"
    ) {
      // "03-RAFIF SUHAIL" / "فريق 25-فيصل": the suffix came first.
      inferredTeamNo = reversed.teamNo;
      personText = suffix;
    } else if (reversed.kind === "role" && classified.kind === "unknown") {
      inferredRole = reversed.role;
      personText = suffix;
    } else if (coreTokensOf(namePart, roles).length === 0) {
      // Nothing on the left names anyone ("-26ريمماس سالم", "-27"): whatever
      // identifies the person is on the right, digits and all.
      personText = suffix;
    }
  } else {
    const trailingDigits = /(?:^|\s)(\d{1,3})\s*$/.exec(s);
    const leadingDigits = /^\s*(\d{1,3})(?:\s|$)/.exec(s);
    if (trailingDigits) inferredTeamNo = Number(trailingDigits[1]);
    else if (leadingDigits) inferredTeamNo = Number(leadingDigits[1]);
    const norm = ` ${normalizeLabel(s)} `;
    for (const { label, role } of roles.phrases) {
      if (norm.endsWith(` ${label} `)) {
        inferredRole = role;
        break;
      }
    }
  }

  // Parenthesised notes inside the name ("(Misk)", "(GPH)") are not the name.
  const coreSource = stripHonorifics(personText, honorifics).replace(/\([^)]*\)/g, " ");
  const coreTokens = coreTokensOf(coreSource, roles);

  return {
    raw: original,
    namePart,
    suffix,
    suffixKind: classified.kind,
    separator,
    teamNo: classified.teamNo,
    role: classified.role,
    internalHyphen: [...namePart].some((ch) => HYPHENS.has(ch)),
    inferredTeamNo,
    inferredRole,
    coreTokens,
    personText: displayPersonText(personText, roles),
  };
}

/** The person part with labels, team phrases, digits and brackets removed, spelling kept. */
function displayPersonText(text: string, roles: RoleLabelIndex): string {
  const cleaned = toWesternDigits(text)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[-\u2010-\u2015_/|،,+()[\]{}]/g, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const normalized = tokens.map(normalizeLabel);
  const drop = tokens.map(() => false);
  // Labels are compared in normalized space (مرشدة ≡ مرشده), tokens kept as typed.
  for (const { label } of roles.phrases) {
    const parts = label.split(" ");
    for (let i = 0; i + parts.length <= tokens.length; i += 1) {
      if (parts.every((part, k) => normalized[i + k] === part)) {
        for (let k = 0; k < parts.length; k += 1) drop[i + k] = true;
      }
    }
  }
  return tokens
    .filter((_, i) => !drop[i] && !/^(?:فريق|الفريق|team)$/.test(normalized[i] ?? ""))
    .map((token) => token.replace(/\d+/g, ""))
    .filter(Boolean)
    .join(" ");
}

/** Event role and team read from the name alone (BR-USR-02, no registry). */
export function roleFromName(
  parsed: ParsedName,
  teamCount: number,
): { role: EventRole; teamNo: number | null } {
  const team = parsed.teamNo ?? parsed.inferredTeamNo;
  if (parsed.role) return { role: parsed.role, teamNo: null };
  if (team !== null && team >= 1 && team <= teamCount) return { role: "participant", teamNo: team };
  if (parsed.inferredRole) return { role: parsed.inferredRole, teamNo: null };
  return { role: "unknown", teamNo: null };
}

export type RegistryContext = {
  /** The registry record this account is linked to, if any. */
  person: { kind: "participant" | "guider" | "coach"; teamNo: number | null } | null;
  /** Best name score against the registry (0–100), linked or not. */
  bestScore: number;
};

export type NamingResult = {
  status: NamingStatus;
  issues: NamingCode[];
};

const REGISTRY_ROLE: Record<"guider" | "coach", EnablerRole> = { guider: "guider", coach: "coach" };

/** Roles with no list in the registry: N11 cannot apply to them (§1 glossary). */
const UNLISTED_ROLES: ReadonlySet<EnablerRole> = new Set(["expert", "speaker", "supervisor"]);

/**
 * Run N01–N13 (FR-NAM-02). Order of `issues` is the code order, so the list
 * reads the same everywhere it is shown.
 */
export function checkNaming(
  parsed: ParsedName,
  registry: RegistryContext,
  opts: { teamCount: number; honorifics: readonly string[] },
): NamingResult {
  const issues = new Set<NamingCode>();

  if (parsed.separator === null) issues.add("N01");
  else if (parsed.separator !== "-") issues.add("N02");

  if (parsed.separator !== null) {
    if (parsed.suffixKind === "empty") issues.add("N03");
    if (parsed.suffixKind === "team_words") issues.add("N04");
    if (parsed.suffixKind === "unknown") issues.add("N07");
  }

  const team = parsed.teamNo;
  if (team !== null && (parsed.suffixKind === "team" || parsed.suffixKind === "team_words")) {
    if (team < 1 || team > opts.teamCount) issues.add("N05");
  }

  const person = registry.person;
  if (person) {
    if (person.kind === "participant") {
      if (parsed.role) issues.add("N08");
      else if (team !== null && person.teamNo !== null && team !== person.teamNo) issues.add("N06");
    } else {
      const expected = REGISTRY_ROLE[person.kind];
      if (parsed.role && parsed.role !== expected) issues.add("N08");
      if (!parsed.role && team !== null) issues.add("N08");
    }
  }

  const nameWords = nameTokens(stripHonorifics(parsed.namePart, opts.honorifics));
  if (nameWords.length < 2) issues.add("N09");

  if (person) {
    if (registry.bestScore < 90) issues.add("N10");
  } else if (registry.bestScore >= 80 && registry.bestScore < 90) {
    issues.add("N10");
  } else if (registry.bestScore < 80) {
    const role = parsed.role ?? parsed.inferredRole;
    if (!role || !UNLISTED_ROLES.has(role)) issues.add("N11");
  }

  const namePart = stripHonorifics(parsed.namePart, opts.honorifics);
  if (hasArabic(namePart) && hasLatin(namePart)) issues.add("N12");
  if (parsed.internalHyphen) issues.add("N13");

  const sorted = [...issues].sort();
  const status: NamingStatus = sorted.some((code) => VIOLATION_CODES.has(code))
    ? "violation"
    : sorted.length
      ? "note"
      : "ok";
  return { status, issues: sorted };
}

/**
 * FR-NAM-04: registered name, in the script the person used, + " - " + the
 * team number (participants) or the role label (enablers). Feminine label when
 * the account already used one.
 */
export function suggestName(
  registeredName: string,
  role: EventRole,
  teamNo: number | null,
  labels: Record<EnablerRole, string[]>,
  usedLabel?: string,
): string | null {
  const name = registeredName.replace(/\s+/g, " ").trim();
  if (!name) return null;
  if (role === "participant") return teamNo ? `${name} - ${teamNo}` : null;
  if (role === "unknown") return null;
  const list = labels[role] ?? [];
  const arabicName = hasArabic(name);
  const pool = list.filter((label) => (arabicName ? hasArabic(label) : !hasArabic(label)));
  const used = usedLabel ? normalizeLabel(usedLabel) : "";
  const label = pool.find((l) => normalizeLabel(l) === used) ?? pool[0] ?? list[0];
  return label ? `${name} - ${label}` : null;
}
