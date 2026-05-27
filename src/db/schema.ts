import { sql } from "drizzle-orm";
import {
	boolean,
	customType,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

// Drizzle has no first-class `bytea` helper. The neon-http driver returns
// bytea as a Node Buffer; Buffers are also accepted as input parameters,
// which round-trips Uint8Array views fine.
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
	dataType() {
		return "bytea";
	},
	fromDriver(value) {
		return new Uint8Array(value);
	},
	toDriver(value) {
		return Buffer.from(value);
	},
});

// --- Better Auth tables -----------------------------------------------------

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("emailVerified").notNull(),
	image: text("image"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
	// Self-hosted operator role. Promotion is automatic for the first user
	// that signs up (see auth.server.ts databaseHooks). Everyone else stays
	// non-admin until an existing admin flips them in the DB directly. Kept
	// on the user row so Better Auth's session can surface it via
	// `user.additionalFields` without an extra join.
	isAdmin: boolean("isAdmin").notNull().default(false),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expiresAt").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
	ipAddress: text("ipAddress"),
	userAgent: text("userAgent"),
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("accountId").notNull(),
	providerId: text("providerId").notNull(),
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("accessToken"),
	refreshToken: text("refreshToken"),
	idToken: text("idToken"),
	accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
	refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expiresAt").notNull(),
	createdAt: timestamp("createdAt"),
	updatedAt: timestamp("updatedAt"),
});

// --- Workspaces, members, projects -----------------------------------------

export const workspaceRole = pgEnum("workspace_role", [
	"owner",
	"editor",
	"viewer",
]);

export const workspace = pgTable("workspace", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id, { onDelete: "restrict" }),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workspaceMember = pgTable(
	"workspace_member",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: workspaceRole("role").notNull().default("viewer"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("workspace_member_workspace_user_idx").on(
			t.workspaceId,
			t.userId,
		),
	],
);

// Shareable join links. A workspace owner generates a token; anyone who hits
// /join/<token> with a session is added as a member at the link's preset role
// (editor or viewer — owner promotion stays manual). Optional expiry and
// max-uses; manual revoke clears active links without dropping the audit row.
export const workspaceInvitation = pgTable(
	"workspace_invitation",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		token: text("token").notNull().unique(),
		role: workspaceRole("role").notNull().default("editor"),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		expiresAt: timestamp("expires_at"),
		maxUses: integer("max_uses"),
		useCount: integer("use_count").notNull().default(0),
		revokedAt: timestamp("revoked_at"),
	},
	(t) => [index("workspace_invitation_workspace_idx").on(t.workspaceId)],
);

export const project = pgTable("project", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	title: text("title").notNull(),
	automergeDocUrl: text("automerge_doc_url").notNull().unique(),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id, { onDelete: "restrict" }),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	archivedAt: timestamp("archived_at"),
});

// One personal "workspace document" per user — Automerge doc holding pins,
// last-opened project, UI prefs. Lives separately from the org workspaces above.
export const userWorkspaceDoc = pgTable("user_workspace_doc", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	automergeDocUrl: text("automerge_doc_url").notNull().unique(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Automerge document storage. Keys are the `/`-joined StorageKey parts
// from the automerge-repo adapter interface (e.g. `docId/snapshot/<hash>`,
// `docId/incremental/<hash>`, `docId/sync-state/<peerId>`). Range queries
// rely on a btree index for the `key = $p OR key LIKE $p || '/%'` pattern.
export const automergeStorage = pgTable(
	"automerge_storage",
	{
		key: text("key").primaryKey(),
		data: bytea("data").notNull(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(t) => [index("automerge_storage_key_idx").on(t.key)],
);

// Public share links for a single project. A row grants anyone holding the
// token access to one project's Automerge document — read-only or editable,
// optionally bounded by `expiresAt`. Revoking sets `revokedAt`; the row is
// kept for audit/extend rather than being deleted.
export const projectShareMode = pgEnum("project_share_mode", ["view", "edit"]);

export const projectShare = pgTable(
	"project_share",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		token: text("token").notNull().unique(),
		mode: projectShareMode("mode").notNull(),
		expiresAt: timestamp("expires_at"),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		revokedAt: timestamp("revoked_at"),
	},
	(t) => [index("project_share_project_idx").on(t.projectId)],
);

export const auditLog = pgTable("audit_log", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id").references(() => workspace.id, {
		onDelete: "set null",
	}),
	actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
	kind: text("kind").notNull(),
	payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});
