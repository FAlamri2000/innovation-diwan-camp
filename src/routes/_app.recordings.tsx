import { createFileRoute } from "@tanstack/react-router";
import { RecordingsView } from "@/components/camp/views/RecordingsView";

export const Route = createFileRoute("/_app/recordings")({
  head: () => ({ meta: [{ title: "التسجيلات — ديوان الابتكار" }] }),
  component: RecordingsView,
});
