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
	stageProposal,
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

	it("createProposal surfaces per-operation failures so the model can self-correct", () => {
		const live = seed();
		const { summary } = createProposal(live, "test", [
			// The placeholder-id pattern weaker models produce: ops referencing
			// task ids that don't exist anywhere.
			{ op: "set_title", taskId: "__PROJECT__", title: "Renamed" },
			{ op: "remove_task", taskId: "bogus" },
			// And one valid op so we verify failures only lists the broken ones.
			{ op: "set_title", taskId: "A", title: "Alpha v2" },
		]);
		expect(summary.operationsApplied).toBe(1);
		expect(summary.operationsFailed).toBe(2);
		expect(summary.failures).toEqual([
			{
				operationIndex: 0,
				op: "set_title",
				error: "task __PROJECT__ not found",
			},
			{ operationIndex: 1, op: "remove_task", error: "task bogus not found" },
		]);
	});

	it("createProposal reports no failures for a fully-valid batch", () => {
		const live = seed();
		const { summary } = createProposal(live, "test", [
			{ op: "set_title", taskId: "A", title: "Alpha v2" },
		]);
		expect(summary.failures).toEqual([]);
	});

	it("stageProposal refuses when no operation could be staged and leaves no proposal behind", () => {
		const live = seed();
		const result = stageProposal(live, "probe", [
			{ op: "set_title", taskId: "nonexistent", title: "probe" },
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			// The error names the failed op AND tells the model what to do instead.
			expect(result.error).toContain("set_title: task nonexistent not found");
			expect(result.error).toContain("Do NOT send probe or placeholder");
			expect(result.error).toContain("add_task");
		}
		// No empty proposal card lingers in the store.
		expect(Object.keys(proposalsStore.state.byId)).toHaveLength(0);
	});

	it("stageProposal succeeds when at least one operation staged, reporting the failures", () => {
		const live = seed();
		const result = stageProposal(live, "partial", [
			{ op: "set_title", taskId: "A", title: "Alpha v2" },
			{ op: "remove_task", taskId: "bogus" },
		]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.summary.operationsApplied).toBe(1);
			expect(result.summary.operationsFailed).toBe(1);
			expect(result.summary.failures).toHaveLength(1);
			// The proposal exists and is reviewable.
			expect(getProposal(result.proposal.id)).not.toBeNull();
		}
	});

	it("createProposal records the project it was staged for", () => {
		const live = seed();
		const { proposal } = createProposal(
			live,
			"test",
			[{ op: "set_title", taskId: "A", title: "Alpha v2" }],
			"project-123",
		);
		expect(proposal.projectId).toBe("project-123");
	});

	it("createProposal defaults projectId to null for callers that don't know it", () => {
		const live = seed();
		const { proposal } = createProposal(live, "test", [
			{ op: "set_title", taskId: "A", title: "Alpha v2" },
		]);
		expect(proposal.projectId).toBeNull();
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

	it("applyProposalRow copies the interface bucket when an added task is a container", () => {
		const live = seed();
		const ops: EditOp[] = [
			{ op: "add_task", id: "C", title: "Container", kind: "container" },
		];
		const { proposal } = createProposal(live, "test", ops);
		// applyOperations seeded default Entry/Exit interfaces on the proposed
		// doc — sanity-check that.
		expect(
			Object.keys(proposal.proposedDoc.interfacesByContainerId.C ?? {}),
		).not.toHaveLength(0);

		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposalRow(
			proposal.id,
			{ type: "task-added", taskId: "C" },
			changeDoc,
		);
		expect(live.tasksById.C?.kind).toBe("container");
		expect(Object.keys(live.interfacesByContainerId.C ?? {})).not.toHaveLength(
			0,
		);
	});

	it("applyProposalRow drops the interface bucket when removing a container", () => {
		const live = seed();
		// Promote A to a container with interfaces, then propose removing it.
		live.tasksById.A.kind = "container";
		live.interfacesByContainerId.A = {
			if_default: {
				id: "if_default",
				containerId: "A",
				kind: "entry",
				label: "input",
			},
		};
		const ops: EditOp[] = [{ op: "remove_task", taskId: "A" }];
		const { proposal } = createProposal(live, "test", ops);
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposalRow(
			proposal.id,
			{ type: "task-removed", taskId: "A" },
			changeDoc,
		);
		expect(live.tasksById.A).toBeUndefined();
		expect(live.interfacesByContainerId.A).toBeUndefined();
	});

	it("applyProposalRow refuses to apply a dependency row whose endpoints aren't present yet", () => {
		const live = seed();
		const ops: EditOp[] = [
			{ op: "add_task", id: "C", title: "Ship" },
			{ op: "add_dependency", fromTaskId: "C", toTaskId: "A", id: "ca" },
		];
		const { proposal } = createProposal(live, "test", ops);
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		// Apply the dep row first — its `from` references task C, which the
		// user hasn't applied yet. Should silently no-op so the live doc
		// never gains a dep referencing a missing task.
		applyProposalRow(
			proposal.id,
			{ type: "dependency", depId: "ca" },
			changeDoc,
		);
		expect(live.dependenciesById.ca).toBeUndefined();
		// Apply the task-added prerequisite, then the dep row again — now
		// the dep should land.
		applyProposalRow(
			proposal.id,
			{ type: "task-added", taskId: "C" },
			changeDoc,
		);
		applyProposalRow(
			proposal.id,
			{ type: "dependency", depId: "ca" },
			changeDoc,
		);
		expect(live.dependenciesById.ca?.from.taskId).toBe("C");
	});

	it("applyProposalRow pulls in missing ancestor containers when applying a nested added task", () => {
		const live = seed();
		const ops: EditOp[] = [
			{ op: "add_task", id: "phase", title: "Phase 1", kind: "container" },
			{ op: "add_task", id: "child", title: "Wireframes", parentId: "phase" },
		];
		const { proposal } = createProposal(live, "test", ops);
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		// Apply ONLY the child row — before the fix this landed the child with
		// a dangling parentId, making it invisible on the nested canvas.
		applyProposalRow(
			proposal.id,
			{ type: "task-added", taskId: "child" },
			changeDoc,
		);
		expect(live.tasksById.child).toBeDefined();
		expect(live.tasksById.child.parentId).toBe("phase");
		// The ancestor container came along, including its interface bucket.
		expect(live.tasksById.phase?.kind).toBe("container");
		expect(
			Object.keys(live.interfacesByContainerId.phase ?? {}),
		).not.toHaveLength(0);
		// The diff refresh consumed both rows → proposal evicted.
		expect(getProposal(proposal.id)).toBeNull();
	});

	it("applyProposalRow pulls in a multi-level ancestor chain", () => {
		const live = seed();
		const ops: EditOp[] = [
			{ op: "add_task", id: "outer", title: "Outer", kind: "container" },
			{
				op: "add_task",
				id: "inner",
				title: "Inner",
				kind: "container",
				parentId: "outer",
			},
			{ op: "add_task", id: "leaf", title: "Leaf", parentId: "inner" },
		];
		const { proposal } = createProposal(live, "test", ops);
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposalRow(
			proposal.id,
			{ type: "task-added", taskId: "leaf" },
			changeDoc,
		);
		expect(live.tasksById.leaf?.parentId).toBe("inner");
		expect(live.tasksById.inner?.parentId).toBe("outer");
		expect(live.tasksById.outer?.parentId).toBeNull();
	});

	it("applyProposalRow refuses a dependency whose endpoint has become a container since the proposal was staged", () => {
		const live = seed();
		// Stage a normal dep against a live doc where both endpoints are
		// leaf tasks — proposal validates and stores it.
		const ops: EditOp[] = [
			{ op: "add_dependency", fromTaskId: "A", toTaskId: "B", id: "ab" },
		];
		const { proposal } = createProposal(live, "test", ops);
		expect(proposal.proposedDoc.dependenciesById.ab).toBeDefined();
		// But between staging and apply, someone promoted A to a container.
		// The apply-row guard refuses the dep because container endpoints
		// aren't valid in this model — matching addDependencyMutation.
		live.tasksById.A.kind = "container";
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposalRow(
			proposal.id,
			{ type: "dependency", depId: "ab" },
			changeDoc,
		);
		expect(live.dependenciesById.ab).toBeUndefined();
	});
});
