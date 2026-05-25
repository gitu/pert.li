import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ChoicePrompt, type PendingChoice } from "./chat-panel";

// Renders the chip panel that appears above the input when the assistant
// has asked a multiple-choice question. The chat panel itself owns the
// message state, so we test the chip surface directly.

function Stage({ children }: { children: React.ReactNode }) {
	return (
		<div className="w-[420px] overflow-hidden rounded-md border bg-background">
			{children}
		</div>
	);
}

const tutorialPrompt: PendingChoice = {
	toolCallId: "tc_tutorial",
	question: "Ready for the critical-path part, or want another worked example?",
	options: [
		{ label: "Critical path next" },
		{ label: "Another example" },
		{ label: "I'm done with this section", value: "Skip ahead" },
	],
};

const meta: Meta<typeof ChoicePrompt> = {
	title: "AI/ChoicePrompt",
	component: ChoicePrompt,
	parameters: { layout: "centered" },
	decorators: [(Story) => <Stage>{Story()}</Stage>],
	args: {
		prompt: tutorialPrompt,
		disabled: false,
		onChoose: fn(),
	},
};

export default meta;

type Story = StoryObj<typeof ChoicePrompt>;

export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const root = await canvas.findByTestId("chat-choice-prompt");
		expect(root).toBeInTheDocument();
		const chips = await canvas.findAllByTestId("chat-choice-option");
		expect(chips).toHaveLength(3);
	},
};

// Clicking a chip without a `value` sends the label; clicking one with a
// `value` sends the override. Both paths are exercised here.
export const SendsLabelByDefault: Story = {
	args: { onChoose: fn() },
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		const chips = await canvas.findAllByTestId("chat-choice-option");
		await userEvent.click(chips[0]);
		expect(args.onChoose).toHaveBeenLastCalledWith("Critical path next");
	},
};

export const SendsValueWhenProvided: Story = {
	args: { onChoose: fn() },
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		const chips = await canvas.findAllByTestId("chat-choice-option");
		await userEvent.click(chips[2]);
		expect(args.onChoose).toHaveBeenLastCalledWith("Skip ahead");
	},
};

// While the chat is mid-stream we don't want stray clicks queueing up — the
// chips render disabled.
export const Disabled: Story = {
	args: { disabled: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const chips = await canvas.findAllByTestId("chat-choice-option");
		for (const chip of chips) expect(chip).toBeDisabled();
	},
};

// Lots of options — verify they wrap rather than overflow.
export const ManyOptions: Story = {
	args: {
		prompt: {
			toolCallId: "tc_many",
			question: "Which dependency type do you want?",
			options: [
				{ label: "Finish → Start" },
				{ label: "Start → Start" },
				{ label: "Finish → Finish" },
				{ label: "Start → Finish" },
				{ label: "Cancel" },
			],
		},
	},
};
