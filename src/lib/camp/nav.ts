/**
 * Camp operations navigation — the eleven screens of §11, in its order.
 */
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CalendarCheck,
  Copy,
  Download,
  Film,
  LayoutDashboard,
  Settings,
  SpellCheck,
  Upload,
  UserCheck,
  Users,
} from "lucide-react";
import type { MessageKey } from "@/i18n";

export type CampViewId =
  | "overview"
  | "users"
  | "naming"
  | "duplicates"
  | "attendance"
  | "coverage"
  | "recordings"
  | "notifications"
  | "exports"
  | "upload"
  | "settings";

export type CampNavItem = {
  id: CampViewId;
  labelKey: MessageKey;
  icon: LucideIcon;
  /** URL segment ("" = index). */
  segment: string;
};

export const CAMP_NAV: CampNavItem[] = [
  { id: "overview", labelKey: "camp.nav.overview", icon: LayoutDashboard, segment: "" },
  { id: "users", labelKey: "camp.nav.users", icon: Users, segment: "users" },
  { id: "naming", labelKey: "camp.nav.naming", icon: SpellCheck, segment: "naming" },
  { id: "duplicates", labelKey: "camp.nav.duplicates", icon: Copy, segment: "duplicates" },
  { id: "attendance", labelKey: "camp.nav.attendance", icon: CalendarCheck, segment: "attendance" },
  { id: "coverage", labelKey: "camp.nav.coverage", icon: UserCheck, segment: "coverage" },
  { id: "recordings", labelKey: "camp.nav.recordings", icon: Film, segment: "recordings" },
  { id: "notifications", labelKey: "camp.nav.notifications", icon: Bell, segment: "notifications" },
  { id: "exports", labelKey: "camp.nav.exports", icon: Download, segment: "exports" },
  { id: "upload", labelKey: "camp.nav.upload", icon: Upload, segment: "upload" },
  { id: "settings", labelKey: "camp.nav.settings", icon: Settings, segment: "settings" },
];

export const campPath = (segment: string): string => (segment ? `/${segment}` : "/");
