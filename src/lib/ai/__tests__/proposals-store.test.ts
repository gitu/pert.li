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
		estimate: { optimistic: 1, mostLikely: 2, pessimistic: 3, unit: "day" },
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "B",
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

	it("stages and applies the valid ops while reporting a schema-invalid op as a failure", () => {
		const live = seed();
		// A malformed add_task missing its required `title` — the kind of op that
		// slips through the unvalidated client tool boundary. It must NOT crash the
		// batch; it should surface as a failure while the valid ops still apply.
		const ops = [
			{ op: "add_task", id: "C", title: "Ship" },
			{ op: "add_task", id: "D" },
			{ op: "set_title", taskId: "A", title: "Alpha v2" },
		] as unknown as EditOp[];
		const result = stageProposal(live, "partial", ops);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.summary.operationsApplied).toBe(2);
		expect(result.summary.operationsFailed).toBe(1);
		const failure = result.summary.failures.find((f) => f.op === "add_task");
		expect(failure?.error).toContain("invalid operation");
		// Applying against the live doc lands the valid ops and skips the bad one.
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		const applyResults = applyProposal(result.proposal.id, changeDoc);
		expect(live.tasksById.C).toBeDefined();
		expect(live.tasksById.D).toBeUndefined();
		expect(live.tasksById.A.title).toBe("Alpha v2");
		expect(applyResults.filter((r) => !r.ok)).toHaveLength(1);
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

	it("applyProposalRow copies the group an added task belongs to", () => {
		const live = seed();
		const ops: EditOp[] = [
			{ op: "create_group", id: "G", name: "Backend" },
			{ op: "add_task", id: "C", title: "Leaf", groupId: "G" },
		];
		const { proposal } = createProposal(live, "test", ops);
		// The proposed doc has the group + grouped task.
		expect(proposal.proposedDoc.groupsById.G).toBeDefined();
		expect(proposal.proposedDoc.tasksById.C.groupId).toBe("G");

		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposalRow(
			proposal.id,
			{ type: "task-added", taskId: "C" },
			changeDoc,
		);
		expect(live.tasksById.C?.groupId).toBe("G");
		// The group came along so the task isn't orphaned from a missing group.
		expect(live.groupsById.G?.name).toBe("Backend");
	});

	it("applyProposalRow removes a task and its touching deps", () => {
		const live = seed();
		// A has an outgoing dependency; proposing its removal should cascade.
		live.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A", port: "finish" },
			to: { taskId: "B", port: "start" },
			type: "finish_to_start",
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
		expect(live.dependenciesById.ab).toBeUndefined();
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

	it("applyProposalRow pulls in a missing ancestor group when applying a nested added task", () => {
		const live = seed();
		const ops: EditOp[] = [
			{ op: "create_group", id: "phase", name: "Phase 1" },
			{ op: "add_task", id: "child", title: "Wireframes", groupId: "phase" },
		];
		const { proposal } = createProposal(live, "test", ops);
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		// Apply ONLY the child row — before the fix this landed the child with
		// a dangling groupId, making it render ungrouped.
		applyProposalRow(
			proposal.id,
			{ type: "task-added", taskId: "child" },
			changeDoc,
		);
		expect(live.tasksById.child).toBeDefined();
		expect(live.tasksById.child.groupId).toBe("phase");
		// The group came along.
		expect(live.groupsById.phase?.name).toBe("Phase 1");
		// The diff refresh consumed the remaining rows → proposal evicted.
		expect(getProposal(proposal.id)).toBeNull();
	});

	it("applyProposalRow pulls in a multi-level ancestor group chain", () => {
		const live = seed();
		const ops: EditOp[] = [
			{ op: "create_group", id: "outer", name: "Outer" },
			{
				op: "create_group",
				id: "inner",
				name: "Inner",
				parentGroupId: "outer",
			},
			{ op: "add_task", id: "leaf", title: "Leaf", groupId: "inner" },
		];
		const { proposal } = createProposal(live, "test", ops);
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposalRow(
			proposal.id,
			{ type: "task-added", taskId: "leaf" },
			changeDoc,
		);
		expect(live.tasksById.leaf?.groupId).toBe("inner");
		expect(live.groupsById.inner?.parentGroupId).toBe("outer");
		expect(live.groupsById.outer?.parentGroupId).toBeNull();
	});

	it("applyProposalRow refuses a dependency whose endpoint task has been removed since staging", () => {
		const live = seed();
		// Stage a normal dep against a live doc where both endpoints exist —
		// proposal validates and stores it.
		const ops: EditOp[] = [
			{ op: "add_dependency", fromTaskId: "A", toTaskId: "B", id: "ab" },
		];
		const { proposal } = createProposal(live, "test", ops);
		expect(proposal.proposedDoc.dependenciesById.ab).toBeDefined();
		// But between staging and apply, someone deleted task A. The apply-row
		// guard refuses the dep because its endpoint no longer exists.
		delete live.tasksById.A;
		const changeDoc = (mutate: (d: PertDoc) => void) => mutate(live);
		applyProposalRow(
			proposal.id,
			{ type: "dependency", depId: "ab" },
			changeDoc,
		);
		expect(live.dependenciesById.ab).toBeUndefined();
	});
});
