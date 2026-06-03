import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { TooltipProvider } from "#/components/ui/tooltip";
import {
	clearActiveProjectDoc,
	selectTask,
	setActiveProjectDoc,
} from "#/lib/pert/store";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { FullscreenInspectorDock } from "./fullscreen-inspector-dock";

const PROJECT_ID = "story-project";

// Story-side noop changeDoc — the inspector reads `projectDocStore.changeDoc`
// to decide whether to render edit affordances. Passing a function (rather
// than null) shows the editable variant of the form; the mutations don't
// actually run because we're not persisting the draft anywhere.
const noopChangeDoc = (..._args: unknown[]) => {
	/* no-op for stories */
};

function StoryHarness({
	kind,
	onClose,
}: {
	kind: "task" | "container";
	onClose: () => void;
}) {
	useEffect(() => {
		const doc = createEmptyPertDoc("Fullscreen dock story");
		if (kind === "container") {
			doc.tasksById.C1 = {
				id: "C1",
				kind: "container",
				title: "Milestone container",
				parentId: null,
			};
		} else {
			doc.tasksById.T1 = {
				id: "T1",
				kind: "task",
				title: "Fullscreen dock demo task",
				parentId: null,
				estimate: {
					optimistic: 1,
					mostLikely: 3,
					pessimistic: 7,
					unit: "day",
				},
			};
		}
		// biome-ignore lint/suspicious/noExplicitAny: story-only mock for changeDoc; the real type is a ChangeFn from Automerge.
		setActiveProjectDoc(PROJECT_ID, doc, noopChangeDoc as any, null);
		selectTask(PROJECT_ID, kind === "container" ? "C1" : "T1");
		return () => {
			selectTask(PROJECT_ID, null);
			clearActiveProjectDoc(PROJECT_ID);
		};
	}, [kind]);

	return (
		<TooltipProvider delayDuration={150}>
			{/* Mimic the right-side dock panel the project route renders inside a
			    ResizablePanelGroup when fullscreen. */}
			<div className="h-[600px] w-[420px] border bg-card">
				<FullscreenInspectorDock onClose={onClose} />
			</div>
		</TooltipProvider>
	);
}

const meta: Meta<typeof FullscreenInspectorDock> = {
	title: "PERT/Inspector/FullscreenInspectorDock",
	component: FullscreenInspectorDock,
	parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof FullscreenInspectorDock>;

export const TaskSelected: Story = {
	render: () => <StoryHarness kind="task" onClose={fn()} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByTestId("fullscreen-inspector-dock"),
		).toBeVisible();
		// No `pane` prop → TaskInspector mounts its internal tab strip.
		await expect(
			await canvas.findByTestId("inspector-tab-details"),
		).toBeVisible();
		await expect(await canvas.findByTestId("inspector-tab-plan")).toBeVisible();
		await expect(
			await canvas.findByTestId("inspector-tab-track"),
		).toBeVisible();
	},
};

export const ContainerSelected: Story = {
	render: () => <StoryHarness kind="container" onClose={fn()} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByTestId("fullscreen-inspector-dock"),
		).toBeVisible();
	},
};

export const CloseButton: Story = {
	render: (args) => <StoryHarness kind="task" onClose={args.onClose} />,
	args: { onClose: fn() },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const close = await canvas.findByTestId("fullscreen-inspector-close");
		await userEvent.click(close);
		await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1));
	},
};
