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

function Stage({ projectId }: { projectId: string }) {
	const [doc, setDoc] = useState<PertDoc>(() => seedDoc());
	// Seed the proposal eagerly so the diff is computed off the original
	// seedDoc — not a draft the user may have already mutated via apply-row.
	const [proposalId] = useState<string>(() => {
		const { proposal } = createProposal(doc, rationale, reEstimateOps);
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
