import { describe, expect, it } from "vitest";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import {
	createWorkPlanMutation,
	nextPendingStep,
	planProgress,
	removeWorkPlanMutation,
	setWorkPlanStatusMutation,
	summarizeWorkPlan,
	updateWorkPlanMutation,
} from "../work-plan-mutators";

function docWithPlan(): PertDoc {
	const d = createEmptyPertDoc("plan test");
	createWorkPlanMutation(d, {
		title: "Import the attached plan",
		rationale: "Imported from attached-roadmap.md",
		steps: [
			{ title: "Create phase containers", description: "3 containers" },
			{ title: "Add Phase 1 tasks", description: "8 tasks under phase 1" },
			{ title: "Wire dependencies", description: "12 edges" },
		],
	});
	return d;
}

describe("createWorkPlanMutation", () => {
	it("creates a draft plan with pending steps", () => {
		const d = createEmptyPertDoc("p");
		const res = createWorkPlanMutation(d, {
			title: "Import",
			rationale: "from attachment",
			steps: [{ title: "Step 1", description: "do things" }],
		});
		expect("planId" in res).toBe(true);
		expect(d.workPlan?.status).toBe("draft");
		expect(d.workPlan?.steps).toHaveLength(1);
		expect(d.workPlan?.steps[0].status).toBe("pending");
		expect(d.workPlan?.steps[0].id).toMatch(/^step_/);
	});

	it("rejects whitespace-only plan titles", () => {
		const d = createEmptyPertDoc("p");
		const res = createWorkPlanMutation(d, {
			title: "   ",
			rationale: "r",
			steps: [{ title: "Step 1", description: "x" }],
		});
		expect(res).toEqual({
			ok: false,
			error: "the work plan title must not be empty",
		});
		expect(d.workPlan).toBeUndefined();
	});

	it("rejects steps with whitespace-only titles", () => {
		const d = createEmptyPertDoc("p");
		const res = createWorkPlanMutation(d, {
			title: "Import",
			rationale: "r",
			steps: [
				{ title: "Real step", description: "x" },
				{ title: "  ", description: "y" },
			],
		});
		expect(res).toMatchObject({ ok: false });
		if ("error" in res) {
			expect(res.error).toContain("step 2 has an empty title");
		}
		expect(d.workPlan).toBeUndefined();
	});

	it("rejects an empty step list", () => {
		const d = createEmptyPertDoc("p");
		const res = createWorkPlanMutation(d, {
			title: "Import",
			rationale: "r",
			steps: [],
		});
		expect(res).toEqual({
			ok: false,
			error: "a work plan needs at least one step",
		});
		expect(d.workPlan).toBeUndefined();
	});

	it("replaces an existing plan", () => {
		const d = docWithPlan();
		const firstId = d.workPlan?.id;
		createWorkPlanMutation(d, {
			title: "Second plan",
			rationale: "redo",
			steps: [{ title: "Only step", description: "x" }],
		});
		expect(d.workPlan?.id).not.toBe(firstId);
		expect(d.workPlan?.title).toBe("Second plan");
		expect(d.workPlan?.steps).toHaveLength(1);
	});
});

describe("setWorkPlanStatusMutation", () => {
	it("allows draft → approved (the user's approval click)", () => {
		const d = docWithPlan();
		expect(setWorkPlanStatusMutation(d, { status: "approved" })).toEqual({
			ok: true,
		});
		expect(d.workPlan?.status).toBe("approved");
	});

	it("allows draft → cancelled (the user's reject click)", () => {
		const d = docWithPlan();
		expect(setWorkPlanStatusMutation(d, { status: "cancelled" })).toEqual({
			ok: true,
		});
	});

	it("rejects draft → executing (must be approved first)", () => {
		const d = docWithPlan();
		const res = setWorkPlanStatusMutation(d, { status: "executing" });
		expect(res).toEqual({
			ok: false,
			error: "cannot move a draft plan to executing",
		});
	});

	it("rejects transitions out of terminal states", () => {
		const d = docWithPlan();
		setWorkPlanStatusMutation(d, { status: "cancelled" });
		expect(setWorkPlanStatusMutation(d, { status: "approved" })).toMatchObject({
			ok: false,
		});
	});

	it("is a no-op when the status already matches", () => {
		const d = docWithPlan();
		expect(setWorkPlanStatusMutation(d, { status: "draft" })).toEqual({
			ok: true,
		});
	});

	it("errors when no plan exists", () => {
		const d = createEmptyPertDoc("p");
		expect(setWorkPlanStatusMutation(d, { status: "approved" })).toEqual({
			ok: false,
			error: "no work plan exists",
		});
	});
});

