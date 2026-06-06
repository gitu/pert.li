import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeProjectOverview } from "../overview";
import {
	buildProjectDigest,
	MAX_DIGEST_CHARS,
	MAX_OUTLINE_ITEMS,
} from "../overview-digest";
import type { Estimate, PertDoc, Task, TaskKind } from "../types";
import { createEmptyPertDoc } from "../types";

function task(
	id: string,
	opts: Partial<Task> & { estimate?: Estimate; kind?: TaskKind } = {},
): Task {
	return {
		id,
		kind: opts.kind ?? "task",
		title: opts.title ?? id,
		parentId: opts.parentId ?? null,
		estimate: opts.estimate,
		status: opts.status,
		progress: opts.progress,
		key: opts.key,
	};
}

function buildDoc(tasks: Task[], title = "Test project"): PertDoc {
	const doc = createEmptyPertDoc(title);
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
				task("c", { kind: "container", title: "Phase 1" }),
				task("t1", { title: "Design", estimate: est, parentId: "c" }),
				task("m", { kind: "milestone", title: "Kickoff" }),
			],
			"My plan",
		);
		const d = digestOf(doc);
		expect(d).toContain("# My plan");
		expect(d).toContain("## Key figures");
		expect(d).toContain("## Task outline");
		expect(d).toContain("Design");
		expect(d).toContain("Kickoff");
		expect(d).toContain("milestone");
	});

	it("indents children under their parent container", () => {
		const doc = buildDoc([
			task("c", { kind: "container", title: "Parent" }),
			task("t1", { title: "Child", estimate: est, parentId: "c" }),
		]);
		const d = digestOf(doc);
		// Child line is indented (two spaces) relative to the top-level container.
		expect(d).toMatch(/\n- \[?.*Parent/);
		expect(d).toMatch(/\n {2}- .*Child/);
	});

	it("promotes tasks with a dangling parentId so none are dropped", () => {
		const doc = buildDoc([
			task("root", { title: "Root task", estimate: est }),
			// parentId points at a task that doesn't exist — unreachable from root.
			task("orphan", {
				title: "Orphan task",
				estimate: est,
				parentId: "missing-parent",
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
		expect(d).toContain("more tasks (outline truncated)");
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
			kind: fc.constantFrom<TaskKind>("task", "milestone", "container"),
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
