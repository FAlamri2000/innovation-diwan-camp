/**
 * Camp operations — Data upload: pieces the upload tabs share.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { en, type MessageKey } from "@/i18n/en";
import type { ImportPreview } from "@/lib/camp/types";
import { getCampAgenda, getCampSettings } from "@/lib/camp-read.functions";
import { campKey } from "../../camp-ui";

/** Server codes become dictionary keys; an unknown code must not crash t(). */
export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

export function useCampAgenda() {
  const fn = useServerFn(getCampAgenda);
  return useQuery({ queryKey: campKey("agenda"), queryFn: () => fn() });
}

export function useCampSettingsQuery() {
  const fn = useServerFn(getCampSettings);
  return useQuery({ queryKey: campKey("settings"), queryFn: () => fn() });
}

/** "a, b\nc" → ["a", "b", "c"], trimmed, de-duplicated, empties dropped. */
export function splitList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,،\n]/)) {
    const item = part.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** 'HH:MM' validity (24-hour). */
export const isHHMM = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;
type Issue = ImportPreview["issues"][number];

/** One sentence per issue, in whichever dictionary `tr` reads (screen or Arabic export). */
export function issueText(
  issue: Issue,
  tr: Translate,
  formatDate: (date: string) => string,
): string {
  const params: Record<string, string | number> = { ...(issue.params ?? {}) };
  const sub = (param: string, prefix: string) => {
    const value = params[param];
    const key = `${prefix}.${String(value)}`;
    if (value !== undefined && isMessageKey(key)) params[param] = tr(key);
  };
  if (issue.code === "sheet_missing") sub("sheet", "camp.upload.sheetRole");
  if (issue.code === "column_missing") sub("field", "camp.upload.field");
  if (typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date))
    params.date = formatDate(params.date);
  const key = `camp.upload.issue.${issue.code}`;
  return isMessageKey(key) ? tr(key, params) : issue.code;
}
