import { createFileRoute } from "@tanstack/react-router";
import { NotificationsView } from "@/components/camp/views/NotificationsView";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({ meta: [{ title: "التنبيهات والتذكيرات — ديوان الابتكار" }] }),
  component: NotificationsView,
});
