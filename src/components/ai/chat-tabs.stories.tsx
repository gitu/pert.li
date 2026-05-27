import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import type { ThreadMeta } from "#/lib/chat-history";
import { ChatTabs } from "./chat-tabs";

// Renders the tab strip used at the top of the chat panel to switch between
// chat threads. The chat panel owns thread state; we drive the surface
// directly here.

function Stage({ children }: { children: React.ReactNode }) {
	return (
		<div className="w-[480px] overflow-hidden rounded-md border bg-background">
			{children}
		</div>
	);
}

function makeThread(id: string, title: string, offset = 0): ThreadMeta {
	const t = 1_700_000_000_000 + offset;
	return { id, title, createdAt: t, updatedAt: t };
}

const oneThread = [makeThread("t1", "New chat")];

const fewThreads = [
	makeThread("t1", "Launch plan", 1),
	makeThread("t2", "Risk register", 2),
	makeThread("t3", "Standup notes", 3),
];

const manyThreads = Array.from({ length: 12 }).map((_, i) =>
	makeThread(`t${i + 1}`, `Thread ${i + 1} with a fairly long title`, i),
);

const meta: Meta<typeof ChatTabs> = {
	title: "AI/ChatTabs",
	component: ChatTabs,
	parameters: { layout: "centered" },
	decorators: [(Story) => <Stage>{Story()}</Stage>],
	args: {
		threads: fewThreads,
		activeThreadId: "t1",
		onSelect: fn(),
		onCreate: fn(),
		onClose: fn(),
		onRename: fn(),
		// Stories assume empty threads so the close button skips the confirm().
		isThreadEmpty: () => true,
	},
};

export default meta;

type Story = StoryObj<typeof ChatTabs>;

export const SingleThread: Story = {
	args: { threads: oneThread, activeThreadId: "t1" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId("chat-tabs");
		// Close button is hidden with a single thread.
		expect(canvas.queryByTestId("chat-tab-close-t1")).toBeNull();
		expect(await canvas.findByTestId("chat-tab-new")).toBeInTheDocument();
	},
};

export const SeveralThreads: Story = {
	args: { threads: fewThreads, activeThreadId: "t2" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const active = await canvas.findByTestId("chat-tab-t2");
		expect(active).toHaveAttribute("aria-selected", "true");
		const inactive = await canvas.findByTestId("chat-tab-t1");
		expect(inactive).toHaveAttribute("aria-selected", "false");
	},
};

export const ManyThreadsScroll: Story = {
	args: { threads: manyThreads, activeThreadId: "t1" },
};

export const CreateFiresOnPlusClick: Story = {
	args: { onCreate: fn() },
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("chat-tab-new"));
		expect(args.onCreate).toHaveBeenCalledTimes(1);
	},
};

export const SelectFiresOnTabClick: Story = {
	args: { onSelect: fn() },
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("chat-tab-t3"));
		expect(args.onSelect).toHaveBeenLastCalledWith("t3");
	},
};

export const RenameOnDoubleClick: Story = {
	args: { onRename: fn() },
	render: function Render(props) {
		// Local state proves the controlled-rename flow renders correctly when
		// the parent commits the new title back into the threads prop.
		const [threads, setThreads] = useState(fewThreads);
		return (
			<ChatTabs
				{...props}
				threads={threads}
				onRename={(id, next) => {
					props.onRename(id, next);
					setThreads((cur) =>
						cur.map((t) => (t.id === id ? { ...t, title: next } : t)),
					);
				}}
			/>
		);
	},
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		const tab = await canvas.findByTestId("chat-tab-t1");
		await userEvent.dblClick(tab);
		const input = await canvas.findByTestId("chat-tab-rename-t1");
		await userEvent.clear(input);
		await userEvent.type(input, "Renamed");
		await userEvent.tab();
		expect(args.onRename).toHaveBeenLastCalledWith("t1", "Renamed");
		await canvas.findByText("Renamed");
	},
};
