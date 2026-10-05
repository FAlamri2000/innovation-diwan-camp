import { createFileRoute, redirect } from "@tanstack/react-router";
import { AccessView } from "@/components/AccessView";

export const Route = createFileRoute("/_app/access")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "admin") throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "صلاحيات الدخول — ديوان الابتكار" }] }),
  component: AccessView,
});
