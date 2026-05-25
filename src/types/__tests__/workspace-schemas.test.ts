import { describe, expect, it } from "vitest";
import {
	createProjectInput,
	getProjectInput,
	inviteMemberInput,
} from "../workspace-schemas";

describe("createProjectInput", () => {
	it("accepts a trimmed, non-empty title and optional workspaceId", () => {
		const parsed = createProjectInput.parse({ title: "  Plan A  " });
		expect(parsed.title).toBe("Plan A");
		expect(parsed.workspaceId).toBeUndefined();
	});

	it("rejects empty / whitespace-only titles", () => {
		expect(() => createProjectInput.parse({ title: "" })).toThrow();
		expect(() => createProjectInput.parse({ title: "   " })).toThrow();
	});

	it("caps title length at 120 chars", () => {
		expect(() =>
			createProjectInput.parse({ title: "a".repeat(121) }),
		).toThrow();
		expect(() =>
			createProjectInput.parse({ title: "a".repeat(120) }),
		).not.toThrow();
	});

	it("rejects non-uuid workspaceId", () => {
		expect(() =>
			createProjectInput.parse({ title: "ok", workspaceId: "not-a-uuid" }),
		).toThrow();
		expect(() =>
			createProjectInput.parse({
				title: "ok",
				workspaceId: "00000000-0000-4000-8000-000000000000",
			}),
		).not.toThrow();
	});
});

describe("getProjectInput", () => {
	it("requires a uuid", () => {
		expect(() => getProjectInput.parse({ projectId: "abc" })).toThrow();
		expect(() =>
			getProjectInput.parse({
				projectId: "00000000-0000-4000-8000-000000000000",
			}),
		).not.toThrow();
	});
});

describe("inviteMemberInput", () => {
	const workspaceId = "00000000-0000-4000-8000-000000000000";

	it("lowercases + trims the email", () => {
		const parsed = inviteMemberInput.parse({
			workspaceId,
			email: "  PERSON@Example.COM ",
		});
		expect(parsed.email).toBe("person@example.com");
	});

	it("defaults role to editor", () => {
		const parsed = inviteMemberInput.parse({
			workspaceId,
			email: "a@b.io",
		});
		expect(parsed.role).toBe("editor");
	});

	it("accepts owner/editor/viewer and rejects others", () => {
		for (const role of ["owner", "editor", "viewer"] as const) {
			expect(() =>
				inviteMemberInput.parse({ workspaceId, email: "a@b.io", role }),
			).not.toThrow();
		}
		expect(() =>
			inviteMemberInput.parse({
				workspaceId,
				email: "a@b.io",
				role: "admin",
			}),
		).toThrow();
	});

	it("rejects malformed emails", () => {
		expect(() =>
			inviteMemberInput.parse({ workspaceId, email: "not-an-email" }),
		).toThrow();
	});
});
