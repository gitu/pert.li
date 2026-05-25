import { describe, expect, it } from "vitest";
import { diffSchemas, parseSchema } from "../check-db-back-compat.mjs";

// Two small fixture schemas chosen to exercise the parser shape we care
// about: SQL column names that differ from JS keys (`createdAt: timestamp("created_at")`),
// chained modifiers, second-arg indexes, multi-line column defs.

const BASE_SCHEMA = `
import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  createdAt: timestamp("createdAt").notNull(),
});

export const workspace = pgTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [],
);
`;

describe("parseSchema", () => {
	it("extracts tables with their SQL column names and types", () => {
		const tables = parseSchema(BASE_SCHEMA);
		expect([...tables.keys()].sort()).toEqual(["user", "workspace"]);
		const user = tables.get("user");
		expect(user).toBeDefined();
		expect([...user.entries()]).toEqual([
			["id", "text"],
			["name", "text"],
			["email", "text"],
			["emailVerified", "boolean"],
			["createdAt", "timestamp"],
		]);
	});

	it("works with multi-arg pgTable (columns + index callback)", () => {
		const tables = parseSchema(BASE_SCHEMA);
		const ws = tables.get("workspace");
		expect([...ws.keys()]).toEqual(["id", "slug", "created_at"]);
		expect(ws.get("created_at")).toBe("timestamp");
	});

	it("distinguishes JS keys from SQL column names", () => {
		// `createdAt` (JS) vs `created_at` (SQL): the SQL name is what the
		// running app actually queries, so that's what we track.
		const tables = parseSchema(BASE_SCHEMA);
		expect(tables.get("user").has("createdAt")).toBe(true); // user's SQL name IS "createdAt"
		expect(tables.get("user").has("created_at")).toBe(false);
		expect(tables.get("workspace").has("created_at")).toBe(true); // workspace's SQL name is "created_at"
		expect(tables.get("workspace").has("createdAt")).toBe(false);
	});

	it("skips strings and comments containing pgTable-like text", () => {
		const src = `
      // const fake = pgTable("ignored", { id: text("id") });
      /* pgTable("also_ignored", { id: text("id") }) */
      const note = "pgTable(\\"string_literal\\", { id: text(\\"id\\") })";
      export const real = pgTable("real", { id: text("id").primaryKey() });
    `;
		const tables = parseSchema(src);
		expect([...tables.keys()]).toEqual(["real"]);
	});

	it("returns an empty map for source without any pgTable calls", () => {
		expect(parseSchema("export const x = 1;").size).toBe(0);
	});
});

describe("diffSchemas", () => {
	it("returns no issues when next is a superset of prev", () => {
		const prev = parseSchema(BASE_SCHEMA);
		const NEXT = `${BASE_SCHEMA}\nexport const project = pgTable("project", { id: text("id").primaryKey(), title: text("title").notNull() });\n`;
		const next = parseSchema(NEXT);
		expect(diffSchemas(prev, next)).toEqual([]);
	});

	it("flags a dropped table as a breaking change", () => {
		const NEXT = `
      import { pgTable, text } from "drizzle-orm/pg-core";
      export const user = pgTable("user", {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        email: text("email").notNull().unique(),
        emailVerified: text("emailVerified").notNull(),
        createdAt: text("createdAt").notNull(),
      });
    `;
		const prev = parseSchema(BASE_SCHEMA);
		const next = parseSchema(NEXT);
		const issues = diffSchemas(prev, next);
		// `workspace` dropped + every timestamp/boolean now `text` = 5 issues
		// for user (4 type changes via text↔text remain identical, but the
		// boolean → text and timestamp → text counts).
		const breaking = issues.filter((i) => i.kind === "table-removed");
		expect(breaking).toHaveLength(1);
		expect(breaking[0].table).toBe("workspace");
	});

	it("flags a dropped column as a breaking change", () => {
		const NEXT = BASE_SCHEMA.replace(
			/^\s*email: text\("email"\)\.notNull\(\)\.unique\(\),\s*$/m,
			"",
		);
		const prev = parseSchema(BASE_SCHEMA);
		const next = parseSchema(NEXT);
		const issues = diffSchemas(prev, next);
		const breaking = issues.filter((i) => i.kind === "column-removed");
		expect(breaking).toEqual([
			expect.objectContaining({ table: "user", column: "email" }),
		]);
	});

	it("flags a type change as a (non-fatal) warning", () => {
		const NEXT = BASE_SCHEMA.replace(
			'emailVerified: boolean("emailVerified")',
			'emailVerified: text("emailVerified")',
		);
		const prev = parseSchema(BASE_SCHEMA);
		const next = parseSchema(NEXT);
		const issues = diffSchemas(prev, next);
		const types = issues.filter((i) => i.kind === "column-type-changed");
		expect(types).toEqual([
			expect.objectContaining({
				table: "user",
				column: "emailVerified",
				message: expect.stringContaining("boolean → text"),
			}),
		]);
	});

	it("allows adding tables and adding columns to existing tables", () => {
		const NEXT = `
      import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

      export const user = pgTable("user", {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        email: text("email").notNull().unique(),
        emailVerified: boolean("emailVerified").notNull(),
        createdAt: timestamp("createdAt").notNull(),
        avatarUrl: text("avatar_url"),
      });

      export const workspace = pgTable("workspace", {
        id: text("id").primaryKey(),
        slug: text("slug").notNull().unique(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
      });

      export const teams = pgTable("teams", {
        id: text("id").primaryKey(),
      });
    `;
		const prev = parseSchema(BASE_SCHEMA);
		const next = parseSchema(NEXT);
		expect(diffSchemas(prev, next)).toEqual([]);
	});
});
