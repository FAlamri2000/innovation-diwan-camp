/**
 * Camp operations — name text, similarity and Riyadh time.
 *
 * PURE: no imports outside this folder, relative `.ts` specifiers only, so
 * `node scripts/qa/camp-logic.ts` can run it without a build (Node strips the
 * types). Everything that decides whether two names are one person lives here,
 * because the directory, the duplicate queue, the naming checks and registry
 * matching must all agree on it.
 *
 * Requirements: FR-DUP-01 (normalization), FR-DUP-02 (romanization),
 * FR-DUP-03 (0–100 score), BR-NAM-01..03, FR-UI-03 (times and dates),
 * BR-ATT-05 (Riyadh time).
 */

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_LETTER = /[ء-غف-يٱ-ۓ]/;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/;

/** Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits → 0-9 (BR-NAM-01). */
export function toWesternDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function hasArabic(value: string): boolean {
  return ARABIC_LETTER.test(value);
}

export function hasLatin(value: string): boolean {
  return LATIN_LETTER.test(value);
}

/** أ إ آ ٱ → ا, ة → ه, ى → ي, diacritics and tatweel dropped (FR-DUP-01). */
export function normalizeArabicLetters(value: string): string {
  return value
    .replace(ARABIC_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

// ---------------------------------------------------------------------------
// Honorifics, connectors, separators
// ---------------------------------------------------------------------------

/**
 * Defaults for the editable honorific list (FR-NAM-07). Compared after
 * normalization and with the trailing dot removed, so "د." and "د" are one
 * entry. A lone single Arabic letter at the start is always an honorific: no
 * Arabic given name is one letter, and "د أحمد" is common.
 */
export const DEFAULT_HONORIFICS = [
  "د.",
  "م.",
  "أ.",
  "Dr.",
  "Eng.",
  "الدكتور",
  "الدكتوره",
  "المهندس",
  "المهندسه",
  "الاستاذ",
  "الاستاذه",
  "Prof.",
  "Mr.",
  "Ms.",
  "Mrs.",
];

/** Tokens that join two parts of one name and carry no identity. */
const CONNECTOR_TOKENS = new Set(["بن", "بنت", "ابن", "bin", "ibn", "bint", "ben"]);

/** Separators FR-NAM N02 lists, plus the full-width forms people type. */
export const ALT_SEPARATORS = ["–", "—", "_", "/", "|", "،", ",", "+", "‒", "―", "｜"];

const SEPARATOR_CLASS = /[-‐‑‒–—―_/|،,+｜]/;

function honorificKey(token: string): string {
  return normalizeArabicLetters(token).toLowerCase().replace(/\.+$/, "");
}

/** Remove honorifics at the START of a name (BR-NAM-03). Returns the rest. */
export function stripHonorifics(value: string, honorifics: readonly string[]): string {
  const keys = new Set(honorifics.map(honorificKey));
  let rest = value.trim();
  for (let guard = 0; guard < 4; guard += 1) {
    const match = /^(\S+?)(?:\.\s*|\s+)/.exec(rest);
    if (!match) break;
    const raw = match[1] ?? "";
    const key = honorificKey(raw);
    const lone = raw.replace(/\.$/, "");
    const loneArabicLetter = lone.length === 1 && ARABIC_LETTER.test(lone);
    if (!keys.has(key) && !loneArabicLetter) break;
    rest = rest.slice(match[0].length).trim();
  }
  return rest;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Lower-cased, letter-normalized, digit-free token list of a name fragment. */
export function nameTokens(value: string): string[] {
  const cleaned = normalizeArabicLetters(toWesternDigits(value))
    .toLowerCase()
    // Split letter/digit boundaries ("26ريم" → "26 ريم") before dropping digits.
    .replace(/(\d)(\D)/g, "$1 $2")
    .replace(/(\D)(\d)/g, "$1 $2")
    .replace(/[0-9]/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const raw = cleaned.split(" ");
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i] ?? "";
    if (!token || CONNECTOR_TOKENS.has(token)) continue;
    const next = raw[i + 1];
    // Detached article: "ال خاطر" / "al zahrani" / "el" → one token, so it
    // compares equal to "الخاطر" / "alzahrani".
    if ((token === "ال" || token === "al" || token === "el") && next) {
      out.push((token === "ال" ? "ال" : "al") + next);
      i += 1;
      continue;
    }
    // "عبد الله" = "عبدالله", "abdul aziz" = "abdulaziz" (FR-DUP-01/02),
    // including the three-part "عبد ال عزيز" / "abd al rahman".
    if (token === "عبد" && next) {
      const third = raw[i + 2];
      if (next === "ال" && third) {
        out.push("عبدال" + third);
        i += 2;
      } else {
        out.push("عبد" + next);
        i += 1;
      }
      continue;
    }
    if (/^abd(?:ul|el|al|ol|u)?$/.test(token) && next) {
      const third = raw[i + 2];
      if ((next === "al" || next === "el" || next === "ul") && third) {
        out.push("abdul" + third);
        i += 2;
      } else {
        out.push("abdul" + next.replace(/^(?:al|el|ul)(?=.)/, ""));
        i += 1;
      }
      continue;
    }
    if (token.startsWith("el") && token.length > 4 && LATIN_LETTER.test(token)) {
      out.push("al" + token.slice(2));
      continue;
    }
    out.push(token);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Romanization (FR-DUP-02)
// ---------------------------------------------------------------------------

/**
 * Common given names: normalized Arabic → Latin spellings seen in practice.
 * A Latin token found here is compared IN ARABIC, which is what keeps
 * Khalid (خالد) and Khloud (خلود) apart — their consonant skeletons are
 * identical. Unlisted tokens fall back to the skeleton comparison below.
 */
const NAME_TABLE: Record<string, string[]> = {
  محمد: [
    "mohammad",
    "mohammed",
    "muhammad",
    "mohamed",
    "mohamad",
    "muhammed",
    "mohd",
    "mhmd",
    "mohammd",
    "mohmmed",
  ],
  احمد: ["ahmad", "ahmed", "ahmmad"],
  محمود: ["mahmoud", "mahmood", "mahmud"],
  عبدالله: ["abdullah", "abdulla", "abdallah", "abdulah", "abdellah", "abdollah"],
  عبدالعزيز: ["abdulaziz", "abdelaziz", "abdalaziz", "abdulazeez", "abdulazez"],
  عبدالرحمن: [
    "abdulrahman",
    "abdurrahman",
    "abdelrahman",
    "abdalrahman",
    "abdulrhman",
    "abdulrahmn",
    "abdurahman",
  ],
  عبدالكريم: ["abdulkarim", "abdulkareem", "abdelkarim"],
  عبدالمجيد: ["abdulmajeed", "abdulmajid"],
  عبدالملك: ["abdulmalik", "abdulmalek"],
  عبدالاله: ["abdulelah", "abdulilah", "abdulellah"],
  عبدالمحسن: ["abdulmohsen", "abdulmuhsin"],
  عبداللطيف: ["abdullatif", "abdullateef"],
  عبدالهادي: ["abdulhadi"],
  عبدالرحيم: ["abdulrahim", "abdulraheem"],
  خالد: ["khalid", "khaled", "khalied"],
  خلود: ["khloud", "kholoud", "kholood", "khulood", "khlood"],
  فهد: ["fahad", "fahd"],
  فيصل: ["faisal", "faysal", "feisal", "fisal"],
  سعد: ["saad", "sa'd", "saed"],
  سعود: ["saud", "saoud", "saood"],
  سلطان: ["sultan", "soltan"],
  سلمان: ["salman", "selman"],
  سليمان: ["sulaiman", "sulaiman", "suliman", "sulayman", "sleman"],
  تركي: ["turki", "turky", "torki"],
  نايف: ["naif", "nayef", "nayif"],
  ناصر: ["nasser", "nasir", "naser"],
  ماجد: ["majed", "majid"],
  مشعل: ["mishal", "meshal", "mishaal"],
  بندر: ["bandar", "bander"],
  يوسف: ["yousef", "yusuf", "youssef", "yousif", "yosef"],
  ابراهيم: ["ibrahim", "ebrahim", "ibraheem"],
  اسماعيل: ["ismail", "esmail", "ismaeel"],
  عمر: ["omar", "umar"],
  عمرو: ["amr", "amro"],
  علي: ["ali"],
  حسن: ["hasan", "hassan"],
  حسين: ["hussain", "hussein", "husain", "hosain"],
  حمزه: ["hamza", "hamzah"],
  حمد: ["hamad"],
  حامد: ["hamed", "hamid"],
  زياد: ["ziyad", "ziad", "zeyad", "zyad"],
  ريان: ["rayan", "ryan", "rayyan"],
  راكان: ["rakan"],
  ركان: ["rakan"],
  رائد: ["raed", "raid"],
  ياسر: ["yasser", "yaser", "yasir"],
  وليد: ["waleed", "walid"],
  طلال: ["talal"],
  عادل: ["adel", "adil"],
  عماد: ["emad", "imad"],
  انس: ["anas"],
  اياد: ["eyad", "iyad", "ayad"],
  ايمن: ["ayman", "aiman"],
  مازن: ["mazen", "mazin"],
  هشام: ["hisham", "hesham"],
  سامي: ["sami", "samy"],
  سامر: ["samer", "samir"],
  ثامر: ["thamer", "thamir"],
  نواف: ["nawaf"],
  معاذ: ["moaz", "muath", "muadh", "moath", "muaz"],
  مهند: ["mohannad", "muhannad", "mohanad"],
  يزن: ["yazan", "yazen"],
  فارس: ["fares", "faris"],
  بدر: ["badr", "bader"],
  باسل: ["basel", "basil"],
  اسامه: ["osama", "usama", "osamah"],
  مصطفي: ["mustafa", "mostafa"],
  مراد: ["murad", "morad"],
  منصور: ["mansour", "mansoor", "mansur"],
  مساعد: ["musaed", "mosaed", "musaad"],
  متعب: ["mutaib", "miteb", "meteb"],
  هاني: ["hani", "hany"],
  حاتم: ["hatem", "hatim"],
  قتاده: ["qatada", "qatadah"],
  جنى: ["jana", "janna"],
  جنا: ["jana"],
  ساره: ["sara", "sarah"],
  نوره: ["noura", "nora", "norah", "nourah"],
  ريم: ["reem", "rim"],
  ريما: ["rima", "reema"],
  ريماس: ["remas", "rimas", "reemas"],
  لمى: ["lama"],
  لما: ["lama"],
  لين: ["leen", "lin"],
  ليان: ["layan", "lian", "lyan"],
  لجين: ["lujain", "lujaine", "lojain"],
  رزان: ["razan"],
  رهف: ["rahaf"],
  رغد: ["raghad"],
  هند: ["hind", "hend"],
  هيا: ["haya"],
  هبه: ["heba", "hiba", "hebah"],
  هاجر: ["hajar", "hager"],
  مها: ["maha"],
  مريم: ["maryam", "mariam", "mariem"],
  منار: ["manar"],
  منى: ["mona", "muna"],
  نوف: ["nouf", "nof"],
  ندى: ["nada"],
  نداء: ["nidaa", "nedaa", "nida"],
  غدير: ["ghadeer", "ghadir"],
  شهد: ["shahad"],
  شيماء: ["shaima", "shaimaa", "shymaa"],
  اثير: ["atheer", "athir"],
  عهد: ["ahad", "ahd"],
  جمانه: ["jumana", "jomana", "jomanah", "jomanh", "joumana"],
  رتاج: ["retaj", "ritaj"],
  مرام: ["maram"],
  رفيف: ["rafif", "rafeef"],
  رفال: ["rafal"],
  دانه: ["dana", "danah"],
  ديما: ["deema", "dima"],
  العنود: ["alanoud", "alanood", "anoud"],
  الجازي: ["aljazi", "jazi"],
  فاطمه: ["fatima", "fatimah", "fatma"],
  عائشه: ["aisha", "aysha", "aishah"],
  عبير: ["abeer", "abir"],
  اسماء: ["asma", "asmaa"],
  امل: ["amal"],
  وعد: ["waad", "wa'ad"],
  بشرى: ["bushra", "boshra"],
  سميه: ["sumaya", "somaya", "sumayah"],
  شهيناز: ["shahinaz", "shahenaz"],
  سبيكه: ["sabeka", "sabika"],
  فى: ["fay", "fai"],
  في: ["fay", "fai"],
  يسم: ["yasm"],
};

const LATIN_TO_ARABIC = new Map<string, string>();
for (const [arabic, latins] of Object.entries(NAME_TABLE)) {
  for (const latin of latins) {
    if (!LATIN_TO_ARABIC.has(latin)) LATIN_TO_ARABIC.set(latin, arabic);
  }
}

const ARABIC_TO_SKELETON: Record<string, string> = {
  ب: "b",
  ت: "t",
  ث: "t",
  ج: "j",
  ح: "h",
  خ: "k",
  د: "d",
  ذ: "d",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "x",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  غ: "g",
  ف: "f",
  ق: "k",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  ع: "",
  ا: "",
  و: "",
  ي: "",
  ء: "",
  ئ: "",
  ؤ: "",
};

/**
 * Consonant skeleton shared by both scripts. Vowels are where Arabic and Latin
 * spellings disagree (Mohammad / Muhammad / محمد), so they are dropped on both
 * sides; digraphs map to one symbol (kh → k like خ, sh → x like ش).
 */
export function skeleton(token: string): string {
  let out: string;
  if (hasArabic(token)) {
    out = [...normalizeArabicLetters(token)].map((ch) => ARABIC_TO_SKELETON[ch] ?? "").join("");
  } else {
    out = token
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .replace(/ph/g, "f")
      .replace(/kh/g, "k")
      .replace(/gh/g, "g")
      .replace(/sh|ch/g, "x")
      .replace(/th/g, "t")
      .replace(/dh/g, "d")
      .replace(/q|c/g, "k")
      .replace(/v/g, "f")
      .replace(/[aeiouwy]/g, "");
  }
  return out.replace(/(.)\1+/g, "$1").replace(/h$/, "");
}

/** The token in comparison space: Arabic when it is Arabic or a known name. */
function comparable(token: string): { arabic: string | null; skel: string } {
  if (hasArabic(token)) return { arabic: token, skel: skeleton(token) };
  const known = LATIN_TO_ARABIC.get(token) ?? LATIN_TO_ARABIC.get(token.replace(/^al/, ""));
  if (known) {
    const arabic =
      token.startsWith("al") && !known.startsWith("ال") && LATIN_TO_ARABIC.get(token) === undefined
        ? "ال" + known
        : known;
    return { arabic, skel: skeleton(arabic) };
  }
  return { arabic: null, skel: skeleton(token) };
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const left = [...a];
  const right = [...b];
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[right.length] ?? 0;
}

/** 0..1, 1 = identical. */
export function ratio(a: string, b: string): number {
  const len = Math.max([...a].length, [...b].length);
  if (len === 0) return a === b ? 1 : 0;
  return 1 - levenshtein(a, b) / len;
}

/** Token pairs repeat heavily across an O(n²) pass (every الغامدي against every other). */
const SIMILARITY_CACHE = new Map<string, number>();
const SIMILARITY_CACHE_MAX = 200_000;

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  const hit = SIMILARITY_CACHE.get(key);
  if (hit !== undefined) return hit;
  const value = tokenSimilarityUncached(a, b);
  if (SIMILARITY_CACHE.size >= SIMILARITY_CACHE_MAX) SIMILARITY_CACHE.clear();
  SIMILARITY_CACHE.set(key, value);
  return value;
}

function tokenSimilarityUncached(a: string, b: string): number {
  const left = comparable(a);
  const right = comparable(b);
  if (left.arabic !== null && right.arabic !== null) {
    if (left.arabic === right.arabic) return 1;
    return ratio(left.arabic, right.arabic);
  }
  // At least one side is an unknown Latin token: compare skeletons. A short
  // skeleton says little, so an exact skeleton match is trusted slightly less
  // than an exact spelling match.
  if (!left.skel || !right.skel) return 0;
  const skel = ratio(left.skel, right.skel);
  const raw = !hasArabic(a) && !hasArabic(b) ? ratio(a, b) : 0;
  return Math.max(raw, skel * 0.97);
}

export type NameComparison = {
  /** 0–100 (FR-DUP-03). */
  score: number;
  /** One name is the other plus one or more middle names (suspected rule). */
  plusMiddleName: boolean;
};

/**
 * Compare two token lists (from `nameTokens`). Ordered alignment: names are
 * first … family, and a display name usually drops the middle names a registry
 * record carries ("محمد الزهراني" vs "محمد عبدالله سعد الزهراني"), so the score
 * is taken over the SHORTER name, with a small charge per skipped token and a
 * large one when first or family names do not line up.
 */
export function compareTokenLists(a: readonly string[], b: readonly string[]): NameComparison {
  if (!a.length || !b.length) return { score: 0, plusMiddleName: false };
  const n = a.length;
  const m = b.length;
  // dp[i][j] = best sum aligning a[0..i) with b[0..j)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const sims: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: m }, (_, j) => tokenSimilarity(a[i] ?? "", b[j] ?? "")),
  );
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const sim = sims[i - 1]?.[j - 1] ?? 0;
      dp[i]![j] = Math.max(
        dp[i - 1]![j]!,
        dp[i]![j - 1]!,
        dp[i - 1]![j - 1]! + (sim >= 0.5 ? sim : 0),
      );
    }
  }
  const shorter = Math.min(n, m);
  let base = (dp[n]?.[m] ?? 0) / shorter;
  const firstSim = sims[0]?.[0] ?? 0;
  const lastSim = sims[n - 1]?.[m - 1] ?? 0;
  if (n !== m) {
    // The shorter name must still start and end where the longer one does.
    if (firstSim < 0.8 || lastSim < 0.8) base *= 0.85;
  }
  const skipped = Math.abs(n - m);
  let score = Math.round(Math.max(0, base * 100 - Math.min(9, skipped * 3)));
  // A one-word name matches every person sharing that word; never let it
  // reach a duplicate or an automatic registry link on its own.
  if (shorter === 1 && Math.max(n, m) > 1) score = Math.min(score, 70);
  if (shorter === 1 && n === m && score === 100) score = 85;
  const plusMiddleName =
    skipped > 0 && shorter >= 2 && firstSim >= 0.9 && lastSim >= 0.9 && base >= 0.95;
  return { score, plusMiddleName };
}

