import { createServerFn } from "@tanstack/react-start";
import type { AdminStats, AdminUserRow } from "./admin-store.server.ts";

// Server-only helpers loaded lazily so the depscanner never walks Drizzle /
// Better Auth into the client bundle. Matches the pattern in workspace.ts.
async function helpers() {
	const [{ requireAdmin }, store] = await Promise.all([
		import("./auth-context.server.ts"),
		import("./admin-store.server.ts"),
	]);
	return { requireAdmin, ...store };
}

export const getAdminOverview = createServerFn({ method: "GET" }).handler(
	async (): Promise<{ stats: AdminStats; users: AdminUserRow[] }> => {
		const { requireAdmin, getAdminStats, listAdminUsers } = await helpers();
		await requireAdmin();
		const [stats, users] = await Promise.all([
			getAdminStats(),
			listAdminUsers(),
		]);
		return { stats, users };
	},
);
