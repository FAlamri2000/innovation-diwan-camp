import { createFileRoute } from "@tanstack/react-router";
import { CampSettingsView } from "@/components/camp/views/CampSettingsView";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — ديوان الابتكار" }] }),
  component: CampSettingsView,
});
