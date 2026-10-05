import { createFileRoute } from "@tanstack/react-router";
import { NamingView } from "@/components/camp/views/NamingView";

export const Route = createFileRoute("/_app/naming")({
  head: () => ({ meta: [{ title: "مطابقة الأسماء — ديوان الابتكار" }] }),
  component: NamingView,
});
