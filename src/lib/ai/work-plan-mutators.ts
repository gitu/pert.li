import type {
	PertDoc,
	WorkPlan,
	WorkPlanStatus,
	WorkPlanStep,
	WorkPlanStepStatus,
} from "#/lib/pert/types";
import { newId } from "./tool-mutators";

// Pure mutators for the AI work plan (doc.workPlan) — the plan-and-execute
// mode's data layer. Same conventions as tool-mutators.ts: take a draft
// PertDoc (inside an Automerge change()), mutate in place, return a small
// JSON-friendly result the chat tool can hand back to the model.
//
// The lifecycle gate that matters: a plan is created as "draft" and only the
// USER can approve it (the approve action lives in the WorkPlanCard UI, not
// in any chat tool). Once approved, the assistant executes steps and the
// changes land directly on the doc — the plan approval IS the review.

export type WorkPlanStepInput = {
	title: string;
	description: string;
};

export type CreateWorkPlanArgs = {
	title: string;
	rationale: string;
	steps: WorkPlanStepInput[];
};

export function createWorkPlanMutation(
	d: PertDoc,
	args: CreateWorkPlanArgs,
): { planId: string } | { ok: false; error: string } {
	if (args.steps.length === 0) {
		return { ok: false, error: "a work plan needs at least one step" };
	}
	const now = Date.now();
	// Defensive string coercion throughout: tool args reach this code from the
	// model and may contain explicit nulls despite the schema saying string.
	const safeTrim = (value: unknown): string =>
		typeof value === "string" ? value.trim() : "";
	// Validate AFTER trimming — a whitespace-only title would otherwise become
	// "" and write a plan that violates the WorkPlan schema (and renders as a
	// blank card).
	const title = safeTrim(args.title);
	if (title.length === 0) {
		return { ok: false, error: "the work plan title must not be empty" };
	}
	const steps = args.steps.map((s, i) => ({
		index: i,
		title: safeTrim(s.title),
		description: safeTrim(s.description),
	}));
	const blankStep = steps.find((s) => s.title.length === 0);
	if (blankStep) {
		return {
			ok: false,
			error: `step ${blankStep.index + 1} has an empty title — every step needs a short imperative name`,
		};
	}
	const plan: WorkPlan = {
		id: newId("plan"),
		title,
		rationale: safeTrim(args.rationale),
		steps: steps.map((s) => ({
			id: newId("step"),
			title: s.title,
			description: s.description,
			status: "pending" as const,
		})),
		status: "draft",
		createdAt: now,
		updatedAt: now,
	};
	// Replaces any existing plan — prior plans stay in Automerge history.
	d.workPlan = plan;
	return { planId: plan.id };
}

export type UpdateWorkPlanArgs = {
	// New steps appended to the end of the plan (e.g. after the user attached
	// another source document).
	addSteps?: WorkPlanStepInput[];
	// In-place updates to existing steps: status transitions, result notes,
	// rewritten titles/descriptions (when reworking the plan).
	updateSteps?: Array<{
		stepId: string;
		title?: string;
		description?: string;
		status?: WorkPlanStepStatus;
		result?: string;
	}>;
	removeStepIds?: string[];
};

