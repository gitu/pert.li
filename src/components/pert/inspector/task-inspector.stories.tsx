import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TooltipProvider } from "#/components/ui/tooltip";
import {
	clearActiveProjectDoc,
	selectTask,
	setActiveProjectDoc,
} from "#/lib/pert/store";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { TaskInspector } from "./task-inspector";

const PROJECT_ID = "story-project";

// The inspector derives its read-only state from the active project doc's
// `changeDoc`: `readOnly = !changeDoc`. View-mode share links (and the mobile
// read-only shell) withhold it — the store carries `changeDoc === null`. So we
// drive both variants purely by what we hand `setActiveProjectDoc`:
//   • a function → editable (every edit affordance live)
//   • null       → read-only (the view-share recipient's surface)
const noopChangeDoc = (..._args: unknown[]) => {
	/* no-op for stories; mutations aren't persisted here */
};

function StoryHarness({
	changeDoc,
	withIssues,
}: {
	changeDoc: ((mutate: (d: unknown) => void) => void) | null;
	withIssues?: boolean;
}) {
	useEffect(() => {
		const doc = createEmptyPertDoc("Inspector read-only story");
		doc.tasksById.T1 = {
			id: "T1",
			kind: "task",
			title: "Ship the beta",
			estimate: {
				optimistic: 2,
				mostLikely: 5,
				pessimistic: 9,
				unit: "day",
			},
		};
		if (withIssues) {
			doc.issueTracker = {
				urlTemplate: "https://acme.atlassian.net/browse/{key}",
				name: "Jira",
			};
			doc.tasksById.T1.issueKeys = ["PROJ-1", "PROJ-2"];
		}
		setActiveProjectDoc(
			PROJECT_ID,
			doc,
			// biome-ignore lint/suspicious/noExplicitAny: story-only mock; the real type is Automerge's ChangeFn.
			changeDoc as any,
			null,
		);
		selectTask(PROJECT_ID, "T1");
		return () => {
			selectTask(PROJECT_ID, null);
			clearActiveProjectDoc(PROJECT_ID);
		};
	}, [changeDoc, withIssues]);

	return (
		<TooltipProvider delayDuration={150}>
			<div className="h-[640px] w-[420px] overflow-hidden border bg-card">
				{/* `pane="plan"` puts the title field and the delete control in one
				    pane, so both edit affordances are reachable without tabbing. */}
				<TaskInspector pane="plan" />
			</div>
		</TooltipProvider>
	);
}

const meta: Meta<typeof TaskInspector> = {
	title: "PERT/Inspector/TaskInspector",
	component: TaskInspector,
	parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof TaskInspector>;

// Editable: no read-only banner, and confirming the delete clears the real
// selection store — the inspector drops to its empty state. That selection
// clear is the side effect the read-only gate suppresses, so it's the cleanest
// behavioural contrast with the ReadOnly story below.
export const Editable: Story = {
	render: () => <StoryHarness changeDoc={noopChangeDoc} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("inspector-title")).toHaveValue(
			"Ship the beta",
		);
		expect(canvas.queryByTestId("inspector-readonly-banner")).toBeNull();

		// Two-click armed confirm runs onDelete → selection cleared.
		const del = await canvas.findByTestId("inspector-delete");
		await userEvent.click(del);
		await userEvent.click(await canvas.findByTestId("inspector-delete"));

		await waitFor(() =>
			expect(canvas.getByText(/Select a task or group to edit/i)).toBeVisible(),
		);
	},
};

// With a configured tracker, the Plan pane's issue-links editor shows the
// task's keys as click-through links plus the add input. (The harness uses a
// no-op changeDoc, so we assert the rendered/read state rather than a mutation.)
export const WithIssueLinks: Story = {
	render: () => <StoryHarness changeDoc={noopChangeDoc} withIssues />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const editor = await canvas.findByTestId("issue-links-editor");
		const links = await within(editor).findAllByTestId("issue-link");
		expect(links).toHaveLength(2);
		await expect(links[0]).toHaveAttribute(
			"href",
			"https://acme.atlassian.net/browse/PROJ-1",
		);
		// The add affordance is present.
		await expect(
			await within(editor).findByTestId("issue-link-add"),
		).toBeVisible();
	},
};

// Read-only (a view-share recipient): the banner is shown, and the same
// delete gesture is inert — the task stays selected (banner persists) because
// `onDelete` early-returns when `changeDoc` is null.
export const ReadOnly: Story = {
	render: () => <StoryHarness changeDoc={null} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByTestId("inspector-readonly-banner"),
		).toBeVisible();
		// The title still renders (recipients can read), unchanged…
		await expect(await canvas.findByTestId("inspector-title")).toHaveValue(
			"Ship the beta",
		);

		// …and the delete control, though present, does nothing.
		const del = await canvas.findByTestId("inspector-delete");
		await userEvent.click(del);
		await userEvent.click(await canvas.findByTestId("inspector-delete"));

		// Selection was never cleared → the read-only surface is still mounted.
		await expect(canvas.getByTestId("inspector-readonly-banner")).toBeVisible();
		expect(canvas.queryByText(/Select a task or group to edit/i)).toBeNull();
	},
};
