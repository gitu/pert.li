import { describe, expect, it } from "vitest";
import {
	computeSchedule,
	historicCapacityPerDay,
	teamCapacityPerDay,
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
		parentId: null,
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

function build(tasks: Task[], deps: Dependency[] = []): PertDoc {
	const doc = createEmptyPertDoc("team");
	for (const t of tasks) doc.tasksById[t.id] = t;
	for (const d of deps) doc.dependenciesById[d.id] = d;
	return doc;
}

const TWO_DAYS: Estimate = {
	optimistic: 2,
	mostLikely: 2,
	pessimistic: 2,
	unit: "day",
};

describe("teamCapacityPerDay", () => {
	it("returns zero when team mode is off", () => {
		const doc = build([]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			team: { peopleCount: 3, availabilityPct: 100 },
			// allocationMode missing → treated as calendar-only
		};
		expect(teamCapacityPerDay(doc)).toBe(0);
	});

	it("computes people × availability when team mode is on", () => {
		const doc = build([]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 3, availabilityPct: 80 },
		};
		expect(teamCapacityPerDay(doc)).toBeCloseTo(2.4, 9);
	});
});

describe("team-constrained schedule", () => {
	it("serial chain with 1 person stays the same length (no overlap)", () => {
		const doc = build(
			[task("a", TWO_DAYS), task("b", TWO_DAYS), task("c", TWO_DAYS)],
			[dep("d1", "a", "b"), dep("d2", "b", "c")],
		);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 1, availabilityPct: 100 },
		};
		const res = computeSchedule(doc);
		if (!res.ok) throw new Error("expected schedule");
		// Each task is alone in its window → peers = 1, capacity = 1 → no
		// stretching. Total = 6 days, same as calendar mode.
		expect(res.schedule.projectDuration).toBeCloseTo(6, 9);
	});

	it("3 parallel tasks with 1 person stretch by 3×", () => {
		const doc = build([
			task("a", TWO_DAYS),
			task("b", TWO_DAYS),
			task("c", TWO_DAYS),
		]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 1, availabilityPct: 100 },
		};
		const res = computeSchedule(doc);
		if (!res.ok) throw new Error("expected schedule");
		// All three overlap in baseline → peers = 3 each → duration ×3.
		// They still run in parallel, so project duration = 6.
		expect(res.schedule.projectDuration).toBeCloseTo(6, 9);
		expect(res.schedule.tasks.a.duration).toBeCloseTo(6, 9);
	});

	it("3 parallel tasks with 2 people stretch by 1.5×", () => {
		const doc = build([
			task("a", TWO_DAYS),
			task("b", TWO_DAYS),
			task("c", TWO_DAYS),
		]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 2, availabilityPct: 100 },
		};
		const res = computeSchedule(doc);
		if (!res.ok) throw new Error("expected schedule");
		// peers = 3, capacity = 2 → factor = 1.5 → duration 2 → 3.
		expect(res.schedule.tasks.a.duration).toBeCloseTo(3, 9);
		expect(res.schedule.projectDuration).toBeCloseTo(3, 9);
	});

	it("preserves the original PERT expected value in `expected`", () => {
		const doc = build([task("a", TWO_DAYS)]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 1, availabilityPct: 50 },
		};
		const res = computeSchedule(doc);
		if (!res.ok) throw new Error("expected schedule");
		// duration is the team-scaled value; expected is the unscaled PERT.
		expect(res.schedule.tasks.a.expected).toBe(2);
		expect(res.schedule.tasks.a.duration).toBeCloseTo(4, 9);
	});

	it("falls back to baseline when capacity is zero", () => {
		const doc = build([task("a", TWO_DAYS), task("b", TWO_DAYS)]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 0, availabilityPct: 100 },
		};
		const res = computeSchedule(doc);
		if (!res.ok) throw new Error("expected schedule");
		// 0 capacity → graceful no-op. Two parallel tasks → duration 2 each.
		expect(res.schedule.projectDuration).toBeCloseTo(2, 9);
	});
});

describe("historicCapacityPerDay", () => {
	it("returns null when no completed tasks have actual dates", () => {
		const doc = build([task("a", TWO_DAYS)]);
		expect(historicCapacityPerDay(doc)).toBeNull();
	});

	it("computes PD per working day across completed tasks", () => {
		const doc = build([
			task("a", TWO_DAYS, {
				status: "completed",
				actualStart: "2026-01-05", // Mon
				actualFinish: "2026-01-06", // Tue → 2 working days
			}),
			task("b", TWO_DAYS, {
				status: "completed",
				actualStart: "2026-01-07", // Wed
				actualFinish: "2026-01-09", // Fri → 3 working days
			}),
		]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
		};
		const h = historicCapacityPerDay(doc);
		expect(h).not.toBeNull();
		// 4 PD delivered across 5 working days → 0.8 PD/day.
		expect(h?.deliveredPd).toBe(4);
		expect(h?.elapsedWorkingDays).toBe(5);
		expect(h?.perDay).toBeCloseTo(0.8, 9);
		expect(h?.sampleCount).toBe(2);
	});

	it("skips completed tasks missing actual dates", () => {
		const doc = build([
			task("a", TWO_DAYS, { status: "completed" }),
			task("b", TWO_DAYS, {
				status: "completed",
				actualStart: "2026-01-05",
				actualFinish: "2026-01-05",
			}),
		]);
		const h = historicCapacityPerDay(doc);
		expect(h?.sampleCount).toBe(1);
	});
});

describe("teamCapacityPerDay honours useHistoric", () => {
	it("returns historic when toggled on and history exists", () => {
		const doc = build([
			task("a", TWO_DAYS, {
				status: "completed",
				actualStart: "2026-01-05",
				actualFinish: "2026-01-09", // 5 working days for 2 PD
			}),
		]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 5, availabilityPct: 100, useHistoric: true },
		};
		// Configured says 5 PD/day, but historic says 0.4 PD/day — historic wins.
		expect(teamCapacityPerDay(doc)).toBeCloseTo(0.4, 9);
	});

	it("falls back to configured when useHistoric is on but history is empty", () => {
		const doc = build([task("a", TWO_DAYS)]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 2, availabilityPct: 100, useHistoric: true },
		};
		expect(teamCapacityPerDay(doc)).toBe(2);
	});
});
