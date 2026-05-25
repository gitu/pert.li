import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TutorialCard } from "./tutorial-card";

const meta: Meta<typeof TutorialCard> = {
	title: "Workspace/TutorialCard",
	component: TutorialCard,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="max-w-3xl">
				<Story />
			</div>
		),
	],
};

export default meta;

type Story = StoryObj<typeof TutorialCard>;

export const Default: Story = {
	args: { onStart: fn() },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const card = await canvas.findByTestId("tutorial-card");
		expect(card).toBeInTheDocument();
		// Each seeded topic should be reachable as a button.
		expect(
			await canvas.findByTestId("tutorial-seed-what-is-pert"),
		).toBeInTheDocument();
		expect(
			await canvas.findByTestId("tutorial-seed-three-point-estimates"),
		).toBeInTheDocument();
		expect(
			await canvas.findByTestId("tutorial-seed-critical-path-explained"),
		).toBeInTheDocument();
		expect(
			await canvas.findByTestId("tutorial-seed-walk-me-through-pert-li"),
		).toBeInTheDocument();
	},
};

// Clicking a topic chip invokes onStart with the seed prompt + label, so the
// app shell can route it to the chat dock.
export const InvokesOnStart: Story = {
	args: { onStart: fn() },
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		const chip = await canvas.findByTestId("tutorial-seed-what-is-pert");
		await userEvent.click(chip);
		expect(args.onStart).toHaveBeenCalledTimes(1);
		const [prompt, label] = (args.onStart as ReturnType<typeof fn>).mock
			.calls[0];
		expect(label).toBe("What is PERT?");
		expect(prompt).toMatch(/PERT/);
	},
};
