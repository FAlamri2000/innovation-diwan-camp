import { createFileRoute } from "@tanstack/react-router";
import { UploadView } from "@/components/camp/views/UploadView";

export const Route = createFileRoute("/_app/upload")({
  head: () => ({ meta: [{ title: "رفع البيانات — ديوان الابتكار" }] }),
  component: UploadView,
});
