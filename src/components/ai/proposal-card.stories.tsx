import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { EditOp } from "#/lib/ai/operations";
import {
	createProposal,
	proposalsStore,
	rejectProposal,
} from "#/lib/ai/proposals-store";
import { clearActiveProjectDoc, setActiveProjectDoc } from "#/lib/pert/store";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import { ProposalCard } from "./proposal-card";

function seedDoc(): PertDoc {
	const d = createEmptyPertDoc("Proposal demo");
	d.tasksById.A = {
		id: "A",
		kind: "task",
		title: "Spike OIDC discovery",
		parentId: null,
		estimate: { optimistic: 1, mostLikely: 2, pessimistic: 3, unit: "day" },
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "Wire callback route",
		parentId: null,
		estimate: { optimistic: 1, mostLikely: 2, pessimistic: 4, unit: "day" },
	};
	d.tasksById.C = {
		id: "C",
		kind: "task",
		title: "Session refresh",
		parentId: null,
		estimate: { optimistic: 2, mostLikely: 3, pessimistic: 5, unit: "day" },
	};
	return d;
}

const reEstimateOps: EditOp[] = [
	{
		op: "set_estimate",
		taskId: "A",
		optimistic: 3,
		mostLikely: 5,
		pessimistic: 9,
	},
	{
		op: "set_estimate",
		taskId: "B",
		optimistic: 2,
		mostLikely: 4,
		pessimistic: 7,
	},
	{
		op: "set_estimate",
		taskId: "C",
		optimistic: 3,
		mostLikely: 5,
		pessimistic: 8,
	},
	{
		op: "add_task",
		id: "D",
		title: "Token rotation strategy",
		estimate: { optimistic: 1, mostLikely: 2, pessimistic: 4, unit: "day" },
	},
];

const rationale =
	"Re-estimated auth tasks from the attached OIDC spec — the discovery and session-refresh paths are wider than the original 1/2/3 day pad. Adding a small task for token-rotation strategy.";

// The degenerate pattern weaker models produce when they can't form the full
// operations array: placeholder ops referencing ids that don't exist. Every
// one of these fails to stage.
const placeholderOps: EditOp[] = [
	{
		op: "set_title",
		taskId: "__PROJECT__",
		title: "Renamed project placeholder",
	},
	{ op: "remove_task", taskId: "bogus" },
];

// A batch that deletes an existing task. Deletions are hard to undo, so
// "Apply all" must route through a confirm dialog rather than mutating on the
// first click.
const deleteOps: EditOp[] = [
	{ op: "remove_task", taskId: "C" },
	{ op: "set_title", taskId: "A", title: "Spike OIDC discovery (revised)" },
];

function Stage({
	projectId,
	proposalProjectId,
	operations = reEstimateOps,
}: {
	projectId: string;
	// The project the proposal claims to belong to. Defaults to the active
	// one; pass something else to exercise the cross-project guard.
	proposalProjectId?: string;
	// The staged operations. Defaults to the healthy re-estimate batch; pass
	// `placeholderOps` to exercise the all-failed state.
	operations?: EditOp[];
}) {
	const [doc, setDoc] = useState<PertDoc>(() => seedDoc());
	// Seed the proposal eagerly so the diff is computed off the original
	// seedDoc — not a draft the user may have already mutated via apply-row.
	const [proposalId] = useState<string>(() => {
		const { proposal } = createProposal(
			doc,
			rationale,
			operations,
			proposalProjectId ?? projectId,
		);
		return proposal.id;
	});

	useEffect(() => {
		const changeDoc = (mutate: (d: PertDoc) => void) => {
			setDoc((current) => {
				const draft: PertDoc = structuredClone(current);
				mutate(draft);
				return draft;
			});
		};
		setActiveProjectDoc(projectId, doc, changeDoc, null);
		return () => clearActiveProjectDoc(projectId);
	}, [projectId, doc]);

	useEffect(() => {
		return () => {
			rejectProposal(proposalId);
			proposalsStore.setState(() => ({ byId: {} }));
		};
	}, [proposalId]);

	return (
		<div className="w-[480px] max-w-full p-3">
			<ProposalCard proposalId={proposalId} />
		</div>
	);
}

const meta = {
	title: "AI/ProposalCard",
	component: Stage,
	parameters: { layout: "padded" },
} satisfies Meta<typeof Stage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: { projectId: "story-proposal-default" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const card = await canvas.findByTestId(/^proposal-card-/);
		await expect(card).toBeInTheDocument();
		await expect(card).toHaveAttribute("data-state", "open");
		// One added task + three changed estimates.
		await expect(
			canvas.getByText(/Token rotation strategy/),
		).toBeInTheDocument();
	},
};

export const ApplyOneFieldThenAll: Story = {
	args: { projectId: "story-proposal-apply" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId(/^proposal-card-/);
		// Apply the estimate-change on task A only.
		const estimateActions = await canvas.findAllByTestId(
			"diff-action-field-estimate",
		);
		await userEvent.click(estimateActions[0]);
		// The proposal should still be open (other tasks remain).
		await waitFor(() => {
			const card = canvas.getByTestId(/^proposal-card-/);
			expect(card).toHaveAttribute("data-state", "open");
		});
		// Apply all → card collapses into the "closed" stub.
		const applyAll = await canvas.findByTestId(/^proposal-apply-all-/);
		await userEvent.click(applyAll);
		await waitFor(() => {
			const card = canvas.getByTestId(/^proposal-card-/);
			expect(card).toHaveAttribute("data-state", "closed");
		});
	},
};

export const Reject: Story = {
	args: { projectId: "story-proposal-reject" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId(/^proposal-card-/);
		const reject = await canvas.findByTestId(/^proposal-reject-/);
		await userEvent.click(reject);
		await waitFor(() => {
			const card = canvas.getByTestId(/^proposal-card-/);
			expect(card).toHaveAttribute("data-state", "closed");
		});
	},
};

