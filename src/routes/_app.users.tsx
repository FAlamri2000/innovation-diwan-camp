import { createFileRoute } from "@tanstack/react-router";
import { DirectoryView } from "@/components/camp/views/DirectoryView";

export const Route = createFileRoute("/_app/users")({
  head: () => ({ meta: [{ title: "المستخدمون — ديوان الابتكار" }] }),
  component: DirectoryView,
});
