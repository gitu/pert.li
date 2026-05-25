import { createServerFn } from "@tanstack/react-start";
import {
	createProjectInput,
	getProjectInput,
	inviteMemberInput,
} from "#/types/workspace-schemas";

// Server-only helpers are loaded lazily so the depscanner never walks their
// transitive imports (drizzle, better-auth) for the client environment.
async function helpers() {
	const [{ requireSession }, store] = await Promise.all([
		import("./auth-context.server.ts"),
		import("./workspace-store.server.ts"),
	]);
	return { requireSession, ...store };
}

export const ensureWorkspace = createServerFn({ method: "POST" }).handler(
	async () => {
		const { requireSession, ensurePersonalWorkspace } = await helpers();
		const session = await requireSession();
		const workspaceId = await ensurePersonalWorkspace(
			session.userId,
			session.name,
		);
		return { workspaceId };
	},
);

export const listProjects = createServerFn({ method: "GET" }).handler(
	async () => {
		const {
			requireSession,
			ensurePersonalWorkspace,
			listProjectsForWorkspace,
		} = await helpers();
		const session = await requireSession();
		const workspaceId = await ensurePersonalWorkspace(
			session.userId,
			session.name,
		);
		return listProjectsForWorkspace(workspaceId);
	},
);

export const createProject = createServerFn({ method: "POST" })
	.inputValidator(createProjectInput)
	.handler(async ({ data }) => {
		const {
			requireSession,
			ensurePersonalWorkspace,
			getWorkspaceRole,
			createProjectRow,
		} = await helpers();
		const session = await requireSession();
		const workspaceId =
			data.workspaceId ??
			(await ensurePersonalWorkspace(session.userId, session.name));
		const role = await getWorkspaceRole(session.userId, workspaceId);
		if (!role) throw new Error("Not a member of this workspace");
		return createProjectRow({
			workspaceId,
			title: data.title,
			createdBy: session.userId,
		});
	});

export const getProjectById = createServerFn({ method: "GET" })
	.inputValidator(getProjectInput)
	.handler(async ({ data }) => {
		const { requireSession, getProjectForUser } = await helpers();
		const session = await requireSession();
		const result = await getProjectForUser({
			projectId: data.projectId,
			userId: session.userId,
		});
		if (!result) throw new Error("Project not found");
		return result;
	});

export const inviteMember = createServerFn({ method: "POST" })
	.inputValidator(inviteMemberInput)
	.handler(async ({ data }) => {
		const { requireSession, getWorkspaceRole, addMemberByEmail } =
			await helpers();
		const session = await requireSession();
		const role = await getWorkspaceRole(session.userId, data.workspaceId);
		if (role !== "owner") {
			throw new Error("Only workspace owners can invite members");
		}
		return addMemberByEmail({
			workspaceId: data.workspaceId,
			email: data.email,
			role: data.role,
		});
	});

export const getOrCreateUserWorkspaceDoc = createServerFn({
	method: "POST",
}).handler(async () => {
	const { requireSession, getOrCreatePersonalWorkspaceDocUrl } =
		await helpers();
	const session = await requireSession();
	const automergeDocUrl = await getOrCreatePersonalWorkspaceDocUrl(
		session.userId,
	);
	return { automergeDocUrl };
});
