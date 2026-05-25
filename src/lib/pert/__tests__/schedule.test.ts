import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeSchedule, expected, variance } from "../schedule";
import type { Dependency, Estimate, PertDoc, Task, TaskKind } from "../types";
import { createEmptyPertDoc } from "../types";

const EPS = 1e-9;

function task(id: string, estimate?: Estimate, kind: TaskKind = "task"): Task {
	return { id, kind, title: id, parentId: null, estimate };
}

function ftsDep(id: string, from: string, to: string, lag = 0): Dependency {
	return {
		id,
		from: { taskId: from },
		to: { taskId: to },
		type: "finish_to_start",
		lagDays: lag,
	};
}

function buildDoc(tasks: Task[], deps: Dependency[]): PertDoc {
	const doc = createEmptyPertDoc("test");
	for (const t of tasks) doc.tasksById[t.id] = t;
	for (const d of deps) doc.dependenciesById[d.id] = d;
	return doc;
}

describe("expected / variance", () => {
	it("computes the PERT expected value (a + 4m + b)/6", () => {
		expect(
			expected({ optimistic: 1, mostLikely: 2, pessimistic: 3, unit: "day" }),
		).toBe(2);
		expect(
			expected({ optimistic: 2, mostLikely: 4, pessimistic: 6, unit: "day" }),
		).toBe(4);
	});

	it("converts hours and weeks into days", () => {
		expect(
			expected({
				optimistic: 24,
				mostLikely: 24,
				pessimistic: 24,
				unit: "hour",
			}),
		).toBe(1);
		expect(
			expected({ optimistic: 1, mostLikely: 1, pessimistic: 1, unit: "week" }),
		).toBe(7);
	});

	it("computes variance as ((b-a)/6)^2 in days", () => {
		expect(
			variance({ optimistic: 1, mostLikely: 3, pessimistic: 7, unit: "day" }),
		).toBeCloseTo(1);
	});

	it("returns 0 for missing estimates", () => {
		expect(expected(undefined)).toBe(0);
		expect(variance(undefined)).toBe(0);
	});
});

