import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AdminPanel } from "#/components/admin/admin-panel";
import { authClient } from "#/lib/auth-client";
import { getAdminOverview } from "#/server/admin.ts";

export const Route = createFileRoute("/_app/admin")({
	component: AdminRoute,
});

function AdminRoute() {
	const { data: session, isPending: sessionPending } = authClient.useSession();
	// `isAdmin` was added via better-auth's `user.additionalFields` — it's
	// present on the wire but not on the base typed user shape, so read it
	// defensively. Anyone not flagged gets bounced to the workspace home;
	// the server-fn does the real check, this just avoids a flash of 403.
	const sessionUser = session?.user as { isAdmin?: unknown } | undefined;
	const isAdmin = sessionUser?.isAdmin === true;

	const overview = useQuery({
		queryKey: ["admin-overview"],
		queryFn: () => getAdminOverview(),
		enabled: isAdmin,
	});

	if (sessionPending) {
		return (
			<div className="grid h-full place-items-center text-sm text-muted-foreground">
				Loading…
			</div>
		);
	}

	if (!isAdmin) {
		// `_app` already guards unauthenticated → /signin. This handles the
		// "logged in, but not admin" case by sending them back to their
		// workspace rather than rendering a 403 dead-end.
		return <Navigate to="/" />;
	}

	if (overview.isPending) {
		return (
			<div className="grid h-full place-items-center text-sm text-muted-foreground">
				Loading admin data…
			</div>
		);
	}

	if (overview.isError) {
		return (
			<div className="grid h-full place-items-center text-sm text-destructive">
				Couldn't load admin data.
			</div>
		);
	}

	return <AdminPanel stats={overview.data.stats} users={overview.data.users} />;
}
