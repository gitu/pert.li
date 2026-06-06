import { describe, expect, it } from "vitest";
import { runMonteCarlo } from "#/lib/pert/montecarlo";
import {
	createMonteCarloPertDoc,
	MONTE_CARLO_SAMPLE_TITLE,
} from "#/lib/pert/sample-montecarlo-project";
import { computeSchedule } from "#/lib/pert/schedule";
import { pertDoc } from "#/lib/pert/zod-schemas";

describe("createMonteCarloPertDoc", () => {
	it("builds a structurally valid PertDoc", () => {
		const doc = createMonteCarloPertDoc();
		expect(doc.schemaVersion).toBe(1);
		expect(doc.title).toBe(MONTE_CARLO_SAMPLE_TITLE);
		expect(pertDoc.safeParse(doc).success).toBe(true);
	});

	it("uses the given title", () => {
		expect(createMonteCarloPertDoc("Custom").title).toBe("Custom");
	});

	it("only references real tasks in its dependencies", () => {
		const doc = createMonteCarloPertDoc();
		for (const dep of Object.values(doc.dependenciesById)) {
			expect(doc.tasksById[dep.from.taskId ?? ""]).toBeDefined();
			expect(doc.tasksById[dep.to.taskId ?? ""]).toBeDefined();
		}
	});

	it("every non-milestone task carries an ordered three-point estimate", () => {
		const doc = createMonteCarloPertDoc();
		for (const task of Object.values(doc.tasksById)) {
			if (task.kind === "milestone") continue;
			const e = task.estimate;
			expect(e).toBeDefined();
			if (e) {
				expect(e.optimistic).toBeLessThanOrEqual(e.mostLikely);
				expect(e.mostLikely).toBeLessThanOrEqual(e.pessimistic);
			}
		}
	});

	// The whole point of the sample: the deterministic critical path and the
	// Monte Carlo critical path disagree at the merge. CPM picks `sdk` (higher
	// mean); the simulation picks `migrate` (higher median) most of the time.
	it("deterministic CPM marks sdk critical and migrate slack", () => {
		const result = computeSchedule(createMonteCarloPertDoc());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.schedule.criticalTaskIds).toContain("sdk");
			expect(result.schedule.criticalTaskIds).not.toContain("migrate");
		}
	});

	it("Monte Carlo shows a red serial chain and a majority-critical merge-bias branch", () => {
		const doc = createMonteCarloPertDoc();
		const result = runMonteCarlo(doc);
		expect(result).not.toBeNull();
		if (!result) return;

		// (a) The serial chain is on the critical path in essentially every trial
		// — high enough that the canvas renders it red (>= 0.5) and the inspector
		// flags it (>= 0.8).
		for (const id of ["s1", "s2", "s3"]) {
			expect(result.tasks[id].criticality).toBeGreaterThanOrEqual(0.8);
		}

		// (b) Merge bias: the higher-variance branch is critical in the majority
		// of trials, but not all — "likely critical", the lesson. Its low-variance
		// sibling takes the complementary share.
		const migrate = result.tasks.migrate.criticality;
		const sdk = result.tasks.sdk.criticality;
		expect(migrate).toBeGreaterThan(0.5);
		expect(migrate).toBeLessThan(0.95);
		expect(sdk).toBeLessThan(0.5);
		// Exactly one branch is critical per trial at the merge.
		expect(migrate + sdk).toBeCloseTo(1, 1);

		// (c) Visible schedule risk: the safe date sits well beyond the realistic
		// one, and dates render from the calendar.
		expect(result.projectFinish.p90).toBeGreaterThan(result.projectFinish.p50);
		expect(result.projectFinish.p90 - result.projectFinish.p50).toBeGreaterThan(
			2,
		);
		expect(result.projectFinish.p50Date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(result.projectFinish.p90Date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
