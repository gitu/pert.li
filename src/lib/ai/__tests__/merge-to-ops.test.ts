import { describe, expect, it } from "vitest";
import { applyOperations } from "#/lib/ai/apply-operations";
import {
	mergeSelectionToOps,
	type ResolvedMergeChange,
} from "#/lib/ai/merge-to-ops";
import { computeMerge } from "#/lib/pert/merge";
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

function leaf(id: string, title: string, e?: Estimate): Task {
	return {
		id,
		kind: "task",
		title,
		parentId: null,
		estimate: e ?? est(1, 2, 3),
	};
}

function build(...tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("d");
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

function clone(doc: PertDoc): PertDoc {
	return JSON.parse(JSON.stringify(doc)) as PertDoc;
}

function resolveAll(
	changes: ReturnType<typeof computeMerge>["changes"],
	side: "branch" | "main",
): ResolvedMergeChange[] {
	return changes.map(
		(c) => ({ ...c, resolution: side }) as ResolvedMergeChange,
	);
}

describe("mergeSelectionToOps", () => {
	it("produces set_title for an accepted clean title change", () => {
		const base = build(leaf("A", "Alpha"));
		const main = clone(base);
		const branch = build(leaf("A", "Alpha v2"));
		const merge = computeMerge({ base, main, branch });
		const ops = mergeSelectionToOps(resolveAll(merge.changes, "branch"));
		expect(ops).toEqual([{ op: "set_title", taskId: "A", title: "Alpha v2" }]);
	});

	it("produces nothing when the user keeps main on every conflict", () => {
		const base = build(leaf("A", "Alpha"));
		const main = build(leaf("A", "MainTitle"));
		const branch = build(leaf("A", "BranchTitle"));
		const merge = computeMerge({ base, main, branch });
		const ops = mergeSelectionToOps(resolveAll(merge.changes, "main"));
		expect(ops).toEqual([]);
	});

	it("emits add_task + follow-up ops when accepting a clean add", () => {
		const base = build(leaf("A", "Alpha"));
		const main = clone(base);
		const newTask: Task = {
			id: "C",
			kind: "task",
			title: "Charlie",
			parentId: null,
			estimate: est(2, 4, 6),
			notes: "added on branch",
			status: "in_progress",
			progress: 50,
		};
		const branch = build(leaf("A", "Alpha"), newTask);
		const merge = computeMerge({ base, main, branch });
		const ops = mergeSelectionToOps(resolveAll(merge.changes, "branch"));
		// One add_task plus the follow-ups for notes/status/progress.
		expect(ops[0].op).toBe("add_task");
		expect(ops.some((o) => o.op === "set_notes")).toBe(true);
		expect(ops.some((o) => o.op === "set_status")).toBe(true);
		expect(ops.some((o) => o.op === "set_progress")).toBe(true);
	});

	it("round-trips: applying accepted ops to main reaches branch's value on the touched field", () => {
		const base = build(leaf("A", "Alpha", est(1, 2, 3)));
		const main = clone(base);
		const branch = build(leaf("A", "Alpha", est(2, 4, 8)));
		const merge = computeMerge({ base, main, branch });
		const ops = mergeSelectionToOps(resolveAll(merge.changes, "branch"));
		const applied = clone(main);
		const results = applyOperations(applied, ops);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(applied.tasksById.A.estimate).toEqual(branch.tasksById.A.estimate);
	});

	it("emits remove_task for an accepted clean-remove-from-branch", () => {
		const base = build(leaf("A", "Alpha"), leaf("B", "Beta"));
		const main = clone(base);
		const branch = build(leaf("A", "Alpha"));
		const merge = computeMerge({ base, main, branch });
		const ops = mergeSelectionToOps(resolveAll(merge.changes, "branch"));
		expect(ops).toEqual([{ op: "remove_task", taskId: "B" }]);
	});
});
