/**
 * Camp operations — assertion pack for the pure domain logic.
 *
 *   node scripts/qa/camp-logic.ts        (npm run check:camp)
 *
 * Node runs the TypeScript directly (type stripping), which is why every file
 * under src/lib/camp/ that this imports uses relative `.ts` specifiers and no
 * `@/` alias. Names below are synthetic: never paste real registry or SoWork
 * data into this file.
 */
import { classifySession, roundTeams } from "../../src/lib/camp/agenda.ts";
import {
  absentTwoDays,
  guiderCoverage,
  mergeIntervals,
  overlapMs,
  placeMeetings,
  scoreCell,
  type AttendanceContext,
  type AttPerson,
  type AttSession,
  type Iv,
  type Room,
} from "../../src/lib/camp/attendance.ts";
import { parseAgenda, parseRegistry, diffRecords } from "../../src/lib/camp/import-parse.ts";
import {
  findDuplicatePairs,
  isValidSaudiMobile,
  matchAccounts,
  mergePersons,
  normalizePhone,
  registryChecks,
} from "../../src/lib/camp/match.ts";
import {
  buildRoleLabelIndex,
  checkNaming,
  parseDisplayName,
  suggestName,
  roleFromName,
} from "../../src/lib/camp/naming.ts";
import { decideLibrary } from "../../src/lib/camp/recordings.ts";
import {
  DEFAULT_ROLE_LABELS,
  parseCampSettingsPatch,
  resolveCampSettings,
} from "../../src/lib/camp/settings.ts";
import {
  compareNames,
  DEFAULT_HONORIFICS,
  formatClockAr,
  formatDateAr,
  fromRiyadh,
  nameTokens,
  riyadhHHMM,
} from "../../src/lib/camp/text.ts";

let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passed += 1;
  else failures.push(`${label}${detail === undefined ? "" : ` — got ${JSON.stringify(detail)}`}`);
}
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), actual);

// --- text -----------------------------------------------------------------
eq("tokens: عبد الله joins", nameTokens("عبد الله السالم"), ["عبدالله", "السالم"]);
eq("tokens: hamza/ta marbuta/alef-maqsura", nameTokens("أحمد إبراهيم آل فلان ليلى فاطمة"), [
  "احمد",
  "ابراهيم",
  "الفلان",
  "ليلي",
  "فاطمه",
]);
eq("tokens: diacritics + tatweel", nameTokens("مُحـــمّد"), ["محمد"]);
eq("tokens: digits split and dropped", nameTokens("-26سارة علي"), ["ساره", "علي"]);
eq("tokens: abd al rahman", nameTokens("Abd Al Rahman Test"), ["abdulrahman", "test"]);
check(
  "romanize: Mohammed Alqahtani = محمد القحطاني",
  compareNames("Mohammed Alqahtani", "محمد القحطاني").score >= 90,
  compareNames("Mohammed Alqahtani", "محمد القحطاني"),
);
check(
  "romanize: Muhammad = Mohammad",
  compareNames("Muhammad Testani", "Mohammad Testani").score >= 95,
);
check(
  "romanize: Abdul Aziz = Abdulaziz",
  compareNames("Abdul Aziz Testi", "Abdulaziz Testi").score >= 95,
);
check(
  "romanize: Khalid ≠ خلود",
  compareNames("Khalid Testi", "خلود التستي").score < 80,
  compareNames("Khalid Testi", "خلود التستي"),
);
const middle = compareNames("سارة التستي", "سارة محمد التستي");
check("middle name is suspected", middle.plusMiddleName && middle.score >= 90, middle);
check("one-word names never auto-link", compareNames("سارة", "سارة التستي").score <= 70);
eq("time: 17:30 → مساءً", formatClockAr(17, 30), "5:30 مساءً");
eq("time: 13:45 → ظهرًا", formatClockAr(13, 45), "1:45 ظهرًا");
eq("time: 15:00 → مساءً", formatClockAr(15, 0), "3:00 مساءً");
eq("date: Arabic month", formatDateAr("2026-10-05"), "5 أكتوبر 2026");
eq("riyadh: 20:30 wall round-trips", riyadhHHMM(fromRiyadh("2026-10-05", "20:30")), "20:30");
eq("riyadh: is UTC+3", fromRiyadh("2026-10-05", "20:30").toISOString(), "2026-10-05T17:30:00.000Z");

