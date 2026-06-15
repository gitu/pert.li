import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
	CopyDisplayToProjectsDialog,
	type CopyTargetProject,
} from "./copy-display-to-projects-dialog";

const PROJECTS: CopyTargetProject[] = [
	{ id: "p1", title: "Q3 launch", url: "automerge:p1" },
	{ id: "p2", title: "Website rebuild", url: "automerge:p2" },
	{ id: "p3", title: "Mobile app", url: "automerge:p3" },
];

const meta: Meta<typeof CopyDisplayToProjectsDialog> = {
	title: "PERT/CopyDisplayToProjectsDialog",
	component: CopyDisplayToProjectsDialog,
	args: {
		open: true,
		onOpenChange: fn(),
		projects: PROJECTS,
		onCopy: fn(async () => {}),
	},
};
export default meta;

// The dialog renders into a portal, so query the document body, not canvasElement.
type Story = StoryObj<typeof CopyDisplayToProjectsDialog>;

// Confirm is disabled until at least one project is picked.
export const Default: Story = {
	play: async () => {
		const screen = within(document.body);
		const confirm = await screen.findByTestId("copy-display-confirm");
		await expect(confirm).toBeDisabled();
		await userEvent.click(screen.getByTestId("copy-display-target-p2"));
		await expect(confirm).toBeEnabled();
	},
};

// Select-all picks every project; confirm fans the chosen urls to onCopy.
export const SelectAllAndCopy: Story = {
	play: async ({ args }) => {
		const screen = within(document.body);
		await userEvent.click(await screen.findByTestId("copy-display-select-all"));
		await userEvent.click(screen.getByTestId("copy-display-confirm"));
		expect(args.onCopy).toHaveBeenCalledWith([
			"automerge:p1",
			"automerge:p2",
			"automerge:p3",
		]);
	},
};

// Empty state when there are no other projects to copy to.
export const Empty: Story = {
	args: { projects: [] },
	play: async () => {
		const screen = within(document.body);
		// The empty-state copy renders, and with nothing selectable the confirm
		// button stays disabled. (Assert presence + text rather than racing the
		// dialog's open transition with toBeVisible.)
		const empty = await screen.findByTestId("copy-display-empty");
		await expect(empty).toHaveTextContent(/no other projects/i);
		await expect(screen.getByTestId("copy-display-confirm")).toBeDisabled();
	},
};
