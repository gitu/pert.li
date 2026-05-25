import { describe, expect, it } from "vitest";
import { computeSchedule } from "#/lib/pert/schedule";
import { buildTimelineModel, timelineTicks } from "#/lib/pert/timeline";
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
	const doc = createEmptyPertDoc("tl");
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

describe("buildTimelineModel", () => {
	it("returns empty lanes + cycle=false for an empty doc", () => {
		const empty = createEmptyPertDoc("e");
		const model = buildTimelineModel(empty, computeSchedule(empty));
		expect(model.lanes).toEqual([]);
		expect(model.projectDuration).toBe(0);
		expect(model.axisMax).toBe(1);
		expect(model.cycle).toBe(false);
	});

	it("returns cycle=true and empty lanes when the doc has a cycle", () => {
		const doc = build(leaf("A", "A"), leaf("B", "B"));
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
		const model = buildTimelineModel(doc, computeSchedule(doc));
		expect(model.cycle).toBe(true);
		expect(model.lanes).toEqual([]);
	});

	it("orders lanes by ES, then EF, then title", () => {
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
		const model = buildTimelineModel(doc, computeSchedule(doc));
		expect(model.lanes.map((l) => l.taskId)).toEqual(["A", "B", "Z"]);
	});

	it("hides containers and includes milestones", () => {
		const doc = build(
			leaf("L", "Leaf"),
			{ id: "M", kind: "milestone", title: "Mile", parentId: null },
			{ id: "C", kind: "container", title: "Group", parentId: null },
		);
		const model = buildTimelineModel(doc, computeSchedule(doc));
		const kinds = model.lanes.map((l) => l.kind).sort();
		expect(kinds).toEqual(["milestone", "task"]);
	});

	it("axisMax stays at least 1 even for a doc of zero-duration tasks", () => {
		const doc = build({
			id: "M",
			kind: "milestone",
			title: "Kickoff",
			parentId: null,
		});
		const model = buildTimelineModel(doc, computeSchedule(doc));
		expect(model.axisMax).toBe(1);
		expect(model.projectDuration).toBe(0);
	});

	it("forwards critical flag from the schedule", () => {
		const doc = build(
			leaf("A", "A", est(2, 2, 2)),
			leaf("B", "B", est(3, 3, 3)),
		);
		doc.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "finish_to_start",
		};
		const model = buildTimelineModel(doc, computeSchedule(doc));
		const a = model.lanes.find((l) => l.taskId === "A");
		const b = model.lanes.find((l) => l.taskId === "B");
		expect(a?.critical).toBe(true);
		expect(b?.critical).toBe(true);
		expect(b?.earliestStart).toBe(2);
		expect(b?.earliestFinish).toBe(5);
	});
});

describe("timelineTicks", () => {
	it("returns [0] for non-positive axis", () => {
		expect(timelineTicks(0)).toEqual([0]);
		expect(timelineTicks(-3)).toEqual([0]);
	});

	it("picks a nice step that covers the axis", () => {
		const ticks = timelineTicks(10, 5);
		expect(ticks[0]).toBe(0);
		expect(ticks.at(-1)).toBeGreaterThanOrEqual(10);
		// Step should be uniform.
		const step = ticks[1] - ticks[0];
		for (let i = 2; i < ticks.length; i++) {
			expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step);
		}
	});

	it("handles a tiny axis (<1) with sub-day step", () => {
		const ticks = timelineTicks(0.5);
		expect(ticks[0]).toBe(0);
		expect(ticks.at(-1)).toBeGreaterThanOrEqual(0.5);
		expect(ticks[1] - ticks[0]).toBeLessThanOrEqual(0.5);
	});
});
