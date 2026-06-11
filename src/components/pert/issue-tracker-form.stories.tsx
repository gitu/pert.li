import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { IssueTrackerForm } from "./issue-tracker-form";

const meta: Meta<typeof IssueTrackerForm> = {
	title: "PERT/IssueTrackerForm",
	component: IssueTrackerForm,
	args: {
		initial: { urlTemplate: "" },
		onCancel: fn(),
		onSave: fn(),
	},
	decorators: [
		(Story) => (
			<div className="max-w-md rounded-md border bg-card/40">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof IssueTrackerForm>;

// Empty form: no preview, reads as clean.
export const Empty: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("tracker-clean")).toBeVisible();
		expect(canvas.queryByTestId("tracker-preview")).toBeNull();
	},
};

// Pre-filled Jira template: preview resolves PROJ-123 to a link.
export const JiraConfigured: Story = {
	args: {
		initial: {
			urlTemplate: "https://acme.atlassian.net/browse/{key}",
			name: "Jira",
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const link = await canvas.findByTestId("issue-link");
		await expect(link).toHaveAttribute(
			"href",
			"https://acme.atlassian.net/browse/PROJ-123",
		);
	},
};

// Typing a template without {key} surfaces the placeholder warning.
export const MissingPlaceholderWarning: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			await canvas.findByTestId("tracker-template-input"),
			"https://acme.atlassian.net/browse/",
		);
		await expect(
			await canvas.findByTestId("tracker-template-warning"),
		).toBeVisible();
		await expect(await canvas.findByTestId("tracker-dirty")).toBeVisible();
	},
};

// Saving emits the trimmed template + name.
export const Saves: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		// userEvent treats `{` as a special-key delimiter — `{{` types a literal
		// brace, so `{{key}` produces the string `{key}`.
		await userEvent.type(
			await canvas.findByTestId("tracker-template-input"),
			"https://acme.atlassian.net/browse/{{key}",
		);
		await userEvent.type(
			await canvas.findByTestId("tracker-name-input"),
			"Jira",
		);
		await userEvent.click(await canvas.findByTestId("tracker-save"));
		expect(args.onSave).toHaveBeenCalledWith({
			urlTemplate: "https://acme.atlassian.net/browse/{key}",
			name: "Jira",
		});
	},
};
