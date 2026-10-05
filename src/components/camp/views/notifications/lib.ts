/**
 * Camp operations — data, labels and text rules shared by the notifications
 * tabs (Module 6). Components live in ./shared.tsx.
 */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { getCampAgenda, getCampMessaging } from "@/lib/camp-read.functions";
import { daysBetween, riyadhDate } from "@/lib/camp/text";
import type { CueRow, SendLogRow } from "@/lib/camp/types";
import { campKey } from "../../camp-ui";

export type Messaging = Awaited<ReturnType<typeof getCampMessaging>>;
export type CueChannel = CueRow["channel"];
export type LogChannel = CueChannel | "dm";
export type SendKind = "cue" | "nudge" | "alert" | "manual" | "test" | "summary";
export type SendStatus = SendLogRow["status"];

export function useMessaging() {
  const fn = useServerFn(getCampMessaging);
  return useQuery({ queryKey: campKey("messaging"), queryFn: () => fn() });
}

/** The agenda, for session titles and the S00 preview; shared with other screens. */
export function useAgenda() {
  const fn = useServerFn(getCampAgenda);
  return useQuery({ queryKey: campKey("agenda"), queryFn: () => fn(), staleTime: 300_000 });
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const CHANNEL_KEY: Record<LogChannel, MessageKey> = {
  channel: "camp.cue.channel.channel",
  gong: "camp.cue.channel.gong",
  announcement: "camp.cue.channel.announcement",
  npc: "camp.cue.channel.npc",
  dm: "camp.notif.log.channelDm",
};

export const SEND_KINDS: SendKind[] = ["cue", "nudge", "alert", "manual", "test", "summary"];

export const KIND_KEY: Record<SendKind, MessageKey> = {
  cue: "camp.notif.log.kind.cue",
  nudge: "camp.notif.log.kind.nudge",
  alert: "camp.notif.log.kind.alert",
  manual: "camp.notif.log.kind.manual",
  test: "camp.notif.log.kind.test",
  summary: "camp.notif.log.kind.summary",
};

export const SEND_STATUSES: SendStatus[] = ["sent", "partial", "failed", "skipped"];

/** Arabic values for Excel (§10: exports are Arabic whatever the UI language). */
export const CHANNEL_AR: Record<LogChannel, string> = {
  channel: "منشور في القناة",
  gong: "الجرس",
  announcement: "إعلان",
  npc: "شخصية إرشادية في القاعة الرئيسية",
  dm: "رسالة مباشرة",
};
export const KIND_AR: Record<SendKind, string> = {
  cue: "تذكير مجدول",
  nudge: "رسالة شخصية",
  alert: "تنبيه تشغيل",
  manual: "إرسال يدوي",
  test: "تجربة",
  summary: "ملخص اليوم",
};
export const SEND_STATUS_AR: Record<SendStatus, string> = {
  sent: "أُرسلت",
  partial: "أُرسلت جزئيًا",
  failed: "تعذّر الإرسال",
  skipped: "لم تُرسل",
};

export function isSendKind(kind: string): kind is SendKind {
  return (SEND_KINDS as string[]).includes(kind);
}
export function isLogChannel(channel: string): channel is LogChannel {
  return channel in CHANNEL_KEY;
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/** Today's camp day number, or null outside the camp. */
export function campDayToday(startDate: string, dayCount: number): number | null {
  const day = daysBetween(startDate, riyadhDate(Date.now())) + 1;
  return day >= 1 && day <= dayCount ? day : null;
}

/** [2,3,4,5,9,11] → "2 to 5, 9, 11" (runs of three or more collapse). */
export function useCompactDays() {
  const { t, locale } = useTranslation();
  const sep = locale === "ar" ? "، " : ", ";
  return (days: readonly number[]): string => {
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j += 1;
      if (j - i >= 2) parts.push(t("camp.cue.range", { from: sorted[i]!, to: sorted[j]! }));
      else for (let k = i; k <= j; k += 1) parts.push(String(sorted[k]));
      i = j + 1;
    }
    return parts.join(sep);
  };
}

// ---------------------------------------------------------------------------
// Text: fields and the character counter (FR-NOT-02)
// ---------------------------------------------------------------------------

/** Fields written in a text, e.g. "{الاسم}" → "الاسم". */
export function fieldsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map((m) => (m[1] ?? "").trim()))];
}

export function unknownFields(text: string, allowed: readonly string[]): string[] {
  return fieldsIn(text).filter((f) => !allowed.includes(f));
}

/** The length the server checks: trimmed, in UTF-16 units like `String.length`. */
export const textLength = (text: string) => text.trim().length;

export function textBlocked(text: string, limit: number, allowed: readonly string[]): boolean {
  return !text.trim() || textLength(text) > limit || unknownFields(text, allowed).length > 0;
}

export function useTextareaRef() {
  return useRef<HTMLTextAreaElement | null>(null);
}