export function updateWorkPlanMutation(
	d: PertDoc,
	args: UpdateWorkPlanArgs,
): { ok: true; progress: WorkPlanProgress } | { ok: false; error: string } {
	const plan = d.workPlan;
	if (!plan) {
		return { ok: false, error: "no work plan exists — create one first" };
	}
	if (plan.status === "cancelled" || plan.status === "completed") {
		return {
			ok: false,
			error: `the work plan is ${plan.status} — create a new plan instead of updating it`,
		};
	}
	for (const update of args.updateSteps ?? []) {
		const step = plan.steps.find((s) => s.id === update.stepId);
		if (!step) {
			return { ok: false, error: `step ${update.stepId} not found` };
		}
		// typeof checks (not !== undefined): models routinely send explicit
		// nulls for fields they don't want to change, and `null.trim()` throws.
		if (typeof update.title === "string") step.title = update.title.trim();
		if (typeof update.description === "string") {
			step.description = update.description.trim();
		}
		if (typeof update.status === "string") step.status = update.status;
		if (typeof update.result === "string") step.result = update.result;
	}
	for (const removeId of args.removeStepIds ?? []) {
		const idx = plan.steps.findIndex((s) => s.id === removeId);
		if (idx < 0) {
			return { ok: false, error: `step ${removeId} not found` };
		}
		plan.steps.splice(idx, 1);
	}
	for (const add of args.addSteps ?? []) {
		plan.steps.push({
			id: newId("step"),
			title: typeof add.title === "string" ? add.title.trim() : "",
			description:
				typeof add.description === "string" ? add.description.trim() : "",
			status: "pending",
		});
	}
	// Executing a step? Reflect it in the plan status so the UI shows motion.
	if (
		plan.status === "approved" &&
		plan.steps.some((s) => s.status !== "pending")
	) {
		plan.status = "executing";
	}
	// Everything done (or skipped/failed-and-acknowledged)? Close the plan.
	if (
		plan.status === "executing" &&
		plan.steps.length > 0 &&
		plan.steps.every(
			(s) =>
				s.status === "completed" ||
				s.status === "skipped" ||
				s.status === "failed",
		)
	) {
		plan.status = "completed";
	}
	plan.updatedAt = Date.now();
	return { ok: true, progress: planProgress(plan) };
}

// Legal status transitions. Approval comes from the UI only; the rest are
// driven by updateWorkPlanMutation's automatic transitions or by cancel.
const LEGAL_TRANSITIONS: Record<WorkPlanStatus, WorkPlanStatus[]> = {
	draft: ["approved", "cancelled"],
	approved: ["executing", "completed", "cancelled"],
	executing: ["completed", "cancelled"],
	completed: [],
	cancelled: [],
};

export function setWorkPlanStatusMutation(
	d: PertDoc,
	args: { status: WorkPlanStatus },
): { ok: true } | { ok: false; error: string } {
	const plan = d.workPlan;
	if (!plan) {
		return { ok: false, error: "no work plan exists" };
	}
	if (plan.status === args.status) return { ok: true };
	if (!LEGAL_TRANSITIONS[plan.status].includes(args.status)) {
		return {
			ok: false,
			error: `cannot move a ${plan.status} plan to ${args.status}`,
		};
	}
	plan.status = args.status;
	plan.updatedAt = Date.now();
	return { ok: true };
}

export function removeWorkPlanMutation(d: PertDoc): { ok: true } {
	delete d.workPlan;
	return { ok: true };
}

// ── Read helpers (pure, no mutation) ────────────────────────────────────────

export type WorkPlanProgress = {
	completed: number;
	failed: number;
	total: number;
};

export function planProgress(plan: WorkPlan): WorkPlanProgress {
	let completed = 0;
	let failed = 0;
	for (const s of plan.steps) {
		if (s.status === "completed" || s.status === "skipped") completed += 1;
		else if (s.status === "failed") failed += 1;
	}
	return { completed, failed, total: plan.steps.length };
}

export function nextPendingStep(plan: WorkPlan): WorkPlanStep | null {
	return (
		plan.steps.find(
			(s) => s.status === "pending" || s.status === "in_progress",
		) ?? null
	);
}

// Compact JSON view of the plan for the get_work_plan tool — the model uses
// this to resume execution (find the next pending step) without the UI's
// rendering concerns.
export function summarizeWorkPlan(plan: WorkPlan): {
	planId: string;
	title: string;
	rationale: string;
	status: WorkPlanStatus;
	progress: WorkPlanProgress;
	steps: Array<{
		stepId: string;
		title: string;
		description: string;
		status: WorkPlanStepStatus;
		result?: string;
	}>;
} {
	return {
		planId: plan.id,
		title: plan.title,
		rationale: plan.rationale,
		status: plan.status,
		progress: planProgress(plan),
		steps: plan.steps.map((s) => ({
			stepId: s.id,
			title: s.title,
			description: s.description,
			status: s.status,
			...(s.result !== undefined ? { result: s.result } : {}),
		})),
	};
}
