import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeProjectOverview } from "../overview";
import type { Dependency, Estimate, PertDoc, Task, TaskKind } from "../types";
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

function ftsDep(id: string, from: string, to: string): Dependency {
	return {
		id,
		from: { taskId: from },
		to: { taskId: to },
		type: "finish_to_start",
	};
}

function buildDoc(tasks: Task[], deps: Dependency[] = []): PertDoc {
	const doc = createEmptyPertDoc("test");
	for (const t of tasks) doc.tasksById[t.id] = t;
	for (const d of deps) doc.dependenciesById[d.id] = d;
	return doc;
}

const est: Estimate = {
	optimistic: 1,
	mostLikely: 2,
	pessimistic: 3,
	unit: "day",
};

describe("computeProjectOverview", () => {
	it("returns zeroed figures for an empty doc", () => {
		const o = computeProjectOverview(createEmptyPertDoc("empty"));
		expect(o.taskCount).toBe(0);
		expect(o.milestoneCount).toBe(0);
		expect(o.groupCount).toBe(0);
		expect(o.dependencyCount).toBe(0);
		expect(o.progressPct).toBe(0);
		expect(o.status).toEqual({ notStarted: 0, inProgress: 0, completed: 0 });
		expect(o.schedule.ok).toBe(true);
	});

	it("counts tasks, milestones and groups separately", () => {
		const doc = buildDoc([
			task("t1", { estimate: est, groupId: "g" }),
			task("t2", { estimate: est }),
			task("m1", { kind: "milestone" }),
		]);
		doc.groupsById.g = { id: "g", name: "G", parentGroupId: null, order: 0 };
		const o = computeProjectOverview(doc);
		expect(o.taskCount).toBe(2);
		expect(o.milestoneCount).toBe(1);
		expect(o.groupCount).toBe(1);
	});

	it("counts dependencies", () => {
		const doc = buildDoc(
			[task("a", { estimate: est }), task("b", { estimate: est })],
			[ftsDep("d1", "a", "b")],
		);
		const o = computeProjectOverview(doc);
		expect(o.dependencyCount).toBe(1);
	});

	it("breaks down status across all tasks (tasks + milestones)", () => {
		const doc = buildDoc([
			task("a", { estimate: est, status: "completed" }),
			task("b", { estimate: est, status: "in_progress", progress: 50 }),
			task("c", { estimate: est }),
			task("m", { kind: "milestone", status: "completed" }),
		]);
		const o = computeProjectOverview(doc);
		expect(o.status.completed).toBe(2);
		expect(o.status.inProgress).toBe(1);
		expect(o.status.notStarted).toBe(1);
	});

	it("reports a cycle instead of a schedule when the graph loops", () => {
		const doc = buildDoc(
			[task("a", { estimate: est }), task("b", { estimate: est })],
			[ftsDep("d1", "a", "b"), ftsDep("d2", "b", "a")],
		);
		const o = computeProjectOverview(doc);
		expect(o.schedule.ok).toBe(false);
		if (!o.schedule.ok) expect(o.schedule.cycle.length).toBeGreaterThan(0);
	});

	it("surfaces schedule figures for an acyclic graph", () => {
		const doc = buildDoc(
			[task("a", { estimate: est }), task("b", { estimate: est })],
			[ftsDep("d1", "a", "b")],
		);
		const o = computeProjectOverview(doc);
		expect(o.schedule.ok).toBe(true);
		if (o.schedule.ok) {
			expect(o.schedule.durationDays).toBeGreaterThan(0);
			expect(o.schedule.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(o.schedule.finishDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(o.schedule.criticalCount).toBeGreaterThan(0);
		}
	});

	it("weights progress toward longer tasks (a completed long task dominates)", () => {
		const longEst: Estimate = {
			optimistic: 10,
			mostLikely: 10,
			pessimistic: 10,
			unit: "day",
		};
		const doc = buildDoc([
			task("long", { estimate: longEst, status: "completed" }),
			task("short", { estimate: est }),
		]);
		const o = computeProjectOverview(doc);
		// 100% of 10d + 0% of 2d, weighted ⇒ well above the unweighted 50%.
		expect(o.progressPct).toBeGreaterThan(70);
	});

	// Property tests — invariants that must hold for any doc.
	const arbTask = fc.record({
		id: fc.uuid(),
		kind: fc.constantFrom<TaskKind>("task", "milestone"),
		status: fc.constantFrom("not_started", "in_progress", "completed"),
		progress: fc.integer({ min: 0, max: 100 }),
	});

	it("counts are never negative and sum consistently", () => {
		fc.assert(
			fc.property(fc.array(arbTask, { maxLength: 40 }), (raw) => {
				// De-dup ids so the doc map is well-formed.
				const seen = new Set<string>();
				const tasks: Task[] = [];
				for (const r of raw) {
					if (seen.has(r.id)) continue;
					seen.add(r.id);
					tasks.push(
						task(r.id, {
							kind: r.kind,
							estimate: r.kind === "task" ? est : undefined,
							status: r.status as Task["status"],
							progress: r.progress,
						}),
					);
				}
				const o = computeProjectOverview(buildDoc(tasks));
				for (const n of [
					o.taskCount,
					o.milestoneCount,
					o.groupCount,
					o.dependencyCount,
				]) {
					expect(n).toBeGreaterThanOrEqual(0);
				}
				const leaves =
					o.status.notStarted + o.status.inProgress + o.status.completed;
				expect(leaves).toBe(o.taskCount + o.milestoneCount);
				expect(o.progressPct).toBeGreaterThanOrEqual(0);
				expect(o.progressPct).toBeLessThanOrEqual(100);
			}),
		);
	});
});
