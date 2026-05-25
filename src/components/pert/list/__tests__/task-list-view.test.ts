import { describe, expect, it } from "vitest";
import { buildTaskListRows } from "#/components/pert/list/task-list-view";
import { computeSchedule } from "#/lib/pert/schedule";
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
	const doc = createEmptyPertDoc("list");
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

describe("buildTaskListRows", () => {
	it("returns an empty list for an empty doc", () => {
		const rows = buildTaskListRows(
			createEmptyPertDoc("empty"),
			computeSchedule(createEmptyPertDoc("empty")),
		);
		expect(rows).toEqual([]);
	});

	it("includes leaf tasks and milestones, drops containers", () => {
		const doc = build(
			leaf("A", "Alpha"),
			{ id: "M", kind: "milestone", title: "Mile", parentId: null },
			{ id: "C", kind: "container", title: "Group", parentId: null },
			leaf("C-child", "Child inside container", est(1, 1, 1)),
		);
		// Move the child under the container; engine still keeps the child as a
		// leaf row because containers are the only thing the list hides.
		doc.tasksById["C-child"].parentId = "C";

		const rows = buildTaskListRows(doc, computeSchedule(doc));
		expect(rows.map((r) => r.id).sort()).toEqual(["A", "C-child", "M"]);
	});

	it("sorts rows by earliestStart ascending, then by title", () => {
		const doc = build(leaf("Z", "Zeta"), leaf("A", "Alpha"), leaf("B", "Beta"));
		doc.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "finish_to_start",
		};
		doc.dependenciesById.bz = {
			id: "bz",
			from: { taskId: "B" },
			to: { taskId: "Z" },
			type: "finish_to_start",
		};
		const rows = buildTaskListRows(doc, computeSchedule(doc));
		expect(rows.map((r) => r.id)).toEqual(["A", "B", "Z"]);
	});

	it("falls back to title sort when ES ties", () => {
		const doc = build(leaf("zzz", "Zeta"), leaf("aaa", "Alpha"));
		// no deps → both have ES 0; alpha sorts before zeta by title
		const rows = buildTaskListRows(doc, computeSchedule(doc));
		expect(rows.map((r) => r.id)).toEqual(["aaa", "zzz"]);
	});

	it("forwards engine duration / slack / critical flags onto the rows", () => {
		const doc = build(
			leaf("A", "Alpha", est(2, 2, 2)),
			leaf("B", "Beta", est(3, 3, 3)),
		);
		doc.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "finish_to_start",
		};
		const rows = buildTaskListRows(doc, computeSchedule(doc));
		const a = rows.find((r) => r.id === "A");
		const b = rows.find((r) => r.id === "B");
		expect(a?.duration).toBe(2);
		expect(a?.critical).toBe(true);
		expect(a?.slack).toBeCloseTo(0);
		expect(b?.duration).toBe(3);
		expect(b?.critical).toBe(true);
		expect(b?.es).toBe(2);
		expect(b?.ef).toBe(5);
	});

	it("returns null schedule fields when there is a cycle", () => {
		const doc = build(leaf("A", "Alpha"), leaf("B", "Beta"));
		doc.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "finish_to_start",
		};
		doc.dependenciesById.ba = {
			id: "ba",
			from: { taskId: "B" },
			to: { taskId: "A" },
			type: "finish_to_start",
		};
		const rows = buildTaskListRows(doc, computeSchedule(doc));
		// Rows still listed, schedule fields nulled out.
		expect(rows.map((r) => r.id).sort()).toEqual(["A", "B"]);
		for (const r of rows) {
			expect(r.es).toBeNull();
			expect(r.ef).toBeNull();
			expect(r.slack).toBeNull();
			expect(r.critical).toBe(false);
			expect(r.duration).toBe(0);
		}
	});

	it("preserves milestones with zero duration and no estimate", () => {
		const doc = build({
			id: "M",
			kind: "milestone",
			title: "Kickoff",
			parentId: null,
		});
		const rows = buildTaskListRows(doc, computeSchedule(doc));
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe("milestone");
		expect(rows[0].duration).toBe(0);
		expect(rows[0].estimate).toBeUndefined();
	});
});
