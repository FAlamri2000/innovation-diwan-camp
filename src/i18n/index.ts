/**
 * Translation. Arabic is the default; the language lives in a cookie so the
 * server renders the right one (and the right direction) on the first paint.
 * Both dictionaries are static — the app is small enough that lazy-loading
 * one would cost more than it saves.
 */
import { ar } from "./ar";
import { en, type MessageKey } from "./en";

export type { MessageKey };
export type AppLocale = "ar" | "en";

const dictionaries: Record<AppLocale, Record<MessageKey, string>> = { ar, en };

let currentLocale: AppLocale = "ar";

export function setI18nLocale(locale: AppLocale): void {
  currentLocale = locale;
}

export function getI18nLocale(): AppLocale {
  return currentLocale;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return interpolate(dictionaries[currentLocale][key] ?? en[key] ?? key, params);
}

/** Translate in a given language regardless of the UI's (exports, DMs). */
export function tFor(
  locale: AppLocale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return interpolate(dictionaries[locale][key] ?? en[key] ?? key, params);
}

/** Both dictionaries are always loaded; kept for call sites written against lazy loading. */
export function ensureLocaleDict(_locale: AppLocale): Promise<void> {
  return Promise.resolve();
}

export function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, value);
}
