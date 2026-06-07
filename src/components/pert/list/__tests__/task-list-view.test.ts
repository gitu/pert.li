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
	return { id, kind: "task", title, estimate: e };
}

describe("buildTaskListRows", () => {
	it("returns an empty list for an empty doc", () => {
		const rows = buildTaskListRows(
			createEmptyPertDoc("empty"),
			computeSchedule(createEmptyPertDoc("empty")),
		);
		expect(rows).toEqual([]);
	});

	it("includes every task and milestone — grouped tasks are still rows", () => {
		const doc = build(
			leaf("A", "Alpha"),
			{ id: "M", kind: "milestone", title: "Mile" },
			{ ...leaf("G-child", "Child inside group", est(1, 1, 1)), groupId: "G" },
		);
		// The group exists; membership doesn't hide a task from the flat list.
		doc.groupsById.G = {
			id: "G",
			name: "Group",
			parentGroupId: null,
			order: 0,
		};

		const rows = buildTaskListRows(doc, computeSchedule(doc));
		expect(rows.map((r) => r.id).sort()).toEqual(["A", "G-child", "M"]);
	});

	it("surfaces group membership and derived WBS number on the row", () => {
		const doc = build(
			leaf("A", "Alpha"),
			{ ...leaf("B", "Beta"), groupId: "G" },
			{ ...leaf("C", "Cee"), groupId: "G", numberOverride: "9.9" },
		);
		doc.groupsById.G = {
			id: "G",
			name: "Group",
			parentGroupId: null,
			order: 0,
		};
		const rows = buildTaskListRows(doc, computeSchedule(doc));
		const a = rows.find((r) => r.id === "A");
		const b = rows.find((r) => r.id === "B");
		const c = rows.find((r) => r.id === "C");
		// Ungrouped task: no group, no derived number.
		expect(a?.groupId).toBeNull();
		expect(a?.number).toBe("");
		// Grouped task: derived number under group "1".
		expect(b?.groupId).toBe("G");
		expect(b?.number).toBe("1.1");
		expect(b?.numberOverride).toBeUndefined();
		// Override wins over the derived number and is surfaced for inline edit.
		expect(c?.number).toBe("9.9");
		expect(c?.numberOverride).toBe("9.9");
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
		});
		const rows = buildTaskListRows(doc, computeSchedule(doc));
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe("milestone");
		expect(rows[0].duration).toBe(0);
		expect(rows[0].estimate).toBeUndefined();
	});

	it("defaults taskStatus to not_started when the field is absent", () => {
		const doc = build(leaf("A", "Alpha"));
		const rows = buildTaskListRows(doc, computeSchedule(doc));
		expect(rows[0].taskStatus).toBe("not_started");
		expect(rows[0].actualStart).toBeUndefined();
		expect(rows[0].actualFinish).toBeUndefined();
	});

	it("surfaces actualStart / actualFinish for in-progress and completed tasks", () => {
		const doc = build(
			{
				id: "P",
				kind: "task",
				title: "Partial",
				estimate: est(1, 2, 3),
				status: "in_progress",
				progress: 40,
				actualStart: "2026-05-01",
			},
			{
				id: "D",
				kind: "task",
				title: "Done",
				estimate: est(1, 1, 1),
				status: "completed",
				progress: 100,
				actualStart: "2026-04-20",
				actualFinish: "2026-04-25",
			},
		);
		const rows = buildTaskListRows(doc, computeSchedule(doc));
		const p = rows.find((r) => r.id === "P");
		const d = rows.find((r) => r.id === "D");
		expect(p?.taskStatus).toBe("in_progress");
		expect(p?.actualStart).toBe("2026-05-01");
		expect(p?.actualFinish).toBeUndefined();
		expect(d?.taskStatus).toBe("completed");
		expect(d?.actualStart).toBe("2026-04-20");
		expect(d?.actualFinish).toBe("2026-04-25");
	});
});
