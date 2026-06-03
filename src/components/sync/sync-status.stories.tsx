import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { PendingProject } from "#/lib/sync/pending-projects";
import { SyncStatusView } from "./sync-status";

function item(over: Partial<PendingProject> = {}): PendingProject {
	return {
		localId: over.localId ?? "local-1",
		title: over.title ?? "Q3 launch plan",
		automergeDocUrl: `automerge:${over.localId ?? "local-1"}` as never,
		createdAt: "2026-06-03T00:00:00.000Z",
		status: "pending",
		attempts: 0,
		...over,
	};
}

const meta: Meta<typeof SyncStatusView> = {
	title: "Sync/SyncStatus",
	component: SyncStatusView,
	parameters: { layout: "centered" },
	args: { onRetry: fn(), onDiscard: fn() },
};

export default meta;

type Story = StoryObj<typeof SyncStatusView>;

// Online + nothing queued → the indicator renders nothing.
export const SyncedAndOnline: Story = {
	args: { online: true, items: [] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(canvas.queryByTestId("sync-status-trigger")).toBeNull();
	},
};

export const Offline: Story = {
	args: {
		online: false,
		items: [item(), item({ localId: "local-2", title: "Migration plan" })],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(await canvas.findByTestId("sync-status-badge")).toHaveTextContent(
			/offline/i,
		);
	},
};

export const Syncing: Story = {
	args: {
		online: true,
		items: [item({ status: "registering" })],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(await canvas.findByTestId("sync-status-badge")).toHaveTextContent(
			/syncing/i,
		);
	},
};

export const PendingOnline: Story = {
	args: {
		online: true,
		items: [item(), item({ localId: "local-2" })],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(await canvas.findByTestId("sync-status-badge")).toHaveTextContent(
			/pending/i,
		);
	},
};

export const Errored: Story = {
	args: {
		online: true,
		items: [
			item({
				localId: "local-err",
				title: "Blocked plan",
				status: "error",
				lastErrorKind: "terminal",
				lastError: "Write access to this workspace is required",
			}),
		],
	},
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const badge = await canvas.findByTestId("sync-status-badge");
		expect(badge).toHaveTextContent(/failed to sync/i);
		await userEvent.click(canvas.getByTestId("sync-status-trigger"));
		// Popover content portals to the body — search the whole document.
		const screen = within(document.body);
		const retry = await screen.findByTestId("sync-retry-local-err");
		await userEvent.click(retry);
		expect(args.onRetry).toHaveBeenCalledWith("local-err");
	},
};
