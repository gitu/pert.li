import { describe, expect, it } from "vitest";
import { diffPertDoc } from "#/lib/pert/diff";
import {
	createEmptyPertDoc,
	type Estimate,
	type PertDoc,
	type Task,
} from "#/lib/pert/types";

const est = (o: number, m: number, p: number): Estimate => ({
	optimistic: o,
	mostLikely: m,
	pessimistic: p,
	unit: "day",
});

function build(...tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("d");
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

function leaf(
	id: string,
	title: string,
	e: Estimate | undefined = est(1, 2, 3),
): Task {
	return { id, kind: "task", title, parentId: null, estimate: e };
}

describe("diffPertDoc", () => {
	it("returns zero counts for identical docs", () => {
		const a = build(leaf("A", "A"), leaf("B", "B"));
		const b = build(leaf("A", "A"), leaf("B", "B"));
		const diff = diffPertDoc(a, b);
		expect(diff.tasks).toEqual([]);
		expect(diff.dependencies).toEqual([]);
		expect(diff.counts).toEqual({
			tasksAdded: 0,
			tasksRemoved: 0,
			tasksChanged: 0,
			depsAdded: 0,
			depsRemoved: 0,
			depsChanged: 0,
		});
	});

	it("flags added, removed, and changed tasks", () => {
		const before = build(leaf("A", "Alpha"), leaf("B", "Beta"));
		const after = build(leaf("A", "Alpha v2"), leaf("C", "Gamma"));
		const diff = diffPertDoc(before, after);
		expect(diff.counts).toEqual(
			expect.objectContaining({
				tasksAdded: 1,
				tasksRemoved: 1,
				tasksChanged: 1,
			}),
		);
		const a = diff.tasks.find((t) => t.id === "A");
		expect(a?.kind).toBe("changed");
		expect(a?.fields).toEqual([
			{ field: "title", before: "Alpha", after: "Alpha v2" },
		]);
		expect(diff.tasks.find((t) => t.id === "B")?.kind).toBe("removed");
		expect(diff.tasks.find((t) => t.id === "C")?.kind).toBe("added");
	});

	it("detects estimate edits but ignores layout positions", () => {
		const before = build(leaf("A", "Task", est(1, 2, 3)));
		before.tasksById.A.layout = { position: { x: 0, y: 0 } };
		const after = build(leaf("A", "Task", est(2, 4, 6)));
		after.tasksById.A.layout = { position: { x: 200, y: 100 } };
		const diff = diffPertDoc(before, after);
		expect(diff.tasks).toHaveLength(1);
		expect(diff.tasks[0].fields).toEqual([
			{
				field: "estimate",
				before: est(1, 2, 3),
				after: est(2, 4, 6),
			},
		]);
	});

	it("captures dependency adds, removes, and re-typing", () => {
		const before = build(leaf("A", "A"), leaf("B", "B"), leaf("C", "C"));
		before.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "finish_to_start",
		};
		before.dependenciesById.bc = {
			id: "bc",
			from: { taskId: "B" },
			to: { taskId: "C" },
			type: "finish_to_start",
		};
		const after = build(leaf("A", "A"), leaf("B", "B"), leaf("C", "C"));
		// ab: type change
		after.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "start_to_start",
		};
		// bc removed; ac added
		after.dependenciesById.ac = {
			id: "ac",
			from: { taskId: "A" },
			to: { taskId: "C" },
			type: "finish_to_start",
		};
		const diff = diffPertDoc(before, after);
		expect(diff.counts).toEqual(
			expect.objectContaining({
				depsAdded: 1,
				depsRemoved: 1,
				depsChanged: 1,
			}),
		);
	});

	it("sorts tasks added → changed → removed, alphabetically within each", () => {
		const before = build(leaf("Z", "Zeta"), leaf("M", "Mu"));
		const after = build(leaf("M", "Mu prime"), leaf("A", "Alpha"));
		const diff = diffPertDoc(before, after);
		expect(diff.tasks.map((t) => `${t.kind}:${t.id}`)).toEqual([
			"added:A",
			"changed:M",
			"removed:Z",
		]);
	});
});
