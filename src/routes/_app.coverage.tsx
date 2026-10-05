import { createFileRoute } from "@tanstack/react-router";
import { CoverageView } from "@/components/camp/views/CoverageView";

export const Route = createFileRoute("/_app/coverage")({
  head: () => ({ meta: [{ title: "تغطية المرشدين — ديوان الابتكار" }] }),
  component: CoverageView,
});
