import { describe, expect, it } from "vitest";
import { applyOperations } from "#/lib/ai/apply-operations";
import {
	mergeSelectionToOps,
	planMergeOps,
	type ResolvedMergeChange,
} from "#/lib/ai/merge-to-ops";
import type { EditOp } from "#/lib/ai/operations";
import { computeMerge } from "#/lib/pert/merge";
import {
	createEmptyPertDoc,
	type Dependency,
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

	it("translates a groupId change into move_task_to_group", () => {
		const base = build(leaf("A", "Alpha"));
		const main = clone(base);
		const branch = build({ ...leaf("A", "Alpha"), groupId: "g1" });
		const merge = computeMerge({ base, main, branch });
		const ops = mergeSelectionToOps(resolveAll(merge.changes, "branch"));
		expect(ops).toEqual([
			{ op: "move_task_to_group", taskId: "A", groupId: "g1" },
		]);
	});

	it("translates a numberOverride change into set_task_number", () => {
		const base = build(leaf("A", "Alpha"));
		const main = clone(base);
		const branch = build({ ...leaf("A", "Alpha"), numberOverride: "M1.A" });
		const merge = computeMerge({ base, main, branch });
		const ops = mergeSelectionToOps(resolveAll(merge.changes, "branch"));
		expect(ops).toEqual([
			{ op: "set_task_number", taskId: "A", number: "M1.A" },
		]);
	});
});

// Build a dependency. Default finish-to-start, the same shape addDependency
// produces, so round-tripped deps compare equal.
function dep(
	id: string,
	from: string,
	to: string,
	extra?: Partial<Dependency>,
): Dependency {
	return {
		id,
		from: { taskId: from, port: "finish" },
		to: { taskId: to, port: "start" },
		type: "finish_to_start",
		...extra,
	};
}

function withDeps(doc: PertDoc, ...deps: Dependency[]): PertDoc {
	for (const d of deps) doc.dependenciesById[d.id] = d;
	return doc;
}

function child(id: string, title: string, groupId: string): Task {
	return { id, kind: "task", title, groupId, estimate: est(1, 2, 3) };
}

// Asserts no dependency in the doc points at a task that no longer exists — the
// invariant a merge must preserve when tasks are dropped on either side.
function expectNoDanglingDeps(doc: PertDoc): void {
	for (const d of Object.values(doc.dependenciesById)) {
		if (d.from.taskId) expect(doc.tasksById[d.from.taskId]).toBeDefined();
		if (d.to.taskId) expect(doc.tasksById[d.to.taskId]).toBeDefined();
	}
}

// Full pipeline a real merge runs: classify → resolve → ops → sanitise against
// the target → apply to a clone of the target. Returns everything a scenario
// might want to assert on.
function runMerge(
	base: PertDoc,
	main: PertDoc,
	branch: PertDoc,
	side: "branch" | "main" = "branch",
) {
	const merge = computeMerge({ base, main, branch });
	const rawOps = mergeSelectionToOps(resolveAll(merge.changes, side));
	const { ops, dropped } = planMergeOps(rawOps, main);
	const applied = clone(main);
	const results = applyOperations(applied, ops);
	return { merge, rawOps, ops, dropped, applied, results };
}

