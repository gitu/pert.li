import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { clearActiveProjectDoc, setActiveProjectDoc } from "#/lib/pert/store";
import type { PertDoc, WorkPlanStepStatus } from "#/lib/pert/types";
import { WorkPlanStatusBar } from "./work-plan-card";
import { seedWorkPlanDoc } from "./work-plan-card.stories";

// The persistent strip above the chat input while a plan is active. Owns the
// execution-loop controls: Continue, the auto-continue (Ralph loop) toggle,
// and Cancel.

function BarStage({
	projectId,
	planStatus,
	stepStatuses,
	busy = false,
}: {
	projectId: string;
	planStatus?: "draft" | "approved" | "executing" | "completed" | "cancelled";
	stepStatuses?: WorkPlanStepStatus[];
	busy?: boolean;
}) {
	const [seeded] = useState(() =>
		seedWorkPlanDoc({ planStatus, stepStatuses }),
	);
	const [doc, setDoc] = useState<PertDoc>(seeded.doc);
	const [autoContinue, setAutoContinue] = useState(false);
	const [lastMessage, setLastMessage] = useState("");

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
		<div className="w-[440px] max-w-full border bg-background">
			<WorkPlanStatusBar
				onContinue={(msg) => setLastMessage(msg)}
				autoContinue={autoContinue}
				onToggleAutoContinue={setAutoContinue}
				busy={busy}
			/>
			{lastMessage && (
				<div data-testid="story-sent-message" className="p-2 text-[10px]">
					sent: {lastMessage}
				</div>
			)}
		</div>
	);
}

const meta = {
	title: "AI/WorkPlanStatusBar",
	component: BarStage,
	parameters: { layout: "padded" },
} satisfies Meta<typeof BarStage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AwaitingApproval: Story = {
	args: { projectId: "story-bar-draft" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bar = await canvas.findByTestId("work-plan-status-bar");
		await expect(bar).toHaveAttribute("data-plan-status", "draft");
		await expect(canvas.getByText("awaiting approval")).toBeInTheDocument();
		// No Continue button until approved.
		expect(canvas.queryByTestId("work-plan-continue")).toBeNull();
	},
};

export const Executing: Story = {
	args: {
		projectId: "story-bar-executing",
		planStatus: "executing",
		stepStatuses: ["completed", "in_progress", "pending", "pending"],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId("work-plan-status-bar");
		await expect(
			canvas.getByTestId("work-plan-bar-progress"),
		).toHaveTextContent("1/4");
		// Continue sends the canned continuation message.
		await userEvent.click(canvas.getByTestId("work-plan-continue"));
		await expect(canvas.getByTestId("story-sent-message")).toHaveTextContent(
			"Continue executing the work plan",
		);
		// The auto toggle flips its pressed state.
		const toggle = canvas.getByTestId("work-plan-auto-toggle");
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await userEvent.click(toggle);
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
	},
};

export const ContinueDisabledWhileBusy: Story = {
	args: {
		projectId: "story-bar-busy",
		planStatus: "executing",
		stepStatuses: ["completed", "in_progress", "pending", "pending"],
		busy: true,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId("work-plan-status-bar");
		await expect(canvas.getByTestId("work-plan-continue")).toBeDisabled();
	},
};

export const HiddenWhenCompleted: Story = {
	args: {
		projectId: "story-bar-completed",
		planStatus: "completed",
		stepStatuses: ["completed", "completed", "completed", "completed"],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// Completed plans render no bar at all.
		expect(canvas.queryByTestId("work-plan-status-bar")).toBeNull();
	},
};

export const CancelDuringExecution: Story = {
	args: {
		projectId: "story-bar-cancel",
		planStatus: "executing",
		stepStatuses: ["completed", "in_progress", "pending", "pending"],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId("work-plan-status-bar");
		await userEvent.click(canvas.getByTestId("work-plan-cancel"));
		// Cancelling an executing plan marks it cancelled → the bar disappears.
		await expect(canvas.queryByTestId("work-plan-status-bar")).toBeNull();
	},
};