// --- naming ----------------------------------------------------------------
const roles = buildRoleLabelIndex(DEFAULT_ROLE_LABELS);
const hon = DEFAULT_HONORIFICS;
const noReg = { person: null, bestScore: 95 };
function codes(name: string, reg: Parameters<typeof checkNaming>[1] = noReg) {
  return checkNaming(parseDisplayName(name, roles, hon), reg, { teamCount: 29, honorifics: hon });
}
eq("N-ok: سارة التستي - 5", codes("سارة التستي - 5"), { status: "ok", issues: [] });
eq("N-ok: Arabic-Indic digit, no spaces", codes("سارة التستي-٥"), { status: "ok", issues: [] });
eq("N-ok: feminine role label", codes("نورة التستي - مرشدة").status, "ok");
eq("N-ok: English label any case", codes("Sara Testi - GUIDER").status, "ok");
eq("N-ok: honorific ignored", codes("د. خالد التستي - خبير").status, "ok");
eq("N01 no hyphen", codes("سارة التستي").issues, ["N01"]);
eq("N02 other separator", codes("سارة التستي _ 5").issues, ["N02"]);
eq("N02 spaced tatweel", codes("سارة التستي ـ 5").issues, ["N02"]);
eq("N03 nothing after hyphen", codes("سارة التستي -").issues, ["N03"]);
eq("N04 words in suffix", codes("سارة التستي - فريق 5").issues, ["N04"]);
eq("N04 T5", codes("Sara Testi - T5").issues, ["N04"]);
eq("N05 out of range", codes("سارة التستي - 31").issues, ["N05"]);
eq(
  "N06 team differs",
  codes("سارة التستي - 7", { person: { kind: "participant", teamNo: 5 }, bestScore: 95 }).issues,
  ["N06"],
);
eq("N07 unknown label", codes("سارة التستي - منسقة").issues, ["N07"]);
eq(
  "N08 guider labelled coach",
  codes("سارة التستي - مدربة", { person: { kind: "guider", teamNo: null }, bestScore: 95 }).issues,
  ["N08"],
);
eq("N09 one word", codes("سارة - 5").issues, ["N09"]);
eq("N10 near registry", codes("سارة التستي - 5", { person: null, bestScore: 85 }).issues, ["N10"]);
eq("N11 not in registry", codes("سارة التستي - 5", { person: null, bestScore: 40 }).issues, [
  "N11",
]);
eq(
  "N11 skipped for experts",
  codes("سارة التستي - خبيرة", { person: null, bestScore: 40 }).issues,
  [],
);
eq("N12 mixed script", codes("Sara التستي - 5").issues, ["N12"]);
eq("N13 Al-Testi", codes("Sara Al-Testi - 5").issues, ["N13"]);
const reversed = parseDisplayName("03-SARA TESTI", roles, hon);
eq("reversed: team inferred", roleFromName(reversed, 29), { role: "participant", teamNo: 3 });
eq("reversed: core is the name", reversed.coreTokens, ["sara", "testi"]);
eq("bracketed whole name", codes("( سارة التستي - 10 )").status, "ok");
eq(
  "suggest: participant",
  suggestName("سارة محمد التستي", "participant", 5, DEFAULT_ROLE_LABELS),
  "سارة محمد التستي - 5",
);
eq(
  "suggest: English guider",
  suggestName("Sara Testi", "guider", null, DEFAULT_ROLE_LABELS),
  "Sara Testi - Guider",
);
eq(
  "suggest: keeps feminine",
  suggestName("نورة التستي", "guider", null, DEFAULT_ROLE_LABELS, "مرشدة"),
  "نورة التستي - مرشدة",
);

