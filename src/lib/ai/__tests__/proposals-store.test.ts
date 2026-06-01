import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import type { EditOp } from "../operations";
import {
	applyProposal,
	applyProposalRow,
	createProposal,
	getProposal,
	proposalsStore,
	rejectProposal,
} from "../proposals-store";

function seed(): PertDoc {
	const d = createEmptyPertDoc("proposals test");
	d.tasksById.A = {
		id: "A",
		kind: "task",
		title: "A",
		parentId: null,
		estimate: { optimistic: 1, mostLikely: 2, pessimistic: 3, unit: "day" },
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "B",
		parentId: null,
		estimate: { optimistic: 2, mostLikely: 4, pessimistic: 6, unit: "day" },
	};
	return d;
}

beforeEach(() => {
	proposalsStore.setState(() => ({ byId: {} }));
});

describe("proposals store", () => {
	it("createProposal builds a proposed doc + diff without mutating the live doc", () => {
		const live = seed();
		const ops: EditOp[] = [
			{ op: "set_title", taskId: "A", title: "Alpha v2" },
			{
				op: "set_estimate",
				taskId: "B",
				optimistic: 5,
				mostLikely: 7,
				pessimistic: 9,
			},
		];
		const { proposal, summary } = createProposal(live, "test", ops);
		expect(live.tasksById.A.title).toBe("A");
		expect(proposal.proposedDoc.tasksById.A.title).toBe("Alpha v2");
		expect(summary.tasksAffected).toBe(2);
		expect(summary.operationsApplied).toBe(2);
	});

	it("applyProposal runs all ops against the live doc and evicts the proposal", () => {
		const live = seed();
		const ops: EditOp[] = [{ op: "set_title", taskId: "A", title: "Alpha v2" }];
		const { proposal } = createProposal(live, "test", ops);
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposal(proposal.id, changeDoc);
		expect(live.tasksById.A.title).toBe("Alpha v2");
		expect(getProposal(proposal.id)).toBeNull();
	});

	it("applyProposalRow applies one field, refreshes the diff, and keeps the proposal alive while more rows remain", () => {
		const live = seed();
		const ops: EditOp[] = [
			{ op: "set_title", taskId: "A", title: "Alpha v2" },
			{
				op: "set_estimate",
				taskId: "B",
				optimistic: 5,
				mostLikely: 7,
				pessimistic: 9,
			},
		];
		const { proposal } = createProposal(live, "test", ops);
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposalRow(
			proposal.id,
			{ type: "task-field", taskId: "A", field: "title" },
			changeDoc,
		);
		expect(live.tasksById.A.title).toBe("Alpha v2");
		// B is still pending; proposal stays alive with one task changed.
		const remaining = getProposal(proposal.id);
		expect(remaining).not.toBeNull();
		expect(remaining?.diff.counts.tasksChanged).toBe(1);
		expect(
			remaining?.diff.tasks.find((t) => t.id === "B")?.fields[0]?.field,
		).toBe("estimate");
	});

	it("applyProposalRow evicts the proposal when the last difference is consumed", () => {
		const live = seed();
		const ops: EditOp[] = [{ op: "set_title", taskId: "A", title: "Alpha v2" }];
		const { proposal } = createProposal(live, "test", ops);
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposalRow(
			proposal.id,
			{ type: "task-field", taskId: "A", field: "title" },
			changeDoc,
		);
		expect(getProposal(proposal.id)).toBeNull();
	});

	it("rejectProposal removes the proposal without touching the live doc", () => {
		const live = seed();
		const { proposal } = createProposal(live, "test", [
			{ op: "set_title", taskId: "A", title: "Alpha v2" },
		]);
		rejectProposal(proposal.id);
		expect(live.tasksById.A.title).toBe("A");
		expect(getProposal(proposal.id)).toBeNull();
	});

	it("applyProposalRow can apply an added task from the proposal", () => {
		const live = seed();
		const ops: EditOp[] = [
			{ op: "add_task", id: "C", title: "Ship" },
			{ op: "set_title", taskId: "A", title: "Alpha v2" },
		];
		const { proposal } = createProposal(live, "test", ops);
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposalRow(
			proposal.id,
			{ type: "task-added", taskId: "C" },
			changeDoc,
		);
		expect(live.tasksById.C).toBeDefined();
		expect(live.tasksById.A.title).toBe("A"); // other rows untouched
	});
});
