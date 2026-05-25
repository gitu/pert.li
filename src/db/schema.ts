import { sql } from "drizzle-orm";
import {
	boolean,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

// --- Better Auth tables -----------------------------------------------------

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("emailVerified").notNull(),
	image: text("image"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
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