// --- matching and duplicates ---------------------------------------------------
const registry = [
  {
    id: "r1",
    kind: "participant" as const,
    name: "سارة محمد التستي",
    teamNo: 5,
    phone: "0501111111",
    email: "sara@example.com",
  },
  {
    id: "r2",
    kind: "participant" as const,
    name: "نورة علي التستي",
    teamNo: 5,
    phone: "0501111111",
    email: "sarah@example.com",
  },
  {
    id: "r3",
    kind: "guider" as const,
    name: "خالد سعد المثالي",
    teamNo: null,
    phone: "0502222222",
    email: null,
  },
  {
    id: "r4",
    kind: "coach" as const,
    name: "خالد سعد المثالي",
    teamNo: null,
    phone: null,
    email: null,
  },
  {
    id: "r5",
    kind: "participant" as const,
    name: "Fahad Exampli",
    teamNo: 9,
    phone: "966503333333",
    email: null,
  },
];
const acct = (id: string, name: string) => {
  const p = parseDisplayName(name, roles, hon);
  const r = roleFromName(p, 29);
  return {
    swUserId: id,
    coreTokens: p.coreTokens,
    nameTeamNo: r.teamNo,
    nameRole: p.role,
    suffixKey: String(p.teamNo ?? p.role ?? ""),
  };
};
const accounts = [
  acct("a1", "سارة التستي - 5"),
  acct("a2", "Sara Altesti - 5"),
  acct("a3", "خالد المثالي - مرشد"),
  acct("a4", "فهد اكزامبلي - 9"),
  acct("a5", "منيرة غيرموجودة - 12"),
];
const matches = matchAccounts(accounts, registry, new Map(), { autoLinkScore: 90 });
eq("match: Arabic display → registry", matches.get("a1")?.personId, "r1");
eq("match: guider by role suffix", matches.get("a3")?.personId, "r3");
eq("match: not in registry", matches.get("a5")?.status, "none");
const manual = matchAccounts(
  accounts,
  registry,
  new Map([["a5", { status: "linked" as const, personId: "r2" }]]),
  { autoLinkScore: 90 },
);
eq("match: manual wins", manual.get("a5")?.status, "manual");
const merged = mergePersons(
  ["a1", "a2", "a3"],
  new Map([
    ["a1", { status: "auto" as const, personId: "r1", candidateId: "r1", score: 95 }],
    ["a2", { status: "none" as const, personId: null, candidateId: null, score: 0 }],
  ]),
  [{ aId: "a1", bId: "a2", decision: "duplicate", primaryId: "a1" }],
  ["r1", "r2"],
);
eq("persons: duplicate merged under registry", merged.personOfAccount.get("a2"), "p:r1");
eq(
  "persons: registry person without account",
  merged.persons.some((p) => p.key === "p:r2" && p.accountIds.length === 0),
  true,
);
const pairs = findDuplicatePairs(
  [
    { swUserId: "x1", coreTokens: nameTokens("سارة التستي"), suffixKey: "5", registryId: null },
    { swUserId: "x2", coreTokens: nameTokens("سارة التستي"), suffixKey: "5", registryId: null },
    { swUserId: "x3", coreTokens: nameTokens("سارة التستي"), suffixKey: "8", registryId: null },
    { swUserId: "x4", coreTokens: nameTokens("Sara Altesti"), suffixKey: "5", registryId: null },
    { swUserId: "x5", coreTokens: nameTokens("فهد المثالي"), suffixKey: "", registryId: "r9" },
    { swUserId: "x6", coreTokens: nameTokens("Fahad"), suffixKey: "", registryId: "r9" },
  ],
  { suspectedScore: 90, lookalikeScore: 80 },
);
const level = (a: string, b: string) =>
  pairs.find((p) => p.key === (a < b ? `${a}|${b}` : `${b}|${a}`))?.level;
eq("dup: same name same suffix → confirmed", level("x1", "x2"), "confirmed");
eq("dup: same name other suffix → suspected", level("x1", "x3"), "suspected");
eq("dup: cross-script → suspected", level("x1", "x4"), "suspected");
eq("dup: same registry record → confirmed", level("x5", "x6"), "confirmed");
const checks = registryChecks(registry);
check(
  "registry: shared phone",
  checks.some(
    (c) => c.kind === "same_phone" && c.personIds.includes("r1") && c.personIds.includes("r2"),
  ),
);
check(
  "registry: emails one letter apart",
  checks.some((c) => c.kind === "similar_email"),
);
check(
  "registry: guider also coach",
  checks.some((c) => c.kind === "guider_and_coach"),
);
eq("phone: +966 folded", normalizePhone("+966 50 333 3333"), "0503333333");
eq("phone: 9 digits invalid", isValidSaudiMobile("056440025"), false);