describe("planMergeOps", () => {
	it("passes a clean op batch through untouched", () => {
		const doc = withDeps(
			build(leaf("A", "Alpha"), leaf("B", "Beta")),
			dep("ab", "A", "B"),
		);
		const ops = [{ op: "set_title", taskId: "A", title: "Alpha v2" }] as const;
		const r = planMergeOps([...ops], doc);
		expect(r.ops).toEqual(ops);
		expect(r.dropped).toEqual([]);
	});

	it("drops a remove_dependency the preceding remove_task already cascades", () => {
		const doc = withDeps(
			build(leaf("A", "Alpha"), leaf("B", "Beta")),
			dep("ab", "A", "B"),
		);
		const r = planMergeOps(
			[
				{ op: "remove_task", taskId: "B" },
				{ op: "remove_dependency", dependencyId: "ab" },
			],
			doc,
		);
		expect(r.ops).toEqual([{ op: "remove_task", taskId: "B" }]);
		expect(r.dropped).toEqual([
			{ op: "remove_dependency", dependencyId: "ab" },
		]);
	});

	it("drops an add_dependency whose endpoint task is missing on the target", () => {
		const doc = build(leaf("A", "Alpha")); // no B
		const r = planMergeOps(
			[{ op: "add_dependency", id: "ab", fromTaskId: "A", toTaskId: "B" }],
			doc,
		);
		expect(r.ops).toEqual([]);
		expect(r.dropped).toHaveLength(1);
	});

	it("keeps an add_dependency whose endpoint is added earlier in the batch", () => {
		const doc = build(leaf("A", "Alpha"));
		const ops: EditOp[] = [
			{ op: "add_task", id: "B", title: "Beta", kind: "task" },
			{ op: "add_dependency", id: "ab", fromTaskId: "A", toTaskId: "B" },
		];
		const r = planMergeOps([...ops], doc);
		expect(r.ops).toEqual(ops);
		expect(r.dropped).toEqual([]);
	});

	it("drops set_dependency follow-ups orphaned by a dropped add", () => {
		const doc = build(leaf("A", "Alpha")); // no B → the add can't land
		const ops: EditOp[] = [
			{ op: "add_dependency", id: "ab", fromTaskId: "A", toTaskId: "B" },
			{ op: "set_dependency", dependencyId: "ab", lagDays: 5 },
		];
		const r = planMergeOps(ops, doc);
		expect(r.ops).toEqual([]);
		expect(r.dropped.map((o) => o.op)).toEqual([
			"add_dependency",
			"set_dependency",
		]);
	});

	it("keeps set_dependency follow-ups when the add lands", () => {
		const doc = build(leaf("A", "Alpha"), leaf("B", "Beta"));
		const ops: EditOp[] = [
			{ op: "add_dependency", id: "ab", fromTaskId: "A", toTaskId: "B" },
			{ op: "set_dependency", dependencyId: "ab", lagDays: 5 },
		];
		const r = planMergeOps([...ops], doc);
		expect(r.ops).toEqual(ops);
		expect(r.dropped).toEqual([]);
	});

	it("drops set_dependency when remove_task cascades the dep", () => {
		const doc = withDeps(
			build(leaf("A", "Alpha"), leaf("B", "Beta")),
			dep("ab", "A", "B"),
		);
		const ops: EditOp[] = [
			{ op: "remove_task", taskId: "B" }, // cascades ab
			{ op: "set_dependency", dependencyId: "ab", lagDays: 2 },
		];
		const r = planMergeOps(ops, doc);
		expect(r.ops).toEqual([{ op: "remove_task", taskId: "B" }]);
		expect(r.dropped.map((o) => o.op)).toEqual(["set_dependency"]);
	});

	it("returns empty for an empty batch", () => {
		expect(planMergeOps([], build(leaf("A", "Alpha")))).toEqual({
			ops: [],
			dropped: [],
		});
	});
});

