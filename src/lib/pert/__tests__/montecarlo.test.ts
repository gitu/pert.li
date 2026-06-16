import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runMonteCarlo, sampleTaskDuration } from "../montecarlo";
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

function build(tasks: Task[], deps: Dependency[] = []): PertDoc {
	const doc = createEmptyPertDoc("mc");
	for (const t of tasks) doc.tasksById[t.id] = t;
	for (const d of deps) doc.dependenciesById[d.id] = d;
	return doc;
}

const SYMMETRIC: Estimate = {
	optimistic: 2,
	mostLikely: 5,
	pessimistic: 8,
	unit: "day",
};

describe("sampleTaskDuration", () => {
	it("returns zero for completed tasks regardless of estimate", () => {
		const rand = () => 0.5;
		const t = task("a", SYMMETRIC, { status: "completed" });
		expect(sampleTaskDuration(t, rand)).toBe(0);
	});

	it("scales by remaining fraction when in_progress", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 100 }),
				fc.integer({ min: 0, max: 0xffffffff }),
				(progress, seed) => {
					let state = seed >>> 0;
					const rand = () => {
						state = (state + 0x6d2b79f5) >>> 0;
						let t2 = state;
						t2 = Math.imul(t2 ^ (t2 >>> 15), t2 | 1);
						t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61);
						return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
					};
					const sampled = sampleTaskDuration(
						task("a", SYMMETRIC, { status: "in_progress", progress }),
						rand,
					);
					// 8 days is the pessimistic ceiling; remaining fraction caps it.
					const cap = 8 * (1 - Math.min(1, Math.max(0, progress / 100)));
					return sampled >= 0 && sampled <= cap + 1e-9;
				},
			),
			{ numRuns: 50 },
		);
	});
});

