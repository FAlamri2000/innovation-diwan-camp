/**
 * Camp operations — Arabic domain copy.
 *
 * Text that leaves the dashboard (direct messages, alert DMs, Excel exports)
 * is Arabic whatever language the operator's screen is in (§1, §10, §11), so
 * it lives here as data rather than in the bilingual UI dictionaries. Terms
 * are the glossary's (§1) and §11's, exactly.
 */
import type { SessionType } from "./agenda.ts";
import type { AttStatus } from "./attendance.ts";
import type { DuplicateLevel } from "./match.ts";
import type { NamingCode, NamingStatus } from "./naming.ts";
import type { AccountType, EventRole } from "./settings.ts";

export const ROLE_AR: Record<EventRole, string> = {
  participant: "مشارك",
  guider: "مرشد",
  coach: "مدرب",
  expert: "خبير",
  speaker: "متحدث ملهم",
  supervisor: "مشرف",
  unknown: "غير محدد",
};

export const ACCOUNT_TYPE_AR: Record<AccountType | "none", string> = {
  admin: "مسؤول",
  teammate: "عضو",
  guest: "ضيف",
  none: "لم يدخل المنصة",
};

export const NAMING_STATUS_AR: Record<NamingStatus, string> = {
  ok: "مطابق",
  note: "ملاحظة",
  violation: "مخالف",
};

export const NAMING_CODE_AR: Record<NamingCode, string> = {
  N01: "لا توجد شرطة",
  N02: "استُخدم فاصل غير الشرطة",
  N03: "لا يوجد شيء بعد الشرطة",
  N04: "رقم الفريق مكتوب بكلمات",
  N05: "رقم الفريق خارج النطاق",
  N06: "رقم الفريق لا يطابق السجل",
  N07: "الصفة غير موجودة في جدول الصفات",
  N08: "الصفة لا تطابق السجل",
  N09: "الاسم من كلمة واحدة",
  N10: "الاسم قريب من السجل",
  N11: "غير موجود في السجل",
  N12: "الاسم يجمع حروفًا عربية ولاتينية",
  N13: "شرطة داخل الاسم",
};

export const DUPLICATE_LEVEL_AR: Record<DuplicateLevel, string> = {
  confirmed: "مكرر مؤكد",
  suspected: "مكرر محتمل",
  lookalike: "تشابه أسماء",
};

export const ATT_STATUS_AR: Record<AttStatus, string> = {
  present: "حاضر",
  partial: "حضور غير محتسب",
  absent: "غائب",
  elsewhere: "في غرفة أخرى",
  off_platform: "خارج المنصة",
  not_expected: "",
};

export const LATE_AR = "متأخر";
export const NOT_ON_PLATFORM_AR = "لم يدخل المنصة";
export const UNDETERMINED_AR = "غير محدد";

export const MATCH_STATE_AR = {
  linked: "مرتبط بالسجل",
  candidate: "مطابقة محتملة",
  not_in_registry: "غير موجود في السجل",
  no_account: "لم يدخل المنصة",
} as const;

export const SESSION_TYPE_AR: Record<SessionType, string> = {
  workshop: "ورشة",
  mentoring: "الجلسة الإرشادية",
  checkpoint: "نقطة التحقق",
  inspirational: "لقاء ملهم",
  pitch_coaching: "جلسة التدريب على الإلقاء",
  judging: "عروض الفرق",
  break: "استراحة",
  zoom: "Zoom",
  transition: "انتقال",
  other: "أخرى",
};

/** Operations alert titles (§9). */
export const ALERT_TITLE_AR = {
  A01: "مرشد غير موجود في غرفة الفريق",
  A02: "غرفة فريق بلا حضور",
  A03: "انخفاض نسبة الحضور",
  A04: "اسم مخالف لصيغة التسمية",
  A05: "حساب مكرر محتمل",
  A06: "حساب غير موجود في السجل",
  A07: "توقف استقبال بيانات الحضور",
  A08: "تسجيل غير متوفر",
  A09: "ملخص اليوم",
} as const;
export type AlertCode = keyof typeof ALERT_TITLE_AR;

export const TYPE_CHANGE_STATUS_AR = {
  pending: "قيد الانتظار",
  done: "تم",
  cancelled: "ملغى",
} as const;
export const DECISION_AR = {
  duplicate: "تأكيد التكرار",
  not_duplicate: "ليس تكرارًا",
  follow_up: "متابعة لاحقًا",
} as const;
export const TEAM_ROOM_AR = (teamNo: number) => `غرفة الفريق ${teamNo}`;
export const MAIN_HALL_AR = "القاعة الرئيسية";
