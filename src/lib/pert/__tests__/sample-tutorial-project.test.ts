import { describe, expect, it } from "vitest";
import {
	createTutorialPertDoc,
	TUTORIAL_PROJECT_TITLE,
} from "#/lib/pert/sample-tutorial-project";
import { computeSchedule } from "#/lib/pert/schedule";

describe("createTutorialPertDoc", () => {
	it("builds a valid, non-empty sample plan", () => {
		const doc = createTutorialPertDoc();
		expect(doc.schemaVersion).toBe(1);
		expect(doc.title).toBe(TUTORIAL_PROJECT_TITLE);
		expect(Object.keys(doc.tasksById).length).toBeGreaterThanOrEqual(5);
		expect(Object.keys(doc.dependenciesById).length).toBeGreaterThanOrEqual(5);
	});

	it("uses the given title", () => {
		expect(createTutorialPertDoc("Custom").title).toBe("Custom");
	});

	it("only references real tasks in its dependencies", () => {
		const doc = createTutorialPertDoc();
		for (const dep of Object.values(doc.dependenciesById)) {
			expect(doc.tasksById[dep.from.taskId ?? ""]).toBeDefined();
			expect(doc.tasksById[dep.to.taskId ?? ""]).toBeDefined();
		}
	});

	it("every non-milestone task carries a three-point estimate", () => {
		const doc = createTutorialPertDoc();
		for (const task of Object.values(doc.tasksById)) {
			if (task.kind === "milestone") continue;
			expect(task.estimate).toBeDefined();
			const e = task.estimate;
			if (e) {
				expect(e.optimistic).toBeLessThanOrEqual(e.mostLikely);
				expect(e.mostLikely).toBeLessThanOrEqual(e.pessimistic);
			}
		}
	});

	it("schedules cleanly (no cycle) with a non-trivial critical path", () => {
		const result = computeSchedule(createTutorialPertDoc());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.schedule.projectDuration).toBeGreaterThan(0);
			// A real critical path runs through it, and not every task is on it
			// (the backend track carries slack) — so the overlay is meaningful.
			const total = Object.keys(result.schedule.tasks).length;
			const critical = result.schedule.criticalTaskIds.length;
			expect(critical).toBeGreaterThan(0);
			expect(critical).toBeLessThan(total);
		}
	});
});
