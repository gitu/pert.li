import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { resolveDisplaySettings } from "#/lib/pert/display";
import { DisplaySettingsForm } from "./display-settings-form";

// All-defaults resolved config (detailed layout, registry default-on fields).
const DEFAULTS = resolveDisplaySettings(undefined);

const meta: Meta<typeof DisplaySettingsForm> = {
	title: "PERT/DisplaySettingsForm",
	component: DisplaySettingsForm,
	args: {
		initial: DEFAULTS,
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

type Story = StoryObj<typeof DisplaySettingsForm>;

// Freshly seeded form reads as clean, with all fields checked by default.
export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("display-clean")).toBeVisible();
		expect(canvas.queryByTestId("display-dirty")).toBeNull();
		await expect(
			canvas.getByTestId("display-overview-field-count"),
		).toBeChecked();
	},
};

// Toggling a field off flips the footer to "Unsaved changes".
export const Dirty: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("display-clean")).toBeVisible();
		await userEvent.click(
			canvas.getByTestId("display-overview-field-duration"),
		);
		await expect(await canvas.findByTestId("display-dirty")).toBeVisible();
		expect(canvas.queryByTestId("display-clean")).toBeNull();
	},
};

// Switching the canvas to compact + hiding a field, then Save, emits the full
// per-surface payload (the mutator distils it to the sparse on-doc form).
export const Saves: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByTestId("display-canvas-mode-compact"));
		await userEvent.click(canvas.getByTestId("display-canvas-field-slack"));
		await userEvent.click(canvas.getByTestId("display-save"));
		expect(args.onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				canvas: expect.objectContaining({
					layout: "compact",
					fields: expect.objectContaining({ slack: false }),
				}),
			}),
		);
	},
};

// The "Copy to other projects…" action only renders when the parent wires it
// (i.e. there are other projects). Clicking it hands the current settings up.
export const WithCopy: Story = {
	args: { onCopyToProjects: fn() },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByTestId("display-copy-open"));
		expect(args.onCopyToProjects).toHaveBeenCalledWith(
			expect.objectContaining({
				overview: expect.anything(),
				canvas: expect.anything(),
			}),
		);
	},
};
