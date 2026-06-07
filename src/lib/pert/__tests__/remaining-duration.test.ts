import { describe, expect, it } from "vitest";
import {
	computeSchedule,
	effectiveDurationOf,
	effectiveVarianceOf,
} from "../schedule";
import type { Dependency, Estimate, PertDoc, Task } from "../types";
import { createEmptyPertDoc } from "../types";

function task(
	id: string,
	estimate?: Estimate,
	overrides: Partial<Task> = {},
): Task {
	return {
		id,
		kind: "task",
		title: id,
		estimate,
		...overrides,
	};
}

function dep(id: string, from: string, to: string): Dependency {
	return {
		id,
		from: { taskId: from },
		to: { taskId: to },
		type: "finish_to_start",
		lagDays: 0,
	};
}

function build(tasks: Task[], deps: Dependency[]): PertDoc {
	const doc = createEmptyPertDoc("rd");
	for (const t of tasks) doc.tasksById[t.id] = t;
	for (const d of deps) doc.dependenciesById[d.id] = d;
	return doc;
}

const FIVE_DAYS: Estimate = {
	optimistic: 4,
	mostLikely: 5,
	pessimistic: 6,
	unit: "day",
};

describe("effective duration / variance", () => {
	it("completed tasks burn down to zero", () => {
		const t = task("a", FIVE_DAYS, { status: "completed", progress: 50 });
		expect(effectiveDurationOf(t)).toBe(0);
		expect(effectiveVarianceOf(t)).toBe(0);
	});

	it("not_started tasks use the full plan", () => {
		const t = task("a", FIVE_DAYS);
		expect(effectiveDurationOf(t)).toBeCloseTo(5, 9);
	});

	it("in_progress scales by remaining fraction", () => {
		const t = task("a", FIVE_DAYS, { status: "in_progress", progress: 40 });
		expect(effectiveDurationOf(t)).toBeCloseTo(3, 9); // 60% remaining of 5
	});

	it("clamps progress outside [0, 100]", () => {
		const tooLow = task("a", FIVE_DAYS, {
			status: "in_progress",
			progress: -10,
		});
		expect(effectiveDurationOf(tooLow)).toBeCloseTo(5, 9);
		const tooHigh = task("b", FIVE_DAYS, {
			status: "in_progress",
			progress: 150,
		});
		expect(effectiveDurationOf(tooHigh)).toBeCloseTo(0, 9);
	});
});

describe("computeSchedule honours status/progress", () => {
	it("shrinks the project duration when the first task is half done", () => {
		const doc = build(
			[
				task("a", FIVE_DAYS, { status: "in_progress", progress: 50 }),
				task("b", FIVE_DAYS),
			],
			[dep("d1", "a", "b")],
		);
		const res = computeSchedule(doc);
		if (!res.ok) throw new Error("expected schedule");
		expect(res.schedule.projectDuration).toBeCloseTo(2.5 + 5, 9);
		expect(res.schedule.tasks.a.expected).toBe(5);
		expect(res.schedule.tasks.a.duration).toBeCloseTo(2.5, 9);
	});

	it("emits ISO dates when a calendar is set", () => {
		const doc = build([task("a", FIVE_DAYS)], []);
		doc.calendar = {
			startDate: "2026-01-05", // Monday
			workingDays: [1, 2, 3, 4, 5],
		};
		const res = computeSchedule(doc);
		if (!res.ok) throw new Error("expected schedule");
		expect(res.schedule.projectStartDate).toBe("2026-01-05");
		// 5 working days from Mon Jan 5 = Mon Jan 12.
		expect(res.schedule.projectFinishDate).toBe("2026-01-12");
		expect(res.schedule.tasks.a.earliestFinishDate).toBe("2026-01-12");
	});
});
