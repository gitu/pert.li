import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { ExportProjectButton } from "./export-button";

const SAMPLE_DOC = (() => {
	const d = createEmptyPertDoc("Q3 launch plan");
	d.tasksById = {
		t1: { id: "t1", kind: "task", title: "Design" },
		m1: { id: "m1", kind: "milestone", title: "Review" },
	};
	return d;
})();

const meta: Meta<typeof ExportProjectButton> = {
	title: "PERT/Exchange/ExportProjectButton",
	component: ExportProjectButton,
	parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof ExportProjectButton>;

export const Default: Story = {
	args: { doc: SAMPLE_DOC, onDownload: fn() },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const button = await canvas.findByTestId("project-export");
		await userEvent.click(button);
		expect(args.onDownload).toHaveBeenCalledTimes(1);
		const [file] = (args.onDownload as ReturnType<typeof fn>).mock.calls[0];
		// Filename is slugified from the project title and gets the format suffix.
		expect(file.filename).toBe("q3-launch-plan.pert.json");
		// Contents are valid JSON with the format discriminator.
		const parsed = JSON.parse(file.contents);
		expect(parsed.format).toBe("pert.li");
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.title).toBe("Q3 launch plan");
		expect(parsed.tasks).toHaveLength(2);
	},
};
