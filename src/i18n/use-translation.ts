import { t } from "./index";
import { useLocale } from "./locale-context";

export function useTranslation() {
  const { locale, direction } = useLocale();
  return { t, locale, direction };
}