// --- agenda -------------------------------------------------------------------
eq("type: workshop", classifySession("ورشة التفكير التصميمي", 60), "workshop");
eq("type: mentoring", classifySession("الجلسة الإرشادية الأولى", 40), "mentoring");
eq("type: zoom beats workshop", classifySession("ورشة عبر Zoom", 60), "zoom");
eq("type: break", classifySession("استراحة / صلاة المغرب", 25), "break");
eq("type: short → transition", classifySession("ورشة قصيرة", 5), "transition");
eq("judging round teams", roundTeams("عروض الفرق من 1 إلى 10", 29)?.length, 10);
eq("judging round capped to team count", roundTeams("عروض الفرق من 21 إلى 30", 29)?.at(-1), 29);

// --- attendance ------------------------------------------------------------------
const T = (hhmm: string) => fromRiyadh("2026-10-05", hhmm).getTime();
eq(
  "merge overlaps once",
  mergeIntervals([
    { s: 0, e: 10 },
    { s: 5, e: 15 },
    { s: 20, e: 25 },
  ]),
  [
    { s: 0, e: 15 },
    { s: 20, e: 25 },
  ],
);
eq(
  "overlap clipped to window",
  overlapMs(
    [
      { s: 0, e: 15 },
      { s: 20, e: 25 },
    ],
    10,
    22,
  ),
  7,
);
const rooms: Room[] = [
  {
    id: "hall",
    kind: "main_hall",
    teamNo: null,
    committeeNo: null,
    label: "hall",
    topics: ["القاعة الرئيسية"],
  },
  { id: "t5", kind: "team", teamNo: 5, committeeNo: null, label: "t5", topics: [] },
  { id: "t6", kind: "team", teamNo: 6, committeeNo: null, label: "t6", topics: ["غرفة فريق 6"] },
];
const placements = placeMeetings(
  [
    {
      id: "m1",
      topic: "القاعة الرئيسية",
      startedAt: 0,
      endedAt: 1,
      manualRoomId: null,
      accountIds: ["a"],
    },
    {
      id: "m2",
      topic: null,
      startedAt: 0,
      endedAt: 1,
      manualRoomId: null,
      accountIds: ["p1", "p2", "g1"],
    },
    {
      id: "m3",
      topic: null,
      startedAt: 0,
      endedAt: 1,
      manualRoomId: null,
      accountIds: Array.from({ length: 20 }, (_, i) => `z${i}`),
    },
    {
      id: "m4",
      topic: null,
      startedAt: 0,
      endedAt: 1,
      manualRoomId: null,
      accountIds: ["p1", "z1", "z2"],
    },
    {
      id: "m5",
      topic: "غرفة فريق 6",
      startedAt: 0,
      endedAt: 1,
      manualRoomId: "t5",
      accountIds: [],
    },
  ],
  rooms,
  new Map([
    ["p1", 5],
    ["p2", 5],
  ]),
  { mixShare: 0.5, mainHallMinParticipants: 15 },
);
eq("place: topic", placements.get("m1"), { roomId: "hall", source: "topic" });
eq("place: participant mix", placements.get("m2"), { roomId: "t5", source: "mix" });
eq("place: crowd → main hall", placements.get("m3"), { roomId: "hall", source: "size" });
eq("place: unplaced", placements.get("m4"), { roomId: null, source: null });
eq("place: manual wins", placements.get("m5"), { roomId: "t5", source: "manual" });

