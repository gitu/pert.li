import { createServerFn } from "@tanstack/react-start";
import { fromExchange } from "#/lib/pert/exchange";
import {
	createJoinLinkInput,
	createProjectInput,
	createShareInput,
	createWorkspaceInput,
	extendShareInput,
	getProjectInput,
	importProjectInput,
	inviteMemberInput,
	joinTokenInput,
	listJoinLinksInput,
	listProjectsInput,
	listSharesInput,
	resolveShareInput,
	revokeJoinLinkInput,
	shareIdInput,
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

async function shareHelpers() {
	const [{ requireSession }, store] = await Promise.all([
		import("./auth-context.server.ts"),
		import("./project-share-store.server.ts"),
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

export const listProjects = createServerFn({ method: "GET" })
	.inputValidator(listProjectsInput)
	.handler(async ({ data }) => {
		const {
			requireSession,
			ensurePersonalWorkspace,
			getWorkspaceRole,
			listProjectsForWorkspace,
		} = await helpers();
		const session = await requireSession();
		// Without an explicit workspaceId we fall back to the user's personal
		// workspace (auto-created on first call). With one, we check membership
		// so passing a foreign id can't expose another workspace's projects.
		const workspaceId = data?.workspaceId
			? data.workspaceId
			: await ensurePersonalWorkspace(session.userId, session.name);
		if (data?.workspaceId) {
			const role = await getWorkspaceRole(session.userId, workspaceId);
			if (!role) throw new Error("Not a member of this workspace");
		}
		return listProjectsForWorkspace(workspaceId);
	});

export const createWorkspace = createServerFn({ method: "POST" })
	.inputValidator(createWorkspaceInput)
	.handler(async ({ data }) => {
		const { requireSession, createWorkspaceForUser } = await helpers();
		const session = await requireSession();
		return createWorkspaceForUser({
			userId: session.userId,
			name: data.name,
		});
	});

export const listMyWorkspaces = createServerFn({ method: "GET" }).handler(
	async () => {
		const { requireSession, ensurePersonalWorkspace, listMembershipsForUser } =
			await helpers();
		const session = await requireSession();
		// Touch the personal workspace so first-time visitors always see at
		// least one entry — same lazy-create behaviour as listProjects.
		await ensurePersonalWorkspace(session.userId, session.name);
		return listMembershipsForUser(session.userId);
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

// Same auth + workspace logic as `createProject`, but seeds the new doc from
// a validated PertExchange payload instead of starting empty. The exchange
// schema runs in `importProjectInput`, so by the time we reach the handler
// the payload is guaranteed well-formed.
export const importProject = createServerFn({ method: "POST" })
	.inputValidator(importProjectInput)
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
		const title = (data.title ?? data.exchange.title).trim();
		if (!title) throw new Error("Project title is required");
		const initialDoc = fromExchange(data.exchange, { title });
		return createProjectRow({
			workspaceId,
			title,
			createdBy: session.userId,
			initialDoc,
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

// ----- Shareable workspace join links ---------------------------------------

export const createJoinLink = createServerFn({ method: "POST" })
	.inputValidator(createJoinLinkInput)
	.handler(async ({ data }) => {
		const { requireSession, getWorkspaceRole, createWorkspaceInvitation } =
			await helpers();
		const session = await requireSession();
		const role = await getWorkspaceRole(session.userId, data.workspaceId);
		if (role !== "owner") {
			throw new Error("Only workspace owners can create join links");
		}
		return createWorkspaceInvitation({
			workspaceId: data.workspaceId,
			createdBy: session.userId,
			role: data.role,
			expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
			maxUses: data.maxUses ?? null,
		});
	});

export const listJoinLinks = createServerFn({ method: "POST" })
	.inputValidator(listJoinLinksInput)
	.handler(async ({ data }) => {
		const { requireSession, getWorkspaceRole, listWorkspaceInvitations } =
			await helpers();
		const session = await requireSession();
		const role = await getWorkspaceRole(session.userId, data.workspaceId);
		if (role !== "owner") {
			throw new Error("Only workspace owners can manage join links");
		}
		return listWorkspaceInvitations(data.workspaceId);
	});

export const revokeJoinLink = createServerFn({ method: "POST" })
	.inputValidator(revokeJoinLinkInput)
	.handler(async ({ data }) => {
		const { requireSession, getWorkspaceRole, revokeWorkspaceInvitation } =
			await helpers();
		const session = await requireSession();
		const role = await getWorkspaceRole(session.userId, data.workspaceId);
		if (role !== "owner") {
			throw new Error("Only workspace owners can revoke join links");
		}
		return revokeWorkspaceInvitation({
			invitationId: data.invitationId,
			workspaceId: data.workspaceId,
		});
	});

// Public — used by the /join/$token landing page before the user is signed
// in. Returns just the workspace name + status, never anything sensitive.
export const getJoinLinkPreview = createServerFn({ method: "GET" })
	.inputValidator(joinTokenInput)
	.handler(async ({ data }) => {
		const { getInvitationPreviewByToken } = await helpers();
		return getInvitationPreviewByToken(data.token);
	});

export const acceptJoinLink = createServerFn({ method: "POST" })
	.inputValidator(joinTokenInput)
	.handler(async ({ data }) => {
		const { requireSession, acceptInvitationByToken } = await helpers();
		const session = await requireSession();
		return acceptInvitationByToken({
			token: data.token,
			userId: session.userId,
		});
	});

// --- Per-project share links -----------------------------------------------

export const createProjectShare = createServerFn({ method: "POST" })
	.inputValidator(createShareInput)
	.handler(async ({ data }) => {
		const { requireSession, assertProjectShareAdmin, createShare } =
			await shareHelpers();
		const session = await requireSession();
		await assertProjectShareAdmin({
			projectId: data.projectId,
			userId: session.userId,
		});
		return createShare({
			projectId: data.projectId,
			mode: data.mode,
			expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
			createdBy: session.userId,
		});
	});

export const listProjectShares = createServerFn({ method: "GET" })
	.inputValidator(listSharesInput)
	.handler(async ({ data }) => {
		const { requireSession, assertProjectAccess, listSharesForProject } =
			await shareHelpers();
		const session = await requireSession();
		await assertProjectAccess({
			projectId: data.projectId,
			userId: session.userId,
		});
		return listSharesForProject(data.projectId);
	});

export const revokeProjectShare = createServerFn({ method: "POST" })
	.inputValidator(shareIdInput)
	.handler(async ({ data }) => {
		const { requireSession, revokeShare } = await shareHelpers();
		const session = await requireSession();
		await revokeShare({ shareId: data.shareId, userId: session.userId });
		return { ok: true };
	});

export const extendProjectShare = createServerFn({ method: "POST" })
	.inputValidator(extendShareInput)
	.handler(async ({ data }) => {
		const { requireSession, extendShare } = await shareHelpers();
		const session = await requireSession();
		return extendShare({
			shareId: data.shareId,
			expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
			userId: session.userId,
		});
	});

// Public — no auth gate. Resolves a share token into doc info for the
// /share/$token route's loader. Returns `null` for missing/expired/revoked
// tokens so the route can render a generic "invalid link" message.
export const resolveProjectShare = createServerFn({ method: "GET" })
	.inputValidator(resolveShareInput)
	.handler(async ({ data }) => {
		const { resolveShareByToken } = await shareHelpers();
		return resolveShareByToken(data.token);
	});