describe("runMonteCarlo", () => {
	it("project finish percentiles are ordered p10 ≤ p50 ≤ p90", () => {
		const doc = build(
			[task("a", SYMMETRIC), task("b", SYMMETRIC)],
			[dep("d", "a", "b")],
		);
		const r = runMonteCarlo(doc, { trials: 500, seed: 42 });
		expect(r).not.toBeNull();
		const f = r as NonNullable<typeof r>;
		expect(f.projectFinish.p10).toBeLessThanOrEqual(f.projectFinish.p50);
		expect(f.projectFinish.p50).toBeLessThanOrEqual(f.projectFinish.p90);
	});

	it("criticality is in [0, 1] for every task", () => {
		const doc = build(
			[task("a", SYMMETRIC), task("b", SYMMETRIC), task("c", SYMMETRIC)],
			[dep("d1", "a", "b"), dep("d2", "b", "c")],
		);
		const r = runMonteCarlo(doc, { trials: 200, seed: 7 });
		expect(r).not.toBeNull();
		const tasks = (r as NonNullable<typeof r>).tasks;
		for (const id of Object.keys(tasks)) {
			expect(tasks[id].criticality).toBeGreaterThanOrEqual(0);
			expect(tasks[id].criticality).toBeLessThanOrEqual(1);
		}
	});

	it("single-chain criticality is ~1.0 for every task", () => {
		const doc = build(
			[task("a", SYMMETRIC), task("b", SYMMETRIC), task("c", SYMMETRIC)],
			[dep("d1", "a", "b"), dep("d2", "b", "c")],
		);
		const r = runMonteCarlo(doc, { trials: 200, seed: 7 });
		const f = r as NonNullable<typeof r>;
		expect(f.tasks.a.criticality).toBeCloseTo(1, 5);
		expect(f.tasks.b.criticality).toBeCloseTo(1, 5);
		expect(f.tasks.c.criticality).toBeCloseTo(1, 5);
	});

	it("project mean tracks the deterministic expected value (within tolerance)", () => {
		const doc = build([task("a", SYMMETRIC)]);
		const r = runMonteCarlo(doc, { trials: 5000, seed: 1234 });
		const f = r as NonNullable<typeof r>;
		// Expected for symmetric Beta-PERT is the mostLikely value, 5.
		expect(f.projectFinish.mean).toBeGreaterThan(4.5);
		expect(f.projectFinish.mean).toBeLessThan(5.5);
	});

	it("completed tasks have zero finish-time spread", () => {
		const doc = build([task("a", SYMMETRIC, { status: "completed" })]);
		const r = runMonteCarlo(doc, { trials: 100, seed: 9 });
		const f = r as NonNullable<typeof r>;
		expect(f.tasks.a.p10).toBe(0);
		expect(f.tasks.a.p90).toBe(0);
	});

	it("returns ISO dates when a calendar is set", () => {
		const doc = build([task("a", SYMMETRIC)]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
		};
		const r = runMonteCarlo(doc, { trials: 200, seed: 3 });
		const f = r as NonNullable<typeof r>;
		expect(f.projectFinish.p50Date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("team-capacity mode stretches the finish vs calendar mode", () => {
		// Three parallel symmetric tasks, 1 person at 100% — under team mode
		// each sampled duration scales by 3×, so the MC project finish should
		// be roughly 3× the calendar-mode finish (which equals the longest
		// sampled task across trials).
		const doc = build([
			task("a", SYMMETRIC),
			task("b", SYMMETRIC),
			task("c", SYMMETRIC),
		]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
		};
		const calendarRun = runMonteCarlo(doc, { trials: 500, seed: 11 });
		doc.calendar.allocationMode = "team";
		doc.calendar.team = { peopleCount: 1, availabilityPct: 100 };
		const teamRun = runMonteCarlo(doc, { trials: 500, seed: 11 });
		const cal = calendarRun as NonNullable<typeof calendarRun>;
		const team = teamRun as NonNullable<typeof teamRun>;
		expect(team.projectFinish.p50).toBeGreaterThan(cal.projectFinish.p50);
		// Should be roughly 3× — give wide tolerance because the longest of
		// three random draws is not identical to one draw scaled by 3.
		expect(team.projectFinish.p50 / cal.projectFinish.p50).toBeGreaterThan(1.8);
	});

	it("reproducible with the same seed", () => {
		const doc = build(
			[task("a", SYMMETRIC), task("b", SYMMETRIC)],
			[dep("d", "a", "b")],
		);
		const r1 = runMonteCarlo(doc, { trials: 300, seed: 99 });
		const r2 = runMonteCarlo(doc, { trials: 300, seed: 99 });
		expect(r1?.projectFinish.p50).toBe(r2?.projectFinish.p50);
	});
});

describe("runMonteCarlo — parallel staffing", () => {
	const STAFFING = { enabled: true, levelDays: 3, maxPerTask: 4 };

	// A long serial chain so big tasks dominate and crashing them moves the
	// project finish noticeably.
	const BIG: Estimate = {
		optimistic: 18,
		mostLikely: 20,
		pessimistic: 24,
		unit: "day",
	};

	it("omits projectFinishStaffed when staffing is disabled", () => {
		const doc = build([task("a", BIG), task("b", BIG)], [dep("d", "a", "b")]);
		const r = runMonteCarlo(doc, { trials: 200, seed: 7 });
		expect(r?.projectFinishStaffed).toBeUndefined();
	});

	it("adds an earlier (or equal) staffed finish when enabled", () => {
		const doc = build([task("a", BIG), task("b", BIG)], [dep("d", "a", "b")]);
		const r = runMonteCarlo(doc, { trials: 400, seed: 7, staffing: STAFFING });
		expect(r?.projectFinishStaffed).toBeDefined();
		// Crashing big tasks can only shorten the finish.
		expect(r?.projectFinishStaffed?.p50).toBeLessThanOrEqual(
			(r?.projectFinish.p50 ?? 0) + 1e-9,
		);
		expect(r?.projectFinishStaffed?.p50).toBeLessThan(
			r?.projectFinish.p50 ?? 0,
		);
	});

	it("ignores staffing when the doc is on team-capacity mode (team wins)", () => {
		const doc = build([task("a", BIG), task("b", BIG)], [dep("d", "a", "b")]);
		doc.calendar = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 2, availabilityPct: 100 },
		};
		const r = runMonteCarlo(doc, { trials: 200, seed: 7, staffing: STAFFING });
		expect(r?.projectFinishStaffed).toBeUndefined();
	});

	it("is deterministic under a fixed seed", () => {
		const doc = build([task("a", BIG), task("b", BIG)], [dep("d", "a", "b")]);
		const r1 = runMonteCarlo(doc, { trials: 200, seed: 5, staffing: STAFFING });
		const r2 = runMonteCarlo(doc, { trials: 200, seed: 5, staffing: STAFFING });
		expect(r1?.projectFinishStaffed?.p50).toBe(r2?.projectFinishStaffed?.p50);
	});
});