const participant: AttPerson = {
  key: "p:1",
  name: "p",
  role: "participant",
  teamNo: 5,
  guiderTeams: [],
  accountIds: ["p1"],
};
const guider: AttPerson = {
  key: "p:g",
  name: "g",
  role: "guider",
  teamNo: null,
  guiderTeams: [5, 6],
  accountIds: ["g1"],
};
const workshop: AttSession = {
  id: "s1",
  dayNo: 2,
  start: T("18:30"),
  end: T("19:30"),
  title: "ورشة",
  type: "workshop",
  roundTeams: null,
};
const mentoring: AttSession = {
  id: "s2",
  dayNo: 2,
  start: T("20:30"),
  end: T("21:50"),
  title: "الجلسة الإرشادية",
  type: "mentoring",
  roundTeams: null,
};
const ctx = (
  roomIntervals: Record<string, Record<string, Iv[]>>,
  extra: Partial<AttendanceContext> = {},
): AttendanceContext => ({
  rooms,
  roomIntervals: new Map(
    Object.entries(roomIntervals).map(([k, v]) => [
      k,
      new Map(Object.entries(v).map(([r, ivs]) => [r, mergeIntervals(ivs)])),
    ]),
  ),
  meetingIntervals: new Map(),
  platformIntervals: new Map(),
  committeeOfTeam: new Map(),
  overrides: new Map(),
  attendMinutes: 10,
  lateMinutes: 10,
  everyoneIncludesEnablers: true,
  ...extra,
});
const rejoin = ctx({
  "p:1": {
    hall: [
      { s: T("18:30"), e: T("18:36") },
      { s: T("18:34"), e: T("18:41") },
    ],
  },
});
eq(
  "BR-ATT-01: rejoins add, overlaps once → present",
  scoreCell(participant, workshop, rejoin).status,
  "present",
);
eq("BR-ATT-01: 11 minutes", scoreCell(participant, workshop, rejoin).minutes, 11);
eq(
  "BR-ATT-02: 1–9 min → partial",
  scoreCell(participant, workshop, ctx({ "p:1": { hall: [{ s: T("18:30"), e: T("18:35") }] } }))
    .status,
  "partial",
);
const late = scoreCell(
  participant,
  workshop,
  ctx({ "p:1": { hall: [{ s: T("18:45"), e: T("19:30") }] } }),
);
eq("BR-ATT-03: late", [late.status, late.late], ["present", true]);
const elsewhere = ctx(
  { "p:1": { t6: [{ s: T("18:30"), e: T("19:30") }] } },
  { meetingIntervals: new Map([["p:1", [{ s: T("18:30"), e: T("19:30") }]]]) },
);
eq("BR-ATT-02: in another room", scoreCell(participant, workshop, elsewhere).status, "elsewhere");
eq("BR-ATT-02: nothing → absent", scoreCell(participant, workshop, ctx({})).status, "absent");
const zoom: AttSession = { ...workshop, id: "sz", type: "zoom" };
eq("BR-ATT-02: Zoom → off platform", scoreCell(participant, zoom, ctx({})).status, "off_platform");
const guiderCtx = ctx({
  "p:g": { t5: [{ s: T("20:31"), e: T("20:45") }], t6: [{ s: T("21:10"), e: T("21:15") }] },
});
const coverage = guiderCoverage([guider], [mentoring], guiderCtx, T("23:00"));
eq("BR-ATT-04: team 5 covered", coverage.find((c) => c.teamNo === 5)?.covered, true);
eq("BR-ATT-04: team 6 not covered", coverage.find((c) => c.teamNo === 6)?.covered, false);
const overridden = ctx({}, { overrides: new Map([["s1|p:1|0", "present"]]) });
eq("FR-ATT-09: override wins", scoreCell(participant, workshop, overridden), {
  status: "present",
  minutes: 0,
  late: false,
  firstJoin: null,
  overridden: true,
  perTeam: undefined,
});
const day3: AttSession = {
  ...workshop,
  id: "s3",
  dayNo: 3,
  start: workshop.start + 86_400_000,
  end: workshop.end + 86_400_000,
};
const grid = new Map([
  ["s1", new Map([["p:1", scoreCell(participant, workshop, ctx({}))]])],
  ["s3", new Map([["p:1", scoreCell(participant, day3, ctx({}))]])],
]);
eq(
  "FR-ATT-17: absent two days",
  absentTwoDays([workshop, day3], [participant], grid).map((x) => x.days),
  [[2, 3]],
);

