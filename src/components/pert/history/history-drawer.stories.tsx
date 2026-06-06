import * as Automerge from "@automerge/automerge";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { clearActiveProjectDoc, setActiveProjectDoc } from "#/lib/pert/store";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import { HistoryDrawer } from "./history-drawer";

// Fixed commit timestamps, pinned to specific dates well in the past. The
// drawer's `formatTime` only renders a stable absolute date for changes older
// than 14 days; anything newer becomes a live "Ns/Nm/Nh/Nd ago" counter
// measured against `Date.now()`, which drifts between the baseline build and
// the PR build and would flag this story in the screenshot diff on every run.
// Spacing them apart keeps the three commit-groups distinct. `time` is in
// seconds (Automerge's unit; see src/lib/pert/history.ts).
const COMMIT_TIMES = {
	initial: Math.floor(Date.UTC(2026, 0, 12, 9, 0, 0) / 1000),
	reestimate: Math.floor(Date.UTC(2026, 0, 14, 14, 30, 0) / 1000),
	progress: Math.floor(Date.UTC(2026, 0, 16, 11, 15, 0) / 1000),
};

// Build an Automerge doc with three commit-groups so the history drawer has
// something interesting to render. Each Automerge.change call lands as its
// own change in the history log.
function seededHistoryDoc(): Automerge.Doc<PertDoc> {
	let doc = Automerge.from(createEmptyPertDoc("History demo"));
	doc = Automerge.change(
		doc,
		{ message: "Add initial tasks", time: COMMIT_TIMES.initial },
		(d) => {
			d.tasksById.A = {
				id: "A",
				kind: "task",
				title: "Design",
				parentId: null,
				estimate: { optimistic: 1, mostLikely: 2, pessimistic: 3, unit: "day" },
			};
			d.tasksById.B = {
				id: "B",
				kind: "task",
				title: "Build",
				parentId: null,
				estimate: { optimistic: 2, mostLikely: 4, pessimistic: 6, unit: "day" },
			};
		},
	);
	doc = Automerge.change(
		doc,
		{ message: "Re-estimate B", time: COMMIT_TIMES.reestimate },
		(d) => {
			const b = d.tasksById.B;
			if (b) {
				b.estimate = {
					optimistic: 3,
					mostLikely: 5,
					pessimistic: 9,
					unit: "day",
				};
				b.title = "Build (API + worker)";
			}
		},
	);
	doc = Automerge.change(
		doc,
		{ message: "Mark A in progress", time: COMMIT_TIMES.progress },
		(d) => {
			const a = d.tasksById.A;
			if (a) {
				a.status = "in_progress";
				a.progress = 40;
				a.actualStart = "2026-05-20";
			}
		},
	);
	return doc;
}

function Stage({ projectId }: { projectId: string }) {
	const [doc, setDoc] = useState<Automerge.Doc<PertDoc>>(() =>
		seededHistoryDoc(),
	);

	useEffect(() => {
		setActiveProjectDoc(
			projectId,
			doc as PertDoc,
			(mutate) => {
				setDoc((current) => Automerge.change(current, (d) => mutate(d)));
			},
			null,
		);
		return () => clearActiveProjectDoc(projectId);
	}, [projectId, doc]);

	return (
		<div className="h-[520px] w-full max-w-5xl overflow-hidden rounded-md border bg-background">
			<HistoryDrawer />
		</div>
	);
}

const meta = {
	title: "PERT/HistoryDrawer",
	component: Stage,
	parameters: { layout: "padded" },
} satisfies Meta<typeof Stage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HistoryVsCurrent: Story = {
	args: { projectId: "story-history-vs-current" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId("history-drawer");
		// Three commit-groups should land — newest first.
		const rows = await canvas.findAllByTestId(/^history-row-\d+$/);
		await expect(rows.length).toBeGreaterThanOrEqual(3);

		// Click the second-newest group; diff-pane shows snapshot vs current.
		await userEvent.click(rows[1]);
		await waitFor(() =>
			expect(canvas.getByTestId("diff-pane")).toBeInTheDocument(),
		);
		// Restore mode shows action buttons.
		await waitFor(() => {
			const restoreButtons = canvasElement.querySelectorAll(
				'[data-testid^="diff-action-"]',
			);
			expect(restoreButtons.length).toBeGreaterThan(0);
		});
	},
};

export const TwoSnapshotCompare: Story = {
	args: { projectId: "story-history-two-snapshots" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId("history-drawer");

		// Toggle into compare-two mode.
		const toggle = await canvas.findByTestId("history-toggle-compare-two");
		await userEvent.click(toggle);

		const rows = await canvas.findAllByTestId(/^history-row-\d+$/);
		// Pick A (newest) then B (older); the drawer flips to A-vs-B view.
		await userEvent.click(rows[0]);
		await userEvent.click(rows[2]);

		await waitFor(() =>
			expect(canvas.getByTestId("diff-pane")).toBeInTheDocument(),
		);
		// In two-snapshot mode action buttons are hidden.
		const restoreButtons = canvasElement.querySelectorAll(
			'[data-testid^="diff-action-"]',
		);
		await expect(restoreButtons.length).toBe(0);
		// Header reads "Commit #A vs commit #B".
		await expect(canvas.getByText(/vs commit #/)).toBeInTheDocument();
	},
};
