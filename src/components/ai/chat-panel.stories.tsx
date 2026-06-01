import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ChatPanel } from "./chat-panel";

// Wraps the panel in a fixed-size box so it has a chrome to scroll in.
function Stage({ children }: { children: React.ReactNode }) {
	return (
		<div className="h-[520px] w-[420px] overflow-hidden rounded-md border bg-background">
			{children}
		</div>
	);
}

const meta: Meta<typeof ChatPanel> = {
	title: "AI/ChatPanel",
	component: ChatPanel,
	parameters: { layout: "centered" },
	decorators: [(Story) => <Stage>{Story()}</Stage>],
};

export default meta;

type Story = StoryObj<typeof ChatPanel>;

// The default story points at /api/chat — in Storybook that route doesn't
// exist, so we expect the panel to render but show an empty conversation
// until the user types. The send button is disabled while input is empty.
export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const panel = await canvas.findByTestId("chat-panel");
		expect(panel).toBeInTheDocument();
		const input = await canvas.findByTestId("chat-input");
		expect(input).toBeInTheDocument();
		const send = await canvas.findByTestId("chat-send");
		expect(send).toBeDisabled();
	},
};

// Endpoint clearly broken — stays empty, never errors at construction time.
export const NoEndpoint: Story = {
	args: { endpoint: "/api/__missing__" },
};

// Seeded prompt for design review screenshots — text appears in the input on
// mount, so the send button enables immediately.
export const WithSeedPrompt: Story = {
	args: {
		initialPrompt: "Break the Q3 launch into 8 tasks with PERT estimates.",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const send = await canvas.findByTestId("chat-send");
		expect(send).not.toBeDisabled();
	},
};

// Drives the hidden <input type="file"> directly — exercises the markdown
// extraction path (no PDF/DOCX bundle needed) and the chip + parsed-state
// transition.
export const WithAttachedMarkdown: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = (await canvas.findByTestId(
			"chat-file-input",
		)) as HTMLInputElement;
		const file = new File(
			[
				"# Auth spec\n- OIDC discovery: needs token rotation\n- Session refresh: 24h sliding window\n",
			],
			"auth-spec.md",
			{ type: "text/markdown" },
		);
		await userEvent.upload(input, file);
		await waitFor(async () => {
			const chip = await canvas.findByTestId(/^chat-attachment-/);
			expect(chip).toHaveAttribute("data-status", "ready");
		});
		// Send is enabled when an attachment is ready even with empty body.
		const send = await canvas.findByTestId("chat-send");
		await waitFor(() => expect(send).not.toBeDisabled());
	},
};
