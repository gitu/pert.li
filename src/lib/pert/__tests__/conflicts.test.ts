import * as Automerge from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import {
	averageEstimatesMutation,
	resolveTaskFieldMutation,
} from "#/lib/pert/conflicts";
import { readTaskConflicts } from "#/lib/pert/read-conflicts";
import {
	createEmptyPertDoc,
	type Estimate,
	type PertDoc,
} from "#/lib/pert/types";

const est = (o: number, m: number, p: number): Estimate => ({
	optimistic: o,
	mostLikely: m,
	pessimistic: p,
	unit: "day",
});

function withTask(actor: string): Automerge.Doc<PertDoc> {
	const seed = Automerge.from<PertDoc>(createEmptyPertDoc("c"), { actor });
	return Automerge.change(seed, (d) => {
		d.tasksById.T = {
			id: "T",
			kind: "task",
			title: "Task",
			parentId: null,
			estimate: est(1, 2, 4),
		};
	});
}

describe("readTaskConflicts", () => {
	it("returns null when there are no concurrent writes", () => {
		const doc = withTask("aaaa");
		expect(readTaskConflicts(doc, "T")).toBeNull();
	});

	it("returns null for a missing task", () => {
		const doc = withTask("aaaa");
		expect(readTaskConflicts(doc, "missing")).toBeNull();
	});

	it("surfaces estimate divergence from two actors", () => {
		// Two replicas branching off the seed, each writing the estimate.
		const seed = Automerge.from<PertDoc>(createEmptyPertDoc("c"), {
			actor: "aaaaaaaa",
		});
		const baseline = Automerge.change(seed, (d) => {
			d.tasksById.T = {
				id: "T",
				kind: "task",
				title: "Task",
				parentId: null,
				estimate: est(1, 2, 4),
			};
		});
		const cloneA = Automerge.clone(baseline, { actor: "aaaaaaaa" });
		const cloneB = Automerge.clone(baseline, { actor: "bbbbbbbb" });
		const a = Automerge.change(cloneA, (d) => {
			d.tasksById.T.estimate = est(2, 3, 5);
		});
		const b = Automerge.change(cloneB, (d) => {
			d.tasksById.T.estimate = est(4, 6, 10);
		});
		const merged = Automerge.merge(a, b);
		const conflicts = readTaskConflicts(merged, "T");
		expect(conflicts).not.toBeNull();
		const estField = conflicts?.fields.find((f) => f.field === "estimate");
		expect(estField).toBeDefined();
		expect(estField?.values).toHaveLength(2);
	});

	it("surfaces title divergence with stable winner from merge", () => {
		const seed = Automerge.from<PertDoc>(createEmptyPertDoc("c"), {
			actor: "aaaaaaaa",
		});
		const baseline = Automerge.change(seed, (d) => {
			d.tasksById.T = {
				id: "T",
				kind: "task",
				title: "Original",
				parentId: null,
			};
		});
		const a = Automerge.change(
			Automerge.clone(baseline, { actor: "aaaaaaaa" }),
			(d) => {
				d.tasksById.T.title = "Mine";
			},
		);
		const b = Automerge.change(
			Automerge.clone(baseline, { actor: "bbbbbbbb" }),
			(d) => {
				d.tasksById.T.title = "Theirs";
			},
		);
		const merged = Automerge.merge(a, b);
		const conflicts = readTaskConflicts(merged, "T");
		const titleField = conflicts?.fields.find((f) => f.field === "title");
		expect(titleField?.values.map((v) => v.value).sort()).toEqual([
			"Mine",
			"Theirs",
		]);
	});
});

describe("resolveTaskFieldMutation", () => {
	it("writes the chosen estimate back", () => {
		const doc = withTask("aaaa");
		const mut = resolveTaskFieldMutation("T", "estimate", est(5, 7, 11));
		const updated = Automerge.change(doc, mut);
		expect(updated.tasksById.T.estimate).toEqual(est(5, 7, 11));
	});

	it("clears notes when chosen value is null", () => {
		const doc = Automerge.change(withTask("aaaa"), (d) => {
			d.tasksById.T.notes = "scratch";
		});
		const updated = Automerge.change(
			doc,
			resolveTaskFieldMutation("T", "notes", null),
		);
		expect(updated.tasksById.T.notes).toBeUndefined();
	});
});

describe("averageEstimatesMutation", () => {
	it("averages each estimate component and rounds to 2dp", () => {
		const doc = withTask("aaaa");
		const mut = averageEstimatesMutation("T", [est(2, 4, 8), est(3, 5, 10)]);
		expect(mut).not.toBeNull();
		const updated = Automerge.change(doc, mut as (d: PertDoc) => void);
		expect(updated.tasksById.T.estimate).toEqual(est(2.5, 4.5, 9));
	});

	it("returns null when no real estimates are present", () => {
		expect(averageEstimatesMutation("T", [undefined, undefined])).toBeNull();
	});
});
