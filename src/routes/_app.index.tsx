import { createFileRoute } from "@tanstack/react-router";
import { OverviewView } from "@/components/camp/views/OverviewView";

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "نظرة عامة — ديوان الابتكار" }] }),
  component: OverviewView,
});
