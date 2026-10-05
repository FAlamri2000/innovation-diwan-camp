import { createFileRoute } from "@tanstack/react-router";
import { AttendanceView } from "@/components/camp/views/AttendanceView";

export const Route = createFileRoute("/_app/attendance")({
  head: () => ({ meta: [{ title: "الحضور — ديوان الابتكار" }] }),
  component: AttendanceView,
});