describe("computeSchedule — hand-built fixtures", () => {
	it("solves the canonical diamond A→{B,C}→D with critical path A→C→D", () => {
		const doc = buildDoc(
			[
				task("A", {
					optimistic: 1,
					mostLikely: 2,
					pessimistic: 3,
					unit: "day",
				}),
				task("B", {
					optimistic: 2,
					mostLikely: 4,
					pessimistic: 6,
					unit: "day",
				}),
				task("C", {
					optimistic: 1,
					mostLikely: 6,
					pessimistic: 11,
					unit: "day",
				}),
				task("D", {
					optimistic: 1,
					mostLikely: 2,
					pessimistic: 3,
					unit: "day",
				}),
			],
			[
				ftsDep("ab", "A", "B"),
				ftsDep("ac", "A", "C"),
				ftsDep("bd", "B", "D"),
				ftsDep("cd", "C", "D"),
			],
		);
		const result = computeSchedule(doc);
		if (!result.ok) throw new Error("expected schedule, got cycle");
		const s = result.schedule;

		expect(s.projectDuration).toBe(10);
		expect(s.tasks.A.earliestStart).toBe(0);
		expect(s.tasks.A.earliestFinish).toBe(2);
		expect(s.tasks.B.earliestStart).toBe(2);
		expect(s.tasks.B.earliestFinish).toBe(6);
		expect(s.tasks.C.earliestStart).toBe(2);
		expect(s.tasks.C.earliestFinish).toBe(8);
		expect(s.tasks.D.earliestStart).toBe(8);
		expect(s.tasks.D.earliestFinish).toBe(10);

		expect(s.tasks.A.slack).toBeCloseTo(0);
		expect(s.tasks.B.slack).toBeCloseTo(2);
		expect(s.tasks.C.slack).toBeCloseTo(0);
		expect(s.tasks.D.slack).toBeCloseTo(0);

		expect(s.criticalTaskIds.sort()).toEqual(["A", "C", "D"]);
	});

	it("respects lag on a finish-to-start edge", () => {
		const doc = buildDoc(
			[
				task("A", {
					optimistic: 1,
					mostLikely: 1,
					pessimistic: 1,
					unit: "day",
				}),
				task("B", {
					optimistic: 1,
					mostLikely: 1,
					pessimistic: 1,
					unit: "day",
				}),
			],
			[ftsDep("ab", "A", "B", 3)],
		);
		const result = computeSchedule(doc);
		if (!result.ok) throw new Error("expected schedule");
		expect(result.schedule.tasks.B.earliestStart).toBe(4);
		expect(result.schedule.projectDuration).toBe(5);
	});

	it("treats milestones as zero-duration nodes", () => {
		const doc = buildDoc(
			[
				task("kickoff", undefined, "milestone"),
				task("work", {
					optimistic: 2,
					mostLikely: 2,
					pessimistic: 2,
					unit: "day",
				}),
			],
			[ftsDep("e", "kickoff", "work")],
		);
		const result = computeSchedule(doc);
		if (!result.ok) throw new Error("expected schedule");
		expect(result.schedule.tasks.kickoff.duration).toBe(0);
		expect(result.schedule.tasks.work.earliestStart).toBe(0);
		expect(result.schedule.projectDuration).toBe(2);
	});

	it("ignores edges whose endpoints reference containers (Phase 5 territory)", () => {
		const doc = buildDoc(
			[
				task("box", undefined, "container"),
				task("solo", {
					optimistic: 1,
					mostLikely: 1,
					pessimistic: 1,
					unit: "day",
				}),
			],
			[ftsDep("e", "box", "solo")],
		);
		const result = computeSchedule(doc);
		if (!result.ok) throw new Error("expected schedule");
		expect(Object.keys(result.schedule.tasks)).toEqual(["solo"]);
		expect(result.schedule.tasks.solo.earliestStart).toBe(0);
	});

	it("reports a cycle for A→B→A and returns the path", () => {
		const doc = buildDoc(
			[
				task("A", {
					optimistic: 1,
					mostLikely: 1,
					pessimistic: 1,
					unit: "day",
				}),
				task("B", {
					optimistic: 1,
					mostLikely: 1,
					pessimistic: 1,
					unit: "day",
				}),
			],
			[ftsDep("ab", "A", "B"), ftsDep("ba", "B", "A")],
		);
		const result = computeSchedule(doc);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.reason).toBe("cycle");
		// First and last entry of the returned path match — represents a closed loop.
		expect(result.cycle[0]).toBe(result.cycle[result.cycle.length - 1]);
		expect(new Set(result.cycle).size).toBe(2);
	});

	it("returns an empty schedule for an empty doc", () => {
		const result = computeSchedule(createEmptyPertDoc("blank"));
		if (!result.ok) throw new Error("expected schedule");
		expect(result.schedule.projectDuration).toBe(0);
		expect(result.schedule.criticalTaskIds).toEqual([]);
		expect(Object.keys(result.schedule.tasks)).toEqual([]);
	});
});

// fast-check arbitraries below build acyclic random DAGs by only ever drawing
// edges from a lower-index task to a higher-index task. That topology is
// general enough to stress every CPM invariant without ever producing the
// "cycle" branch under property test.
const arbEstimate = fc
	.tuple(
		fc.double({ min: 0.1, max: 5, noNaN: true, noDefaultInfinity: true }),
		fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
		fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
	)
	.map(([a, mDelta, pDelta]) => {
		const m = a + mDelta;
		const p = m + pDelta;
		return {
			optimistic: a,
			mostLikely: m,
			pessimistic: p,
			unit: "day" as const,
		};
	});

function arbDoc(maxTasks = 8): fc.Arbitrary<PertDoc> {
	return fc.integer({ min: 1, max: maxTasks }).chain((n) =>
		fc
			.tuple(
				fc.array(arbEstimate, { minLength: n, maxLength: n }),
				// For each task index i, choose a (possibly empty) subset of
				// predecessor indices j < i.
				fc.array(
					fc.uniqueArray(fc.integer({ min: 0, max: maxTasks - 1 }), {
						maxLength: maxTasks,
					}),
					{ minLength: n, maxLength: n },
				),
			)
			.map(([estimates, preds]): PertDoc => {
				const doc = createEmptyPertDoc("rand");
				for (let i = 0; i < n; i++) {
					doc.tasksById[`T${i}`] = task(`T${i}`, estimates[i]);
				}
				let edgeId = 0;
				for (let i = 0; i < n; i++) {
					for (const j of preds[i]) {
						if (j >= i) continue; // enforce DAG
						const e = ftsDep(`E${edgeId++}`, `T${j}`, `T${i}`);
						doc.dependenciesById[e.id] = e;
					}
				}
				return doc;
			}),
	);
}