export function compareNames(a: string, b: string): NameComparison {
  return compareTokenLists(nameTokens(a), nameTokens(b));
}

// ---------------------------------------------------------------------------
// Riyadh time (BR-ATT-05) and Arabic formatting (FR-UI-03)
// ---------------------------------------------------------------------------

/** Riyadh is UTC+3 all year (no daylight saving). */
export const RIYADH_OFFSET_MINUTES = 180;

const MINUTE = 60_000;

export type WallParts = { year: number; month: number; day: number; hour: number; minute: number };

export function riyadhParts(instant: Date | number): WallParts {
  const ms =
    (typeof instant === "number" ? instant : instant.getTime()) + RIYADH_OFFSET_MINUTES * MINUTE;
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 'YYYY-MM-DD' of the instant in Riyadh. */
export function riyadhDate(instant: Date | number): string {
  const p = riyadhParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** 'HH:MM' (24h) of the instant in Riyadh. */
export function riyadhHHMM(instant: Date | number): string {
  const p = riyadhParts(instant);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Riyadh wall time → instant. `time` is 'HH:MM' or 'HH:MM:SS'. */
export function fromRiyadh(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s] = time.split(":").map(Number);
  const utc = Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0);
  return new Date(utc - RIYADH_OFFSET_MINUTES * MINUTE);
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (mo ?? 1) - 1, (d ?? 1) + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Whole days from a to b ('YYYY-MM-DD'). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const AR_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];
const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "5 أكتوبر 2026" (FR-UI-03) — Western digits, Gregorian months. */
export function formatDateAr(date: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  return `${d} ${AR_MONTHS[(mo ?? 1) - 1]} ${y}`;
}

export function formatDateEn(date: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  return `${d} ${EN_MONTHS[(mo ?? 1) - 1]} ${y}`;
}

/**
 * "5:30 مساءً", "1:45 ظهرًا", "9:00 صباحًا" (FR-UI-03). The document's own
 * cue copy fixes the boundaries: 12:00–2:59 pm is ظهرًا, 3:00 pm onward مساءً.
 */
export function formatClockAr(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const period = hour < 12 ? "صباحًا" : hour < 15 ? "ظهرًا" : "مساءً";
  return `${h12}:${pad2(minute)} ${period}`;
}

export function formatClockEn(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad2(minute)} ${hour < 12 ? "AM" : "PM"}`;
}

export function formatTimeAr(instant: Date | number): string {
  const p = riyadhParts(instant);
  return formatClockAr(p.hour, p.minute);
}

/** 'HH:MM' wall time → Arabic clock. */
export function formatHHMMAr(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return formatClockAr(h ?? 0, m ?? 0);
}

export function isSeparatorChar(ch: string): boolean {
  return SEPARATOR_CLASS.test(ch);
}
