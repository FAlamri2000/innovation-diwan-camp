import { createContext, useContext, type ReactNode } from "react";
import { setI18nLocale, type AppLocale } from "./index";

type LocaleValue = { locale: AppLocale; direction: "rtl" | "ltr" };

const LocaleContext = createContext<LocaleValue>({ locale: "ar", direction: "rtl" });

/** Sets the module-level locale during render, so t() is right for every
 *  child on this render — including SSR. */
export function LocaleProvider({ locale, children }: { locale: AppLocale; children: ReactNode }) {
  setI18nLocale(locale);
  return (
    <LocaleContext.Provider value={{ locale, direction: locale === "ar" ? "rtl" : "ltr" }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}
