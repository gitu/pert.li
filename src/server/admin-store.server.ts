import { count as countFn, desc, eq } from "drizzle-orm";
import { db } from "#/db";
import { project, session, user, workspace } from "#/db/schema";

export type AdminUserRow = {
	id: string;
	name: string;
	email: string;
	isAdmin: boolean;
	createdAt: string;
};

export type AdminStats = {
	users: number;
	admins: number;
	workspaces: number;
	projects: number;
	activeSessions: number;
};

export async function getAdminStats(): Promise<AdminStats> {
	const [users, admins, workspaces, projects, sessions] = await Promise.all([
		db.select({ value: countFn() }).from(user),
		db.select({ value: countFn() }).from(user).where(eq(user.isAdmin, true)),
		db.select({ value: countFn() }).from(workspace),
		db.select({ value: countFn() }).from(project),
		db.select({ value: countFn() }).from(session),
	]);
	return {
		users: users[0]?.value ?? 0,
		admins: admins[0]?.value ?? 0,
		workspaces: workspaces[0]?.value ?? 0,
		projects: projects[0]?.value ?? 0,
		activeSessions: sessions[0]?.value ?? 0,
	};
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
	const rows = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			isAdmin: user.isAdmin,
			createdAt: user.createdAt,
		})
		.from(user)
		.orderBy(desc(user.createdAt));
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		email: r.email,
		isAdmin: r.isAdmin,
		createdAt: r.createdAt.toISOString(),
	}));
}
