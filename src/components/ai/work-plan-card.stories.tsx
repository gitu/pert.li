import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createWorkPlanMutation } from "#/lib/ai/work-plan-mutators";
import { clearActiveProjectDoc, setActiveProjectDoc } from "#/lib/pert/store";
import {
	createEmptyPertDoc,
	type PertDoc,
	type WorkPlanStepStatus,
} from "#/lib/pert/types";
import { WorkPlanCard } from "./work-plan-card";

// Builds a doc whose workPlan is in the requested state. The step statuses
// are applied after creation so the stories can exercise every visual state.
export function seedWorkPlanDoc(opts: {
	planStatus?: "draft" | "approved" | "executing" | "completed" | "cancelled";
	stepStatuses?: WorkPlanStepStatus[];
}): { doc: PertDoc; planId: string } {
	const doc = createEmptyPertDoc("Work plan demo");
	const created = createWorkPlanMutation(doc, {
		title: "Import the attached roadmap",
		rationale: "Build the full plan from the uploaded markdown document.",
		steps: [
			{
				title: "Create phase containers",
				description: "Three containers: Discovery, Build, Launch",
			},
			{
				title: "Add Discovery tasks",
				description: "6 tasks with estimates under Discovery",
			},
			{
				title: "Add Build tasks",
				description: "9 tasks with estimates under Build",
			},
			{ title: "Wire dependencies", description: "14 finish-to-start edges" },
		],
	});
	const planId = "planId" in created ? created.planId : "";
	const plan = doc.workPlan;
	if (plan) {
		if (opts.stepStatuses) {
			opts.stepStatuses.forEach((status, i) => {
				if (plan.steps[i]) plan.steps[i].status = status;
			});
		}
		if (opts.planStatus) plan.status = opts.planStatus;
	}
	return { doc, planId };
}

function CardStage({
	projectId,
	planStatus,
	stepStatuses,
}: {
	projectId: string;
	planStatus?: "draft" | "approved" | "executing" | "completed" | "cancelled";
	stepStatuses?: WorkPlanStepStatus[];
}) {
	const [seeded] = useState(() =>
		seedWorkPlanDoc({ planStatus, stepStatuses }),
	);
	const [doc, setDoc] = useState<PertDoc>(seeded.doc);

	useEffect(() => {
		const changeDoc = (mutate: (d: PertDoc) => void) => {
			setDoc((current) => {
				const draft: PertDoc = structuredClone(current);
				mutate(draft);
				return draft;
			});
		};
		setActiveProjectDoc(projectId, doc, changeDoc, null);
		return () => clearActiveProjectDoc(projectId);
	}, [projectId, doc]);

	return (
		<div className="w-[440px] max-w-full p-3">
			<WorkPlanCard planId={seeded.planId} />
		</div>
	);
}

const meta = {
	title: "AI/WorkPlanCard",
	component: CardStage,
	parameters: { layout: "padded" },
	// seedWorkPlanDoc is a helper shared with the status-bar stories, not a
	// story — without this Storybook tries to render it as one.
	excludeStories: ["seedWorkPlanDoc"],
} satisfies Meta<typeof CardStage>;

export default meta;
type Story = StoryObj<typeof meta>;

// A freshly-drafted plan: the user's review moment. Approve and Reject are
// the only actions; approving flips the status (and unblocks the AI's edit
// tools).
export const Draft: Story = {
	args: { projectId: "story-plan-draft" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const card = await canvas.findByTestId(/^work-plan-card-/);
		await expect(card).toHaveAttribute("data-state", "draft");
		await expect(canvas.getByTestId(/^work-plan-approve-/)).toBeInTheDocument();
		await expect(canvas.getByTestId(/^work-plan-reject-/)).toBeInTheDocument();
		// All four steps render as pending.
		const steps = canvas.getAllByTestId("work-plan-step");
		expect(steps).toHaveLength(4);
		for (const step of steps) {
			await expect(step).toHaveAttribute("data-status", "pending");
		}
	},
};

export const ApproveFlow: Story = {
	args: { projectId: "story-plan-approve" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId(/^work-plan-card-/);
		await userEvent.click(canvas.getByTestId(/^work-plan-approve-/));
		await waitFor(async () => {
			const card = canvas.getByTestId(/^work-plan-card-/);
			await expect(card).toHaveAttribute("data-state", "approved");
		});
		// The approve/reject buttons disappear once approved.
		expect(canvas.queryByTestId(/^work-plan-approve-/)).toBeNull();
	},
};

export const RejectFlow: Story = {
	args: { projectId: "story-plan-reject" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId(/^work-plan-card-/);
		await userEvent.click(canvas.getByTestId(/^work-plan-reject-/));
		// Rejecting a draft deletes the plan → the card becomes a stale stub.
		await waitFor(async () => {
			const card = canvas.getByTestId(/^work-plan-card-/);
			await expect(card).toHaveAttribute("data-state", "stale");
		});
	},
};

// Mid-execution: two steps done, one running, one pending — plus progress.
export const Executing: Story = {
	args: {
		projectId: "story-plan-executing",
		planStatus: "executing",
		stepStatuses: ["completed", "completed", "in_progress", "pending"],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const card = await canvas.findByTestId(/^work-plan-card-/);
		await expect(card).toHaveAttribute("data-state", "executing");
		await expect(canvas.getByTestId("work-plan-progress")).toHaveTextContent(
			"2/4",
		);
		// No approval buttons during execution.
		expect(canvas.queryByTestId(/^work-plan-approve-/)).toBeNull();
	},
};

// A step failed: the failure count shows in the progress chip and the step
// renders in the destructive style.
export const WithFailedStep: Story = {
	args: {
		projectId: "story-plan-failed",
		planStatus: "executing",
		stepStatuses: ["completed", "failed", "pending", "pending"],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId(/^work-plan-card-/);
		await expect(canvas.getByTestId("work-plan-progress")).toHaveTextContent(
			"1 failed",
		);
		const failed = canvasElement.querySelector(
			'[data-testid="work-plan-step"][data-status="failed"]',
		);
		expect(failed).not.toBeNull();
	},
};

export const Completed: Story = {
	args: {
		projectId: "story-plan-completed",
		planStatus: "completed",
		stepStatuses: ["completed", "completed", "completed", "completed"],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const card = await canvas.findByTestId(/^work-plan-card-/);
		await expect(card).toHaveAttribute("data-state", "completed");
		await expect(canvas.getByTestId("work-plan-progress")).toHaveTextContent(
			"4/4",
		);
	},
};
