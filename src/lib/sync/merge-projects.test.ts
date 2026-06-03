import type { AutomergeUrl } from "@automerge/automerge-repo";
import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "#/types/workspace";
import { mergeProjectLists, pendingToSummary } from "./merge-projects";
import type { PendingProject } from "./pending-projects";

const url = (s: string) => `automerge:${s}` as AutomergeUrl;

function server(id: string, docUrl: string): ProjectSummary {
	return {
		id,
		workspaceId: "ws",
		title: `server-${id}`,
		description: null,
		automergeDocUrl: url(docUrl),
		createdAt: "2026-01-01T00:00:00.000Z",
		createdBy: "u",
		parentProjectId: null,
		branchedFromHeads: null,
		branchedAt: null,
		archivedAt: null,
	};
}

function pending(
	localId: string,
	docUrl: string,
	over: Partial<PendingProject> = {},
): PendingProject {
	return {
		localId,
		title: `local-${localId}`,
		automergeDocUrl: url(docUrl),
		createdAt: "2026-02-01T00:00:00.000Z",
		status: "pending",
		attempts: 0,
		...over,
	};
}

describe("mergeProjectLists", () => {
	it("prepends unsynced local projects ahead of the server list", () => {
		const merged = mergeProjectLists(
			[server("s1", "doc-s1")],
			[pending("l1", "doc-l1")],
		);
		expect(merged.map((p) => p.id)).toEqual(["l1", "s1"]);
	});

	it("dedupes by doc URL — a registered project that's already in the server list isn't doubled", () => {
		const merged = mergeProjectLists(
			[server("s1", "shared-doc")],
			[pending("l1", "shared-doc", { status: "registered", serverId: "s1" })],
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].id).toBe("s1");
	});

	it("uses the server id for a registered-but-not-yet-listed local project", () => {
		const s = pendingToSummary(
			pending("l1", "doc-l1", { status: "registered", serverId: "srv-9" }),
		);
		expect(s.id).toBe("srv-9");
	});

	it("falls back to the localId before registration", () => {
		expect(pendingToSummary(pending("l1", "doc-l1")).id).toBe("l1");
	});

	it("scopes pending to the active workspace; unassigned ones stay visible", () => {
		const merged = mergeProjectLists(
			[],
			[
				pending("a", "doc-a", { workspaceId: "ws-A" }),
				pending("b", "doc-b", { workspaceId: "ws-B" }),
				pending("c", "doc-c"), // no explicit workspace
			],
			"ws-A",
		);
		const ids = merged.map((p) => p.id);
		expect(ids).toContain("a"); // matches the active workspace
		expect(ids).toContain("c"); // unassigned → shown everywhere
		expect(ids).not.toContain("b"); // belongs to another workspace → hidden
	});

	it("shows every pending record when no active workspace is provided", () => {
		const merged = mergeProjectLists(
			[],
			[pending("a", "doc-a", { workspaceId: "ws-A" })],
		);
		expect(merged.map((p) => p.id)).toContain("a");
	});
});
