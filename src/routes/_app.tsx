/**
 * Everything behind sign-in. No session → /login (and back here after);
 * a one-time password not yet replaced → /account until it is.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context, location }) => {
    const user = context.boot.user;
    if (!user) {
      throw redirect({ to: "/login", search: { next: location.href } });
    }
    if (user.mustChangePassword && location.pathname !== "/account") {
      throw redirect({ to: "/account" });
    }
    return { user };
  },
  component: AppLayout,
});

function AppLayout() {
  const { user, boot } = Route.useRouteContext();
  return (
    <AppShell user={user} theme={boot.theme}>
      <Outlet />
    </AppShell>
  );
}
