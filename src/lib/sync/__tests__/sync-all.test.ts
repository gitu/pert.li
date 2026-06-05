import type { AutomergeUrl } from "@automerge/automerge-repo";
import { describe, expect, it, vi } from "vitest";
import { syncAllProjects } from "#/lib/sync/sync-all";

// Forge a syntactically-valid-looking Automerge URL for a given seed. The
// controller only treats these as opaque keys, so the exact value is irrelevant
// beyond being distinct.
const url = (seed: string) => `automerge:${seed}` as AutomergeUrl;

describe("syncAllProjects", () => {
	it("finds every project doc across every workspace and returns counts", async () => {
		const find = vi.fn();
		const result = await syncAllProjects({
			listWorkspaces: async () => [
				{ workspaceId: "w1" },
				{ workspaceId: "w2" },
			],
			listProjects: async (id) =>
				id === "w1"
					? [{ automergeDocUrl: url("a") }, { automergeDocUrl: url("b") }]
					: [{ automergeDocUrl: url("c") }],
			find,
		});

		expect(find).toHaveBeenCalledTimes(3);
		expect(find).toHaveBeenCalledWith(url("a"));
		expect(find).toHaveBeenCalledWith(url("b"));
		expect(find).toHaveBeenCalledWith(url("c"));
		expect(result).toEqual({ workspaces: 2, projects: 3 });
	});

	it("dedups a doc URL that surfaces in more than one workspace", async () => {
		const find = vi.fn();
		const result = await syncAllProjects({
			listWorkspaces: async () => [
				{ workspaceId: "w1" },
				{ workspaceId: "w2" },
			],
			// Same doc shared across both workspaces, plus one unique each.
			listProjects: async (id) =>
				id === "w1"
					? [{ automergeDocUrl: url("shared") }, { automergeDocUrl: url("a") }]
					: [{ automergeDocUrl: url("shared") }, { automergeDocUrl: url("b") }],
			find,
		});

		expect(find).toHaveBeenCalledTimes(3);
		expect(find).toHaveBeenCalledWith(url("shared"));
		expect(result).toEqual({ workspaces: 2, projects: 3 });
	});

	it("keeps going when a single find throws (best-effort)", async () => {
		const find = vi.fn((u: AutomergeUrl) => {
			if (u === url("bad")) throw new Error("boom");
		});
		const result = await syncAllProjects({
			listWorkspaces: async () => [{ workspaceId: "w1" }],
			listProjects: async () => [
				{ automergeDocUrl: url("a") },
				{ automergeDocUrl: url("bad") },
				{ automergeDocUrl: url("c") },
			],
			find,
		});

		expect(find).toHaveBeenCalledTimes(3);
		// Still counts the doc as visited even though the nudge threw.
		expect(result).toEqual({ workspaces: 1, projects: 3 });
	});

	it("handles workspaces with no projects", async () => {
		const find = vi.fn();
		const result = await syncAllProjects({
			listWorkspaces: async () => [{ workspaceId: "empty" }],
			listProjects: async () => [],
			find,
		});

		expect(find).not.toHaveBeenCalled();
		expect(result).toEqual({ workspaces: 1, projects: 0 });
	});

	it("handles no accessible workspaces", async () => {
		const find = vi.fn();
		const result = await syncAllProjects({
			listWorkspaces: async () => [],
			listProjects: async () => {
				throw new Error("should not be called");
			},
			find,
		});

		expect(find).not.toHaveBeenCalled();
		expect(result).toEqual({ workspaces: 0, projects: 0 });
	});
});