describe("updateWorkPlanMutation", () => {
	it("marks steps in progress and flips an approved plan to executing", () => {
		const d = docWithPlan();
		setWorkPlanStatusMutation(d, { status: "approved" });
		const stepId = d.workPlan?.steps[0].id ?? "";
		const res = updateWorkPlanMutation(d, {
			updateSteps: [{ stepId, status: "in_progress" }],
		});
		expect(res).toMatchObject({ ok: true });
		expect(d.workPlan?.steps[0].status).toBe("in_progress");
		expect(d.workPlan?.status).toBe("executing");
	});

	it("completes the plan when every step reaches a terminal step status", () => {
		const d = docWithPlan();
		setWorkPlanStatusMutation(d, { status: "approved" });
		const ids = d.workPlan?.steps.map((s) => s.id) ?? [];
		updateWorkPlanMutation(d, {
			updateSteps: ids.map((stepId) => ({
				stepId,
				status: "completed" as const,
				result: "done",
			})),
		});
		expect(d.workPlan?.status).toBe("completed");
		expect(d.workPlan?.steps.every((s) => s.result === "done")).toBe(true);
	});

	it("adds steps (new source file arrived) and keeps them pending", () => {
		const d = docWithPlan();
		setWorkPlanStatusMutation(d, { status: "approved" });
		const res = updateWorkPlanMutation(d, {
			addSteps: [{ title: "Import addendum", description: "5 more tasks" }],
		});
		expect(res).toMatchObject({ ok: true });
		expect(d.workPlan?.steps).toHaveLength(4);
		expect(d.workPlan?.steps[3].status).toBe("pending");
	});

	it("removes steps by id", () => {
		const d = docWithPlan();
		const removeId = d.workPlan?.steps[1].id ?? "";
		updateWorkPlanMutation(d, { removeStepIds: [removeId] });
		expect(d.workPlan?.steps).toHaveLength(2);
		expect(d.workPlan?.steps.find((s) => s.id === removeId)).toBeUndefined();
	});

	it("tolerates explicit nulls in step updates (models send them)", () => {
		const d = docWithPlan();
		setWorkPlanStatusMutation(d, { status: "approved" });
		const stepId = d.workPlan?.steps[0].id ?? "";
		const originalTitle = d.workPlan?.steps[0].title;
		// The exact payload shape observed from a gateway model: status set,
		// every other field explicitly null.
		const res = updateWorkPlanMutation(d, {
			updateSteps: [
				{
					stepId,
					status: "completed",
					// biome-ignore lint/suspicious/noExplicitAny: simulating out-of-schema model input.
					title: null as any,
					// biome-ignore lint/suspicious/noExplicitAny: simulating out-of-schema model input.
					description: null as any,
					// biome-ignore lint/suspicious/noExplicitAny: simulating out-of-schema model input.
					result: null as any,
				},
			],
		});
		expect(res).toMatchObject({ ok: true });
		expect(d.workPlan?.steps[0].status).toBe("completed");
		// Null fields are ignored, not applied.
		expect(d.workPlan?.steps[0].title).toBe(originalTitle);
	});

	it("errors on unknown step ids", () => {
		const d = docWithPlan();
		expect(
			updateWorkPlanMutation(d, {
				updateSteps: [{ stepId: "ghost", status: "completed" }],
			}),
		).toEqual({ ok: false, error: "step ghost not found" });
	});

	it("refuses updates to completed or cancelled plans", () => {
		const d = docWithPlan();
		setWorkPlanStatusMutation(d, { status: "cancelled" });
		expect(
			updateWorkPlanMutation(d, {
				addSteps: [{ title: "x", description: "y" }],
			}),
		).toMatchObject({ ok: false });
	});

	it("errors when no plan exists", () => {
		const d = createEmptyPertDoc("p");
		expect(
			updateWorkPlanMutation(d, {
				addSteps: [{ title: "x", description: "y" }],
			}),
		).toEqual({ ok: false, error: "no work plan exists — create one first" });
	});
});

describe("read helpers", () => {
	it("planProgress counts completed/skipped as done and failed separately", () => {
		const d = docWithPlan();
		setWorkPlanStatusMutation(d, { status: "approved" });
		const [a, b, c] = d.workPlan?.steps ?? [];
		updateWorkPlanMutation(d, {
			updateSteps: [
				{ stepId: a.id, status: "completed" },
				{ stepId: b.id, status: "skipped" },
				{ stepId: c.id, status: "failed", result: "gateway error" },
			],
		});
		const plan = d.workPlan;
		expect(plan).toBeDefined();
		if (plan) {
			expect(planProgress(plan)).toEqual({
				completed: 2,
				failed: 1,
				total: 3,
			});
		}
	});

	it("nextPendingStep returns in_progress steps before later pending ones", () => {
		const d = docWithPlan();
		setWorkPlanStatusMutation(d, { status: "approved" });
		const [a] = d.workPlan?.steps ?? [];
		updateWorkPlanMutation(d, {
			updateSteps: [{ stepId: a.id, status: "in_progress" }],
		});
		const plan = d.workPlan;
		if (plan) {
			expect(nextPendingStep(plan)?.id).toBe(a.id);
		}
	});

	it("nextPendingStep returns null when everything is terminal", () => {
		const d = docWithPlan();
		setWorkPlanStatusMutation(d, { status: "approved" });
		const ids = d.workPlan?.steps.map((s) => s.id) ?? [];
		updateWorkPlanMutation(d, {
			updateSteps: ids.map((stepId) => ({
				stepId,
				status: "completed" as const,
			})),
		});
		const plan = d.workPlan;
		if (plan) {
			expect(nextPendingStep(plan)).toBeNull();
		}
	});

	it("summarizeWorkPlan exposes stepIds and progress for the model", () => {
		const d = docWithPlan();
		const plan = d.workPlan;
		expect(plan).toBeDefined();
		if (!plan) return;
		const summary = summarizeWorkPlan(plan);
		expect(summary.planId).toBe(plan.id);
		expect(summary.steps).toHaveLength(3);
		expect(summary.steps[0].stepId).toBe(plan.steps[0].id);
		expect(summary.progress).toEqual({ completed: 0, failed: 0, total: 3 });
	});
});

describe("removeWorkPlanMutation", () => {
	it("deletes the plan from the doc", () => {
		const d = docWithPlan();
		removeWorkPlanMutation(d);
		expect(d.workPlan).toBeUndefined();
	});
});