describe("dropped-task merges", () => {
	// 1. Branch drops a task that had a dependency. The cascade-removed dep
	// surfaces as its own remove row; planMergeOps must drop the redundant op.
	it("merges a branch that dropped a task with a dependency without failing", () => {
		const base = withDeps(
			build(leaf("A", "Alpha"), leaf("B", "Beta")),
			dep("ab", "A", "B"),
		);
		const main = clone(base);
		const branch = build(leaf("A", "Alpha")); // B + ab cascade-removed
		const { ops, dropped, applied, results } = runMerge(base, main, branch);
		expect(ops).toEqual([{ op: "remove_task", taskId: "B" }]);
		expect(dropped.map((o) => o.op)).toEqual(["remove_dependency"]);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(applied.tasksById.B).toBeUndefined();
		expect(applied.dependenciesById.ab).toBeUndefined();
		expectNoDanglingDeps(applied);
	});

	// 2. Branch adds a dependency to a task main dropped after the fork. The
	// add is impossible; the branch's surviving edit still lands.
	it("drops an add_dependency to a main-dropped task but keeps the rest", () => {
		const base = build(leaf("A", "Alpha"), leaf("B", "Beta"));
		const main = build(leaf("A", "Alpha")); // main dropped B
		const branch = withDeps(
			build(leaf("A", "Alpha v2"), leaf("B", "Beta")),
			dep("ab", "A", "B"),
		);
		const { ops, dropped, applied, results } = runMerge(base, main, branch);
		expect(ops).toEqual([{ op: "set_title", taskId: "A", title: "Alpha v2" }]);
		expect(dropped.map((o) => o.op)).toEqual(["add_dependency"]);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(applied.tasksById.A.title).toBe("Alpha v2");
		expect(applied.dependenciesById.ab).toBeUndefined();
		expectNoDanglingDeps(applied);
	});

	// 2b. Same, but the branch's new dependency carried a lagDays — so the add
	// is followed by a set_dependency. Both must drop together, or the orphaned
	// set_dependency aborts the dry-run with "dependency not found".
	it("drops a lagDays dependency and its set_dependency follow-up together", () => {
		const base = build(leaf("A", "Alpha"), leaf("B", "Beta"));
		const main = build(leaf("A", "Alpha")); // main dropped B
		const branch = withDeps(
			build(leaf("A", "Alpha v2"), leaf("B", "Beta")),
			dep("ab", "A", "B", { lagDays: 5 }),
		);
		const { ops, dropped, applied, results } = runMerge(base, main, branch);
		expect(ops).toEqual([{ op: "set_title", taskId: "A", title: "Alpha v2" }]);
		expect(dropped.map((o) => o.op).sort()).toEqual([
			"add_dependency",
			"set_dependency",
		]);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(applied.dependenciesById.ab).toBeUndefined();
		expectNoDanglingDeps(applied);
	});

	// 3. Branch drops a task; main modified a dependency on it
	// (conflict-removed-vs-modified). Accepting branch removes both.
	it("resolves conflict-removed-vs-modified to branch without a dangling dep", () => {
		const base = withDeps(
			build(leaf("A", "Alpha"), leaf("B", "Beta")),
			dep("ab", "A", "B"),
		);
		const main = withDeps(
			build(leaf("A", "Alpha"), leaf("B", "Beta")),
			dep("ab", "A", "B", { lagDays: 3 }), // main tweaked the dep
		);
		const branch = build(leaf("A", "Alpha")); // branch dropped B + ab
		const { ops, applied, results } = runMerge(base, main, branch);
		expect(ops).toEqual([{ op: "remove_task", taskId: "B" }]);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(applied.tasksById.B).toBeUndefined();
		expect(applied.dependenciesById.ab).toBeUndefined();
		expectNoDanglingDeps(applied);
	});

	// 4. Branch deletes a group; its members are ungrouped. The merge sees this
	// as a groupId field change on each member (groups themselves aren't diffed).
	it("merges members ungrouped on the branch via move_task_to_group", () => {
		const base = build(child("A", "Alpha", "P"), child("B", "Beta", "P"));
		const main = clone(base);
		// Deleting group P in the branch ungroups the members (groupId → null).
		const branch = build(
			{ ...child("A", "Alpha", "P"), groupId: null },
			{ ...child("B", "Beta", "P"), groupId: null },
		);
		const { ops, applied, results } = runMerge(base, main, branch);
		expect(ops).toEqual([
			{ op: "move_task_to_group", taskId: "A", groupId: null },
			{ op: "move_task_to_group", taskId: "B", groupId: null },
		]);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(applied.tasksById.A.groupId).toBeNull();
		expect(applied.tasksById.B.groupId).toBeNull();
	});

	// 5. Both sides dropped the same task — a no-op merge.
	it("treats both sides dropping the same task as a no-op", () => {
		const base = build(leaf("A", "Alpha"), leaf("B", "Beta"));
		const main = build(leaf("A", "Alpha"));
		const branch = build(leaf("A", "Alpha"));
		const { merge, ops } = runMerge(base, main, branch);
		expect(merge.counts.sameResult).toBe(1);
		expect(ops).toEqual([]);
	});

	// 6. Branch and main each drop a different task — the branch's drop applies
	// independently of main's own drop.
	it("applies a branch drop independently of an unrelated main drop", () => {
		const base = build(leaf("A", "Alpha"), leaf("B", "Beta"), leaf("C", "Cee"));
		const main = build(leaf("A", "Alpha"), leaf("C", "Cee")); // main dropped B
		const branch = build(leaf("B", "Beta"), leaf("C", "Cee")); // branch dropped A
		const { ops, applied, results } = runMerge(base, main, branch);
		expect(ops).toEqual([{ op: "remove_task", taskId: "A" }]);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(applied.tasksById.A).toBeUndefined();
		expect(applied.tasksById.B).toBeUndefined();
		expect(applied.tasksById.C).toBeDefined();
	});

	// 7. Branch drops a task while main added an unrelated dependency between
	// survivors — the new main edge is untouched by the merge.
	it("preserves an unrelated dependency main added when the branch drops a task", () => {
		const base = build(leaf("A", "Alpha"), leaf("B", "Beta"), leaf("C", "Cee"));
		const main = withDeps(
			build(leaf("A", "Alpha"), leaf("B", "Beta"), leaf("C", "Cee")),
			dep("ab", "A", "B"),
		);
		const branch = build(leaf("A", "Alpha"), leaf("B", "Beta")); // dropped C
		const { ops, applied, results } = runMerge(base, main, branch);
		expect(ops).toEqual([{ op: "remove_task", taskId: "C" }]);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(applied.tasksById.C).toBeUndefined();
		expect(applied.dependenciesById.ab).toBeDefined();
		expectNoDanglingDeps(applied);
	});

	// 8. Round-trip: dropping a task fanned out across multiple deps leaves main
	// with the survivors and no dangling edges.
	it("round-trips a multi-dependency drop to a consistent doc", () => {
		const base = withDeps(
			build(leaf("A", "Alpha"), leaf("B", "Beta"), leaf("C", "Cee")),
			dep("ab", "A", "B"),
			dep("bc", "B", "C"),
		);
		const main = clone(base);
		const branch = withDeps(
			build(leaf("A", "Alpha"), leaf("C", "Cee")), // dropped B + ab + bc
		);
		const { ops, applied, results } = runMerge(base, main, branch);
		expect(ops).toEqual([{ op: "remove_task", taskId: "B" }]);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(Object.keys(applied.tasksById).sort()).toEqual(["A", "C"]);
		expect(Object.keys(applied.dependenciesById)).toEqual([]);
		expectNoDanglingDeps(applied);
	});

	// 9. An unchanged branch produces no ops — the archive-only path the merge
	// drawer relies on to let a clean branch be archived.
	it("produces no ops for an unchanged branch (archive-only path)", () => {
		const base = withDeps(
			build(leaf("A", "Alpha"), leaf("B", "Beta")),
			dep("ab", "A", "B"),
		);
		const { merge, ops } = runMerge(base, clone(base), clone(base));
		expect(merge.changes).toEqual([]);
		expect(ops).toEqual([]);
	});
});