// --- recordings ---------------------------------------------------------------------
const meeting = {
  id: "m",
  topic: null,
  startedAt: 1_000_000,
  endedAt: 2_000_000,
  accountIds: ["a", "b", "c", "d"],
};
const items = [
  {
    id: "i1",
    topic: "ملخص",
    startedAt: 1_150_000,
    endedAt: 2_000_000,
    participantIds: ["a", "b", "c", "d"],
  },
  {
    id: "i2",
    topic: "بعيد",
    startedAt: 9_000_000,
    endedAt: 9_500_000,
    participantIds: ["a", "b", "c", "d"],
  },
  {
    id: "i3",
    topic: "كبير",
    startedAt: 1_010_000,
    endedAt: 2_000_000,
    participantIds: Array.from({ length: 40 }, (_, i) => `q${i}`).concat(["a"]),
  },
];
eq(
  "rec: 150 s late item still links",
  decideLibrary(meeting, items, { windowSeconds: 180, retryMinutes: 30, now: 2_100_000 }, new Set())
    .status,
  "linked",
);
eq(
  "rec: item starting 28 min into the meeting still links",
  decideLibrary(
    { ...meeting, endedAt: 1_000_000 + 60 * 60_000 },
    [
      {
        id: "late",
        topic: null,
        startedAt: 1_000_000 + 28 * 60_000,
        endedAt: 1_000_000 + 59 * 60_000,
        participantIds: ["a", "b", "c"],
      },
    ],
    { windowSeconds: 180, retryMinutes: 30, now: 1_000_000 + 61 * 60_000 },
    new Set(),
  ).status,
  "linked",
);
eq(
  "rec: item before the meeting does not link",
  decideLibrary(
    meeting,
    [
      {
        id: "early",
        topic: null,
        startedAt: 1_000_000 - 10 * 60_000,
        endedAt: 1_000_000,
        participantIds: ["a", "b", "c", "d"],
      },
    ],
    { windowSeconds: 180, retryMinutes: 30, now: 2_100_000 },
    new Set(),
  ).status,
  "pending",
);
eq(
  "rec: two fits → uncertain",
  decideLibrary(
    meeting,
    [items[0]!, { ...items[0]!, id: "i4" }],
    { windowSeconds: 180, retryMinutes: 30, now: 2_100_000 },
    new Set(),
  ).status,
  "uncertain",
);
eq(
  "rec: retry window",
  decideLibrary(meeting, [], { windowSeconds: 180, retryMinutes: 30, now: 2_100_000 }, new Set())
    .status,
  "pending",
);
eq(
  "rec: gives up",
  decideLibrary(
    meeting,
    [],
    { windowSeconds: 180, retryMinutes: 30, now: 2_000_000 + 31 * 60_000 },
    new Set(),
  ).status,
  "none",
);

// --- import -----------------------------------------------------------------------
const reg = parseRegistry([
  {
    name: "الفرق",
    rows: [
      [
        "رقم الفريق",
        "رقم الطلب",
        "المرشد",
        "م",
        "الاسم",
        "الصفة",
        "البريد الإلكتروني",
        "رقم الجوال",
        "ملاحظات",
      ],
      [
        5,
        10001,
        "خالد سعد المثالي",
        1,
        "سارة محمد التستي",
        "قائد",
        "sara@example.com",
        "0501111111",
        null,
      ],
      [null, null, null, 2, "نورة علي التستي", "عضو", "sarah@example.com", "0501111111", null],
      ["الفريق 6 - عدد الأعضاء 3", null, null, null, null, null, null, null, null],
      [6, 10002, "مرشد غير مسجل", 1, "Fahad Exampli", "Leader", null, "05012345", null],
      ["المجموع", null, null, null, 4, null, null, null, null],
    ],
  },
  {
    name: "المرشدين",
    rows: [
      ["اسم المرشد", "الجوال", "البريد"],
      ["خالد سعد المثالي", "0502222222", "k@example.com"],
    ],
  },
  {
    name: "المدربين",
    rows: [
      ["اسم المدرب", "الجوال"],
      ["مدرب تجريبي", "0504444444"],
    ],
  },
]);
eq("registry: people", reg.parsed.people.length, 5);
eq(
  "registry: merged team fills down",
  reg.parsed.people.find((p) => p.name === "نورة علي التستي")?.teamNo,
  5,
);
eq(
  "registry: leader title",
  reg.parsed.people.find((p) => p.name === "سارة محمد التستي")?.title,
  "leader",
);
eq(
  "registry: guider assignment",
  reg.parsed.guiderTeams.map((g) => g.teamNo),
  [5],
);
const codesOf = (list: { code: string }[]) => [...new Set(list.map((i) => i.code))].sort();
eq("registry: issues", codesOf(reg.issues), [
  "count_mismatch",
  "guider_missing",
  "phone_duplicate",
  "phone_invalid",
  "total_mismatch",
]);

