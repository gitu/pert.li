import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeProjectOverview } from "../overview";
import {
	buildProjectDigest,
	MAX_DIGEST_CHARS,
	MAX_OUTLINE_ITEMS,
} from "../overview-digest";
import type { Estimate, Group, PertDoc, Task, TaskKind } from "../types";
import { createEmptyPertDoc } from "../types";

function task(
	id: string,
	opts: Partial<Task> & { estimate?: Estimate; kind?: TaskKind } = {},
): Task {
	return {
		id,
		kind: opts.kind ?? "task",
		title: opts.title ?? id,
		groupId: opts.groupId ?? null,
		estimate: opts.estimate,
		status: opts.status,
		progress: opts.progress,
		numberOverride: opts.numberOverride,
	};
}

function group(
	id: string,
	name: string,
	parentGroupId: string | null = null,
): Group {
	return { id, name, parentGroupId, order: 0 };
}

function buildDoc(
	tasks: Task[],
	title = "Test project",
	groups: Group[] = [],
): PertDoc {
	const doc = createEmptyPertDoc(title);
	for (const g of groups) doc.groupsById[g.id] = g;
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

const est: Estimate = {
	optimistic: 1,
	mostLikely: 2,
	pessimistic: 3,
	unit: "day",
};

function digestOf(doc: PertDoc): string {
	return buildProjectDigest(doc, computeProjectOverview(doc));
}

describe("buildProjectDigest", () => {
	it("includes the title, key figures and a task outline", () => {
		const doc = buildDoc(
			[
				task("t1", { title: "Design", estimate: est, groupId: "c" }),
				task("m", { kind: "milestone", title: "Kickoff" }),
			],
			"My plan",
			[group("c", "Phase 1")],
		);
		const d = digestOf(doc);
		expect(d).toContain("# My plan");
		expect(d).toContain("## Key figures");
		expect(d).toContain("- Groups: 1");
		expect(d).toContain("## Task outline");
		expect(d).toContain("Phase 1");
		expect(d).toContain("Design");
		expect(d).toContain("Kickoff");
		expect(d).toContain("milestone");
	});

	it("never drops tasks whose group is in a parentGroupId cycle", () => {
		// x → y → x: neither group is reachable from the root walk. Both groups
		// and their member tasks must still appear in the outline.
		const doc = buildDoc(
			[
				task("tx", { title: "In X", estimate: est, groupId: "x" }),
				task("ty", { title: "In Y", estimate: est, groupId: "y" }),
			],
			"Cyclic",
			[group("x", "Group X", "y"), group("y", "Group Y", "x")],
		);
		const d = digestOf(doc);
		expect(d).toContain("Group X");
		expect(d).toContain("Group Y");
		expect(d).toContain("In X");
		expect(d).toContain("In Y");
	});

	it("indents member tasks under their group", () => {
		const doc = buildDoc(
			[task("t1", { title: "Child", estimate: est, groupId: "c" })],
			"Test project",
			[group("c", "Parent")],
		);
		const d = digestOf(doc);
		// The group header sits at the top level; its member is indented (2 spaces).
		expect(d).toMatch(/\n- \*\*.*Parent/);
		expect(d).toMatch(/\n {2}- .*Child/);
	});

	it("lists tasks with a dangling groupId at the root so none are dropped", () => {
		const doc = buildDoc([
			task("root", { title: "Root task", estimate: est }),
			// groupId points at a group that doesn't exist — treated as ungrouped.
			task("orphan", {
				title: "Orphan task",
				estimate: est,
				groupId: "missing-group",
			}),
		]);
		const d = digestOf(doc);
		expect(d).toContain("Root task");
		expect(d).toContain("Orphan task");
	});

	it("notes a cycle instead of fabricating a schedule", () => {
		const doc = buildDoc([
			task("a", { estimate: est }),
			task("b", { estimate: est }),
		]);
		doc.dependenciesById = {
			d1: {
				id: "d1",
				from: { taskId: "a" },
				to: { taskId: "b" },
				type: "finish_to_start",
			},
			d2: {
				id: "d2",
				from: { taskId: "b" },
				to: { taskId: "a" },
				type: "finish_to_start",
			},
		};
		expect(digestOf(doc)).toContain("cycle detected");
	});

	it("truncates the outline past the item cap", () => {
		const tasks = Array.from({ length: MAX_OUTLINE_ITEMS + 25 }, (_, i) =>
			task(`t${i}`, { estimate: est }),
		);
		const d = digestOf(buildDoc(tasks));
		expect(d).toContain("more items (outline truncated)");
		expect(d).toContain("and 25 more");
	});

	it("never exceeds the digest char ceiling", () => {
		const longTitle = "x".repeat(500);
		const tasks = Array.from({ length: 400 }, (_, i) =>
			task(`t${i}`, { title: longTitle, estimate: est }),
		);
		expect(digestOf(buildDoc(tasks)).length).toBeLessThanOrEqual(
			MAX_DIGEST_CHARS + 16,
		);
	});

	// Property: bounded regardless of the doc thrown at it.
	it("stays within the char ceiling for arbitrary docs", () => {
		const arbTask = fc.record({
			id: fc.uuid(),
			title: fc.string({ maxLength: 300 }),
			kind: fc.constantFrom<TaskKind>("task", "milestone"),
		});
		fc.assert(
			fc.property(fc.array(arbTask, { maxLength: 300 }), (raw) => {
				const seen = new Set<string>();
				const tasks: Task[] = [];
				for (const r of raw) {
					if (seen.has(r.id)) continue;
					seen.add(r.id);
					tasks.push(
						task(r.id, { title: r.title, kind: r.kind, estimate: est }),
					);
				}
				expect(digestOf(buildDoc(tasks)).length).toBeLessThanOrEqual(
					MAX_DIGEST_CHARS + 16,
				);
			}),
		);
	});
});
