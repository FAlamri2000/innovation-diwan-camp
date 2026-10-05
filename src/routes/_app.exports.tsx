import { createFileRoute } from "@tanstack/react-router";
import { ExportsView } from "@/components/camp/views/ExportsView";

export const Route = createFileRoute("/_app/exports")({
  head: () => ({ meta: [{ title: "التصدير — ديوان الابتكار" }] }),
  component: ExportsView,
});