describe("computeSchedule — property tests", () => {
	it("non-negative slack everywhere", () => {
		fc.assert(
			fc.property(arbDoc(), (doc) => {
				const r = computeSchedule(doc);
				if (!r.ok) return; // arbDoc emits only DAGs, but be defensive
				for (const t of Object.values(r.schedule.tasks)) {
					if (t.slack < -EPS) return false;
				}
				return true;
			}),
			{ numRuns: 100 },
		);
	});

	it("project duration equals the max EF", () => {
		fc.assert(
			fc.property(arbDoc(), (doc) => {
				const r = computeSchedule(doc);
				if (!r.ok) return true;
				const maxEf = Object.values(r.schedule.tasks).reduce(
					(m, t) => (t.earliestFinish > m ? t.earliestFinish : m),
					0,
				);
				return Math.abs(maxEf - r.schedule.projectDuration) < EPS;
			}),
			{ numRuns: 100 },
		);
	});

	it("critical path covers ≥ projectDuration of durations", () => {
		// Sum of durations along the critical task set, walked via edges, is
		// at least the project duration. (Equality holds for FtS chains; with
		// branches you can have multiple parallel critical chains.)
		fc.assert(
			fc.property(arbDoc(), (doc) => {
				const r = computeSchedule(doc);
				if (!r.ok) return true;
				const { tasks, projectDuration, criticalTaskIds } = r.schedule;
				if (projectDuration === 0) return criticalTaskIds.length >= 0;
				const sumCriticalDurations = criticalTaskIds.reduce(
					(sum, id) => sum + tasks[id].duration,
					0,
				);
				return sumCriticalDurations >= projectDuration - EPS;
			}),
			{ numRuns: 100 },
		);
	});

	it("monotonicity: enlarging a leaf estimate never shortens projectDuration", () => {
		fc.assert(
			fc.property(
				arbDoc(),
				fc.double({ min: 0.5, max: 4, noNaN: true, noDefaultInfinity: true }),
				(doc, bump) => {
					const r1 = computeSchedule(doc);
					if (!r1.ok) return true;
					// Pick a task with an estimate and inflate its pessimistic bound.
					const ids = Object.keys(doc.tasksById);
					const id = ids[0];
					const t = doc.tasksById[id];
					if (!t.estimate) return true;
					const inflated: PertDoc = {
						...doc,
						tasksById: {
							...doc.tasksById,
							[id]: {
								...t,
								estimate: {
									...t.estimate,
									pessimistic: t.estimate.pessimistic + bump,
								},
							},
						},
					};
					const r2 = computeSchedule(inflated);
					if (!r2.ok) return false;
					return (
						r2.schedule.projectDuration + EPS >= r1.schedule.projectDuration
					);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("isolated extra task does not change other tasks' ES / EF", () => {
		fc.assert(
			fc.property(arbDoc(6), (doc) => {
				const r1 = computeSchedule(doc);
				if (!r1.ok) return true;
				const extended: PertDoc = {
					...doc,
					tasksById: {
						...doc.tasksById,
						LOOSE: task("LOOSE", {
							optimistic: 1,
							mostLikely: 1,
							pessimistic: 1,
							unit: "day",
						}),
					},
				};
				const r2 = computeSchedule(extended);
				if (!r2.ok) return false;
				for (const [id, t] of Object.entries(r1.schedule.tasks)) {
					const t2 = r2.schedule.tasks[id];
					if (Math.abs(t.earliestStart - t2.earliestStart) > EPS) return false;
					if (Math.abs(t.earliestFinish - t2.earliestFinish) > EPS)
						return false;
				}
				return true;
			}),
			{ numRuns: 100 },
		);
	});

	it("at least one task is critical whenever the project has positive duration", () => {
		fc.assert(
			fc.property(arbDoc(), (doc) => {
				const r = computeSchedule(doc);
				if (!r.ok) return true;
				if (r.schedule.projectDuration <= EPS) return true;
				return r.schedule.criticalTaskIds.length > 0;
			}),
			{ numRuns: 100 },
		);
	});
});
