import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";

// Title used to find-or-create the single shared Monte Carlo sample project.
// Auto-seeded alongside the tutorial into an empty workspace so a first-time
// user has a plan whose simulation immediately shows something interesting.
export const MONTE_CARLO_SAMPLE_TITLE = "Monte Carlo risk sample";

// A sample plan built to make the Monte Carlo overlay tell a story the plain
// critical-path engine can't. One spine, two lessons:
//
//   kickoff ─┬─▶ sdk ─────┐
//            └─▶ migrate ─┴─▶ merge ─▶ s1 ─▶ s2 ─▶ s3 ─▶ launch
//
//   1. Merge bias (sdk vs. migrate). Deterministic CPM compares PERT means
//      ((o+4m+p)/6) and marks `sdk` (mean 9.50) critical, `migrate` (mean 9.47)
//      slack. But `migrate` is left-skewed — a high most-likely near its
//      pessimistic, with a thin optimistic tail that cheaply pulls the *mean*
//      down without moving the *median*. So its typical value is higher, and in
//      the majority (~57%) of simulated trials `migrate` — not `sdk` — wins the
//      merge and lands on the critical path. The overlay reveals a risk the CPM
//      view hides.
//   2. High-variance serial chain (s1 → s2 → s3). Nothing routes around it, so
//      every trial puts it on the critical path (~100% criticality → red nodes),
//      and its wide estimates spread the project finish (p90 ≫ p50) — the visible
//      schedule risk the simulation is there to quantify.
//
// The numeric tuning is load-bearing and RNG-sensitive; the unit test in
// __tests__/sample-montecarlo-project.test.ts is the oracle that guards the
// criticality thresholds. Positions are pre-laid left-to-right (nodes 200×80,
// columns ~280px apart) so the canvas reads cleanly without a relayout.
export function createMonteCarloPertDoc(
	title: string = MONTE_CARLO_SAMPLE_TITLE,
): PertDoc {
	const doc = createEmptyPertDoc(title);

	const at = (x: number, y: number) => ({ position: { x, y } });
	const days = (optimistic: number, mostLikely: number, pessimistic: number) =>
		({ optimistic, mostLikely, pessimistic, unit: "day" }) as const;

	doc.tasksById = {
		kickoff: {
			id: "kickoff",
			kind: "milestone",
			title: "Kickoff",
			layout: at(0, 160),
		},
		sdk: {
			id: "sdk",
			kind: "task",
			title: "Integrate vendor SDK",
			estimate: days(9, 9.5, 10),
			notes:
				"Well-understood work — a tight estimate. Its mean is the longer of the two branches, so the plain critical-path view marks it critical.",
			layout: at(280, 40),
		},
		migrate: {
			id: "migrate",
			kind: "task",
			title: "Migrate legacy data",
			estimate: days(2.5, 10.7, 11.5),
			notes:
				"Looks like it has slack on paper, but it's risky: usually slow (high most-likely), only occasionally quick. The simulation puts it on the critical path in most runs — the merge-bias lesson.",
			layout: at(280, 300),
		},
		merge: {
			id: "merge",
			kind: "milestone",
			title: "Integration checkpoint",
			layout: at(560, 160),
		},
		s1: {
			id: "s1",
			kind: "task",
			title: "Build core features",
			estimate: days(4, 6, 14),
			layout: at(840, 160),
		},
		s2: {
			id: "s2",
			kind: "task",
			title: "QA & hardening",
			estimate: days(3, 5, 13),
			layout: at(1120, 160),
		},
		s3: {
			id: "s3",
			kind: "task",
			title: "Beta program & fixes",
			estimate: days(5, 8, 20),
			notes:
				"Wide three-point spread — the main driver of the gap between the realistic (P50) and safe (P90) finish dates.",
			layout: at(1400, 160),
		},
		launch: {
			id: "launch",
			kind: "milestone",
			title: "Launch 🚀",
			layout: at(1680, 160),
		},
	};

	const fs = (id: string, from: string, to: string) => ({
		id,
		from: { taskId: from, port: "finish" as const },
		to: { taskId: to, port: "start" as const },
		type: "finish_to_start" as const,
	});

	doc.dependenciesById = {
		d1: fs("d1", "kickoff", "sdk"),
		d2: fs("d2", "kickoff", "migrate"),
		d3: fs("d3", "sdk", "merge"),
		d4: fs("d4", "migrate", "merge"),
		d5: fs("d5", "merge", "s1"),
		d6: fs("d6", "s1", "s2"),
		d7: fs("d7", "s2", "s3"),
		d8: fs("d8", "s3", "launch"),
	};

	// A working calendar so the inspector's Monte Carlo card can project P50/P90
	// finish *dates*, not just day offsets. Mon–Fri week, anchored to a Monday.
	doc.calendar = { startDate: "2026-06-08", workingDays: [1, 2, 3, 4, 5] };

	return doc;
}
