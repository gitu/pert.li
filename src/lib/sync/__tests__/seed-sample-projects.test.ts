import type { Repo } from "@automerge/automerge-repo";
import { beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_PROJECTS } from "#/lib/pert/sample-projects";
import { pertDoc } from "#/lib/pert/zod-schemas";
import {
	__resetPendingForTests,
	getPendingSnapshot,
} from "#/lib/sync/pending-projects";
import { seedSampleProject } from "#/lib/sync/seed-sample-projects";
import { shouldSeed } from "#/lib/sync/use-seed-sample-projects";

// A minimal Repo stand-in: seedSampleProject only ever calls repo.create().
function stubRepo(url: string): Repo {
	return {
		create: () => ({ url }),
	} as unknown as Repo;
}

describe("seedSampleProject", () => {
	beforeEach(() => {
		__resetPendingForTests();
	});

	it("queues a pending project with the doc's url and title", async () => {
		const repo = stubRepo("automerge:abc123");
		const localId = await seedSampleProject(
			repo,
			SAMPLE_PROJECTS[0].create(),
			"My sample",
			"ws-1",
		);

		const snapshot = getPendingSnapshot();
		expect(snapshot).toHaveLength(1);
		const rec = snapshot[0];
		expect(rec.localId).toBe(localId);
		expect(rec.title).toBe("My sample");
		expect(rec.automergeDocUrl).toBe("automerge:abc123");
		expect(rec.workspaceId).toBe("ws-1");
		expect(rec.status).toBe("pending");
	});

	it("omits workspaceId when not provided", async () => {
		const localId = await seedSampleProject(
			stubRepo("automerge:def456"),
			SAMPLE_PROJECTS[0].create(),
			"No workspace",
		);
		const rec = getPendingSnapshot().find((p) => p.localId === localId);
		expect(rec?.workspaceId).toBeUndefined();
	});
});

describe("SAMPLE_PROJECTS registry", () => {
	it("each entry creates a valid doc whose title matches", () => {
		expect(SAMPLE_PROJECTS.length).toBeGreaterThanOrEqual(2);
		for (const sample of SAMPLE_PROJECTS) {
			const doc = sample.create();
			expect(doc.title).toBe(sample.title);
			expect(pertDoc.safeParse(doc).success).toBe(true);
		}
	});

	it("titles are unique", () => {
		const titles = SAMPLE_PROJECTS.map((s) => s.title);
		expect(new Set(titles).size).toBe(titles.length);
	});
});

describe("shouldSeed", () => {
	const base = {
		repoPresent: true,
		projectsSettled: true,
		projectCount: 0,
		workspaceHandled: false,
	};

	it("seeds an empty, settled workspace with a repo", () => {
		expect(shouldSeed(base)).toBe(true);
	});

	it("does not seed a workspace already handled", () => {
		expect(shouldSeed({ ...base, workspaceHandled: true })).toBe(false);
	});

	it("does not seed without a repo", () => {
		expect(shouldSeed({ ...base, repoPresent: false })).toBe(false);
	});

	it("does not seed before the projects query settles", () => {
		expect(shouldSeed({ ...base, projectsSettled: false })).toBe(false);
	});

	it("does not seed a non-empty workspace", () => {
		expect(shouldSeed({ ...base, projectCount: 1 })).toBe(false);
	});
});
