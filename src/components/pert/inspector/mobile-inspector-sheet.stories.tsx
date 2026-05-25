import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect, waitFor, within } from "storybook/test";
import {
	clearActiveProjectDoc,
	selectTask,
	setActiveProjectDoc,
} from "#/lib/pert/store";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { MobileInspectorSheet } from "./mobile-inspector-sheet";

const PROJECT_ID = "story-project";

// Story-side noop changeDoc — the inspector reads `projectDocStore.changeDoc`
// to decide whether to render edit affordances. Passing a function (rather
// than null) shows the editable variant of the form; the mutations don't
// actually run because we're not persisting the draft anywhere.
const noopChangeDoc = (..._args: unknown[]) => {
	/* no-op for stories */
};

function StoryHarness({ selectedTaskId }: { selectedTaskId: string | null }) {
	useEffect(() => {
		const doc = createEmptyPertDoc("Phase 2 mobile story");
		doc.tasksById.T1 = {
			id: "T1",
			kind: "task",
			title: "Mobile inspector demo task",
			parentId: null,
			estimate: { optimistic: 1, mostLikely: 3, pessimistic: 7, unit: "day" },
		};
		// biome-ignore lint/suspicious/noExplicitAny: story-only mock for changeDoc; the real type is a ChangeFn from Automerge.
		setActiveProjectDoc(PROJECT_ID, doc, noopChangeDoc as any, null);
		if (selectedTaskId) selectTask(PROJECT_ID, selectedTaskId);
		return () => {
			selectTask(PROJECT_ID, null);
			clearActiveProjectDoc(PROJECT_ID);
		};
	}, [selectedTaskId]);
	return (
		<div className="grid h-[600px] w-[390px] place-items-center bg-background text-sm text-muted-foreground">
			Underlying view (canvas, list, etc.)
			<MobileInspectorSheet projectId={PROJECT_ID} />
		</div>
	);
}

const meta: Meta<typeof MobileInspectorSheet> = {
	title: "PERT/Inspector/MobileInspectorSheet",
	component: MobileInspectorSheet,
	parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof MobileInspectorSheet>;

export const ClosedByDefault: Story = {
	render: () => <StoryHarness selectedTaskId={null} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.queryByTestId("mobile-inspector-sheet"),
		).not.toBeInTheDocument();
	},
};

export const OpenForSelectedTask: Story = {
	render: () => <StoryHarness selectedTaskId="T1" />,
	play: async () => {
		// Sheet content portals out of `canvasElement` into document.body,
		// so query against the broader document scope.
		await waitFor(async () => {
			const root = within(document.body);
			expect(
				await root.findByTestId("mobile-inspector-sheet"),
			).toBeInTheDocument();
		});
		const root = within(document.body);
		await expect(
			await root.findByRole("heading", { name: "Task details" }),
		).toBeVisible();
	},
};