// Every operation failed to stage (the placeholder-id pattern weaker models
// produce). The card must show WHAT was attempted and WHY each operation was
// rejected — before this, it rendered as "+0 ~0 −0 / Nothing left to apply"
// with no clue about what went wrong.
export const AllOperationsFailed: Story = {
	args: {
		projectId: "story-proposal-failed-ops",
		operations: placeholderOps,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId(/^proposal-card-/);
		// The failure banner is shown…
		await expect(canvas.getByText(/could not be staged/)).toBeInTheDocument();
		// …and the operations list is auto-expanded with per-op errors.
		const opsSection = canvas.getByTestId(/^proposal-operations-/);
		await expect(opsSection).toHaveAttribute("data-state", "open");
		const rows = canvas.getAllByTestId("proposal-operation-row");
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			await expect(row).toHaveAttribute("data-failed", "true");
		}
		// The specific errors are visible.
		await expect(
			canvas.getByText("task __PROJECT__ not found"),
		).toBeInTheDocument();
		await expect(canvas.getByText("task bogus not found")).toBeInTheDocument();
	},
};

// Successful proposals keep the operations list collapsed (the diff is the
// star), but it can be expanded for a peek at the raw operations.
export const OperationsListCollapsedWhenHealthy: Story = {
	args: { projectId: "story-proposal-ops-collapsed" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId(/^proposal-card-/);
		const opsSection = canvas.getByTestId(/^proposal-operations-/);
		await expect(opsSection).toHaveAttribute("data-state", "closed");
		// Expand it.
		await userEvent.click(within(opsSection).getByRole("button"));
		await expect(opsSection).toHaveAttribute("data-state", "open");
		const rows = canvas.getAllByTestId("proposal-operation-row");
		expect(rows).toHaveLength(4);
		for (const row of rows) {
			await expect(row).toHaveAttribute("data-failed", "false");
		}
	},
};

// A client-provided id that collides with an existing task gets remapped to a
// fresh id at staging time. The operations list shows the id the entity was
// ACTUALLY created under (→ task_xxx) so the raw operation can be correlated
// with the diff and the live document.
export const RemappedIdShownInOperations: Story = {
	// The remapped id is freshly generated (crypto-random) on every render, so
	// the "→ task_xxx" text differs each build — opt out of the screenshot diff
	// so it doesn't flag on every PR. The play function still asserts the
	// remap behaviour functionally.
	tags: ["no-screenshot-diff"],
	args: {
		projectId: "story-proposal-remapped-id",
		operations: [
			// "A" already exists in seedDoc → applyOperations remaps this add to a
			// fresh id instead of overwriting the existing task.
			{
				op: "add_task",
				id: "A",
				title: "Imported task with colliding id",
				estimate: { optimistic: 1, mostLikely: 2, pessimistic: 4, unit: "day" },
			},
		],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId(/^proposal-card-/);
		// Expand the operations list (it's collapsed — nothing failed).
		const opsSection = canvas.getByTestId(/^proposal-operations-/);
		await userEvent.click(within(opsSection).getByRole("button"));
		// The created-id indicator shows the remapped id, which differs from "A".
		const createdId = await canvas.findByTestId(
			"proposal-operation-created-id",
		);
		const text = createdId.textContent ?? "";
		expect(text).toContain("→");
		expect(text).not.toContain("→ A");
	},
};

// A proposal staged for a different project than the one currently active:
// the card renders but apply is blocked, so one chat's import can never land
// inside another project.
export const WrongProject: Story = {
	args: {
		projectId: "story-proposal-active-project",
		proposalProjectId: "story-proposal-other-project",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId(/^proposal-card-/);
		// The warning banner is visible…
		await expect(
			canvas.getByTestId(/^proposal-wrong-project-/),
		).toBeInTheDocument();
		// …and Apply all is disabled.
		const applyAll = await canvas.findByTestId(/^proposal-apply-all-/);
		await expect(applyAll).toBeDisabled();
		// Clicking a row action is a no-op: the card stays open and the diff
		// keeps every row.
		const estimateActions = canvas.queryAllByTestId(
			"diff-action-field-estimate",
		);
		if (estimateActions.length > 0) {
			await userEvent.click(estimateActions[0]);
		}
		const card = canvas.getByTestId(/^proposal-card-/);
		await expect(card).toHaveAttribute("data-state", "open");
	},
};

// A proposal that deletes a task must not apply on a single click. "Apply all"
// opens a confirm dialog naming the deletion; only the dialog's confirm button
// actually mutates the doc.
export const ApplyAllWithDeletionConfirms: Story = {
	args: { projectId: "story-proposal-delete-confirm", operations: deleteOps },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId(/^proposal-card-/);
		// The button is labelled with the change count.
		const applyAll = await canvas.findByTestId(/^proposal-apply-all-/);
		await expect(applyAll).toHaveTextContent(/Apply all \(\d+\)/);
		await userEvent.click(applyAll);
		// The confirm dialog (a Radix portal) appears and mentions the deletion.
		const dialog = await within(document.body).findByRole("dialog");
		const inDialog = within(dialog);
		await expect(inDialog.getByText("Apply all changes?")).toBeInTheDocument();
		await expect(inDialog.getByText(/deletion/)).toBeInTheDocument();
		// Confirm → the proposal applies and the card collapses to the stub.
		await userEvent.click(inDialog.getByTestId(/^proposal-apply-all-confirm-/));
		await waitFor(() => {
			const card = canvas.getByTestId(/^proposal-card-/);
			expect(card).toHaveAttribute("data-state", "closed");
		});
	},
};