// Block layout: a header line per team, the column header repeated per block.
const blocks = parseRegistry([
  {
    name: "Teams",
    rows: [
      ["الفريق 7 - رقم الطلب 10626 - المرشد خالد سعد المثالي - عدد الأعضاء 2"],
      ["م", "الاسم", "الصفة", "البريد", "الجوال"],
      [1, "منيرة التجربة", "قائدة", "m@example.com", "0507777777"],
      [2, "Hala Testa", "Member", null, "966507777778"],
      [null, null, null, null, null],
      ["Team 8 · members 1"],
      ["#", "Full name", "Role", "Email", "Mobile"],
      [1, "ريم الاختبار", "Leader", null, "0508888888"],
    ],
  },
  {
    name: "Guiders",
    rows: [
      ["Guider name", "Mobile"],
      ["خالد سعد المثالي", "0502222222"],
    ],
  },
  { name: "Coaches", rows: [["Coach name", "Mobile"]] },
]);
eq(
  "blocks: people by team",
  blocks.parsed.people.filter((p) => p.kind === "participant").map((p) => [p.teamNo, p.title]),
  [
    [7, "leader"],
    [7, "member"],
    [8, "leader"],
  ],
);
eq(
  "blocks: application and declared count",
  blocks.parsed.teams.map((t) => [t.teamNo, t.applicationNo, t.declaredMembers]),
  [
    [7, "10626", 2],
    [8, null, 1],
  ],
);
eq(
  "blocks: guider from the block header",
  blocks.parsed.guiderTeams.map((g) => g.teamNo),
  [7],
);
eq(
  "blocks: +966 phone is valid",
  blocks.issues.filter((i) => i.code === "phone_invalid").length,
  0,
);
const agenda = parseAgenda(
  [
    {
      name: "اليوم 2",
      rows: [
        ["برنامج اليوم الثاني"],
        ["الإثنين 5 أكتوبر 2026", "مرحلة الاستكشاف"],
        ["من", "إلى", "الفقرة"],
        ["5:30 م", "6:00 م", "ورشة الافتتاح"],
        [0.75, 0.7708333333, "استراحة / صلاة المغرب"],
        ["8:30 - 9:10 مساءً", null, "الجلسة الإرشادية الأولى"],
      ],
    },
  ],
  { startDate: "2026-10-04", dayCount: 14 },
);
eq("agenda: day from date", agenda.parsed.days[0]?.dayNo, 2);
eq("agenda: phase", agenda.parsed.days[0]?.phase, "الاستكشاف");
eq(
  "agenda: sessions",
  agenda.parsed.sessions.map((s) => [
    riyadhHHMM(new Date(s.startsAt)),
    riyadhHHMM(new Date(s.endsAt)),
    s.autoType,
  ]),
  [
    ["17:30", "18:00", "workshop"],
    ["18:00", "18:30", "break"],
    ["20:30", "21:10", "mentoring"],
  ],
);
eq("agenda: no issues", agenda.issues, []);
const d = diffRecords(
  [
    { naturalKey: "a", v: 1 },
    { naturalKey: "b", v: 1 },
  ],
  [
    { naturalKey: "a", v: 2 },
    { naturalKey: "c", v: 1 },
  ],
  ["v"],
);
eq("diff", [d.added.length, d.removed.length, d.changed.length], [1, 1, 1]);

// --- settings ------------------------------------------------------------------------
eq(
  "settings: bad value falls back",
  resolveCampSettings({ attendMinutes: "x", teamCount: 30 }).attendMinutes,
  10,
);
eq("settings: sending off by default", resolveCampSettings({}).sendingEnabled, false);

eq("settings patch: only the sent keys", parseCampSettingsPatch({ lateMinutes: 12 }), {
  lateMinutes: 12,
});
check(
  "settings patch: unknown key refused",
  (() => {
    try {
      parseCampSettingsPatch({ nope: 1 });
      return false;
    } catch {
      return true;
    }
  })(),
);

console.log(`camp-logic: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
