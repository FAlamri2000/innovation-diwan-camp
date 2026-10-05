import { createFileRoute } from "@tanstack/react-router";
import { DuplicatesView } from "@/components/camp/views/DuplicatesView";

export const Route = createFileRoute("/_app/duplicates")({
  head: () => ({ meta: [{ title: "الحسابات المكررة — ديوان الابتكار" }] }),
  component: DuplicatesView,
});
