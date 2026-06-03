import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { UserMessage } from "./user-message";

// Mirrors the bubble styling MessageRow gives user messages so the stories
// look like the real chat.
function Bubble({ children }: { children: React.ReactNode }) {
	return (
		<div className="max-w-[360px] whitespace-pre-wrap break-words rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-xs">
			{children}
		</div>
	);
}

const meta = {
	title: "AI/UserMessage",
	component: UserMessage,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<Bubble>
				<Story />
			</Bubble>
		),
	],
} satisfies Meta<typeof UserMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

const SPEC_TEXT = [
	"# Auth spec",
	"",
	"## OIDC discovery",
	"The discovery endpoint must be cached for 24h. Token rotation is",
	"mandatory for refresh tokens older than 7 days.",
	"",
	"## Session refresh",
	"Sliding 24h window; absolute cap at 30 days.",
].join("\n");

export const PlainText: Story = {
	args: { text: "Break the Q3 launch into 8 tasks with PERT estimates." },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText(/Break the Q3 launch into 8 tasks/),
		).toBeInTheDocument();
		// No attachment chrome for plain messages.
		expect(canvas.queryByTestId("chat-user-attachment")).toBeNull();
	},
};

export const WithAttachment: Story = {
	args: {
		text: [
			"Estimate the tasks in this spec",
			"",
			"--- Attached: auth-spec.md ---",
			SPEC_TEXT,
			"--- /Attached ---",
		].join("\n"),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// The typed body renders…
		await expect(
			canvas.getByText("Estimate the tasks in this spec"),
		).toBeInTheDocument();
		// …the attachment collapses into a chip showing the filename…
		const chip = canvas.getByTestId("chat-user-attachment");
		await expect(chip).toHaveAttribute("data-state", "closed");
		await expect(canvas.getByText("auth-spec.md")).toBeInTheDocument();
		// …and the file content is NOT dumped into the bubble.
		expect(canvas.queryByText(/Token rotation is/)).toBeNull();
	},
};

export const ExpandAttachment: Story = {
	args: {
		text: [
			"Estimate the tasks in this spec",
			"",
			"--- Attached: auth-spec.md ---",
			SPEC_TEXT,
			"--- /Attached ---",
		].join("\n"),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const chip = canvas.getByTestId("chat-user-attachment");
		await userEvent.click(within(chip).getByRole("button"));
		await expect(chip).toHaveAttribute("data-state", "open");
		// Expanded: the content is visible (inside a scrollable pre).
		await expect(canvas.getByText(/Token rotation is/)).toBeInTheDocument();
		// Collapse again.
		await userEvent.click(within(chip).getByRole("button"));
		await expect(chip).toHaveAttribute("data-state", "closed");
	},
};

export const MultipleAttachments: Story = {
	args: {
		text: [
			"Compare these two versions",
			"",
			"--- Attached: plan-v1.pdf · 12 pages ---",
			"Version one content here.",
			"--- /Attached ---",
			"",
			"--- Attached: plan-v2.pdf · 14 pages (truncated) ---",
			"Version two content here.",
			"--- /Attached ---",
		].join("\n"),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const chips = canvas.getAllByTestId("chat-user-attachment");
		expect(chips).toHaveLength(2);
		// Page-count and truncation annotations carry through to the labels.
		await expect(
			canvas.getByText("plan-v1.pdf · 12 pages"),
		).toBeInTheDocument();
		await expect(
			canvas.getByText("plan-v2.pdf · 14 pages (truncated)"),
		).toBeInTheDocument();
	},
};

export const DropOnlySend: Story = {
	args: {
		text: [
			"Reference material attached:",
			"",
			"--- Attached: requirements.docx ---",
			"All the requirements.",
			"--- /Attached ---",
		].join("\n"),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText("Reference material attached:"),
		).toBeInTheDocument();
		expect(canvas.getAllByTestId("chat-user-attachment")).toHaveLength(1);
	},
};
