import fc from "fast-check";
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
		const ab = diff.dependencies.find((d) => d.id === "ab");
		expect(ab?.fields).toEqual([
			{ field: "type", before: "finish_to_start", after: "start_to_start" },
		]);
	});

	it("flags status, progress, key, and actual-date changes", () => {
		const before = build({
			id: "A",
			kind: "task",
			title: "A",
			parentId: null,
			estimate: est(1, 2, 3),
			status: "not_started",
		});
		const after = build({
			id: "A",
			kind: "task",
			title: "A",
			parentId: null,
			estimate: est(1, 2, 3),
			status: "in_progress",
			progress: 40,
			key: "M1",
			actualStart: "2026-06-01",
		});
		const diff = diffPertDoc(before, after);
		expect(diff.tasks).toHaveLength(1);
		const fields = diff.tasks[0].fields.map((f) => f.field).sort();
		expect(fields).toEqual(["actualStart", "key", "progress", "status"]);
	});

	it("flags dependency lag and endpoint changes as field-level deltas", () => {
		const before = build(leaf("A", "A"), leaf("B", "B"), leaf("C", "C"));
		before.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "finish_to_start",
			lagDays: 0,
		};
		const after = build(leaf("A", "A"), leaf("B", "B"), leaf("C", "C"));
		after.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "C" },
			type: "finish_to_start",
			lagDays: 3,
		};
		const diff = diffPertDoc(before, after);
		const ab = diff.dependencies.find((d) => d.id === "ab");
		expect(ab?.kind).toBe("changed");
		const fields = ab?.fields.map((f) => f.field).sort();
		expect(fields).toEqual(["lagDays", "toTaskId"]);
	});

	it("normalises key: empty/whitespace counts as the same as undefined", () => {
		const before = build({
			id: "A",
			kind: "task",
			title: "A",
			parentId: null,
			key: "",
		});
		const afterEmpty = build({
			id: "A",
			kind: "task",
			title: "A",
			parentId: null,
		});
		expect(diffPertDoc(before, afterEmpty).tasks).toEqual([]);

		const afterWhitespace = build({
			id: "A",
			kind: "task",
			title: "A",
			parentId: null,
			key: "   ",
		});
		expect(diffPertDoc(before, afterWhitespace).tasks).toEqual([]);

		// But trimmed-equal-but-non-empty keys still show no diff.
		const beforeWithKey = build({
			id: "A",
			kind: "task",
			title: "A",
			parentId: null,
			key: "  M1  ",
		});
		const afterTrimmed = build({
			id: "A",
			kind: "task",
			title: "A",
			parentId: null,
			key: "M1",
		});
		expect(diffPertDoc(beforeWithKey, afterTrimmed).tasks).toEqual([]);
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

// Property tests — pert.li CLAUDE.md mandates fast-check coverage for
// anything in src/lib/pert/ so we don't regress on edge cases the example
// tests miss (empty docs, identical docs, lots of unrelated tasks, etc.).
const taskIdArb = fc
	.string({ minLength: 1, maxLength: 6 })
	.map((s) => `t_${s.replace(/[^a-z0-9]/gi, "")}`)
	.filter((s) => s.length > 2);

const estimateArb = fc
	.tuple(
		fc.integer({ min: 0, max: 20 }),
		fc.integer({ min: 0, max: 30 }),
		fc.integer({ min: 0, max: 50 }),
	)
	.map(
		([a, b, c]): Estimate => ({
			optimistic: Math.min(a, b, c),
			mostLikely: [a, b, c].sort((x, y) => x - y)[1],
			pessimistic: Math.max(a, b, c),
			unit: "day",
		}),
	);

const taskArb = fc
	.record({
		id: taskIdArb,
		title: fc.string({ minLength: 1, maxLength: 12 }),
		estimate: estimateArb,
	})
	.map(
		({ id, title, estimate }): Task => ({
			id,
			kind: "task",
			title,
			parentId: null,
			estimate,
		}),
	);

const docArb = fc
	.array(taskArb, { minLength: 0, maxLength: 8 })
	.map((tasks) => {
		const d = createEmptyPertDoc("propdoc");
		// Dedupe ids so the map keys don't collide.
		const seen = new Set<string>();
		for (const t of tasks) {
			if (seen.has(t.id)) continue;
			seen.add(t.id);
			d.tasksById[t.id] = t;
		}
		return d;
	});

describe("diffPertDoc properties", () => {
	it("a doc is equal to itself (reflexivity)", () => {
		fc.assert(
			fc.property(docArb, (doc) => {
				const diff = diffPertDoc(doc, doc);
				expect(diff.tasks).toEqual([]);
				expect(diff.dependencies).toEqual([]);
			}),
			{ numRuns: 50 },
		);
	});

	it("renaming exactly one existing task yields exactly one changed task with a single title-field delta", () => {
		fc.assert(
			fc.property(
				docArb,
				fc.string({ minLength: 1, maxLength: 16 }),
				(before, newTitle) => {
					const ids = Object.keys(before.tasksById);
					fc.pre(ids.length > 0);
					const target = ids[0];
					fc.pre(before.tasksById[target].title !== newTitle);
					const after: PertDoc = JSON.parse(JSON.stringify(before));
					after.tasksById[target].title = newTitle;
					const diff = diffPertDoc(before, after);
					expect(diff.tasks).toHaveLength(1);
					expect(diff.tasks[0].id).toBe(target);
					expect(diff.tasks[0].kind).toBe("changed");
					expect(diff.tasks[0].fields).toEqual([
						{
							field: "title",
							before: before.tasksById[target].title,
							after: newTitle,
						},
					]);
				},
			),
			{ numRuns: 50 },
		);
	});

	it("adding a fresh task yields exactly one added entry with no field deltas", () => {
		fc.assert(
			fc.property(docArb, taskArb, (before, fresh) => {
				fc.pre(!(fresh.id in before.tasksById));
				const after: PertDoc = JSON.parse(JSON.stringify(before));
				after.tasksById[fresh.id] = fresh;
				const diff = diffPertDoc(before, after);
				const added = diff.tasks.filter((t) => t.kind === "added");
				expect(added).toHaveLength(1);
				expect(added[0].id).toBe(fresh.id);
				expect(added[0].fields).toEqual([]);
			}),
			{ numRuns: 50 },
		);
	});

	it("removing an existing task yields exactly one removed entry", () => {
		fc.assert(
			fc.property(docArb, (before) => {
				const ids = Object.keys(before.tasksById);
				fc.pre(ids.length > 0);
				const target = ids[0];
				const after: PertDoc = JSON.parse(JSON.stringify(before));
				delete after.tasksById[target];
				const diff = diffPertDoc(before, after);
				const removed = diff.tasks.filter((t) => t.kind === "removed");
				expect(removed).toHaveLength(1);
				expect(removed[0].id).toBe(target);
			}),
			{ numRuns: 50 },
		);
	});

	it("diff is sign-flipped under swap (counts are mirrored)", () => {
		fc.assert(
			fc.property(docArb, docArb, (a, b) => {
				const ab = diffPertDoc(a, b);
				const ba = diffPertDoc(b, a);
				expect(ab.counts.tasksAdded).toBe(ba.counts.tasksRemoved);
				expect(ab.counts.tasksRemoved).toBe(ba.counts.tasksAdded);
				expect(ab.counts.tasksChanged).toBe(ba.counts.tasksChanged);
			}),
			{ numRuns: 50 },
		);
	});
});
