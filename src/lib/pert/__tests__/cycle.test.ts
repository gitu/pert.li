import { describe, expect, it } from "vitest";
import {
	cycleEdgeSet,
	cycleTaskSet,
	describeEdge,
	dropDependencyMutation,
	findCycleEdges,
	suggestCycleBreakEdge,
} from "#/lib/pert/cycle";
import { computeSchedule } from "#/lib/pert/schedule";
import { createEmptyPertDoc, type PertDoc, type Task } from "#/lib/pert/types";

function leaf(id: string, title = id): Task {
	return {
		id,
		kind: "task",
		title,
		parentId: null,
		estimate: { optimistic: 1, mostLikely: 1, pessimistic: 1, unit: "day" },
	};
}

function build(...tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("cyc");
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

function fs(id: string, from: string, to: string) {
	return {
		id,
		from: { taskId: from },
		to: { taskId: to },
		type: "finish_to_start" as const,
	};
}

describe("findCycleEdges", () => {
	it("returns the dependencies along the cycle path", () => {
		const doc = build(leaf("A"), leaf("B"), leaf("C"));
		doc.dependenciesById.ab = fs("ab", "A", "B");
		doc.dependenciesById.bc = fs("bc", "B", "C");
		doc.dependenciesById.ca = fs("ca", "C", "A");
		const r = computeSchedule(doc);
		if (r.ok) throw new Error("expected cycle");
		const edges = findCycleEdges(doc, r.cycle);
		expect(edges.map((e) => e.dependencyId).sort()).toEqual(["ab", "bc", "ca"]);
	});

	it("ignores non-cycle deps", () => {
		const doc = build(leaf("A"), leaf("B"), leaf("C"), leaf("X"));
		doc.dependenciesById.ab = fs("ab", "A", "B");
		doc.dependenciesById.bc = fs("bc", "B", "C");
		doc.dependenciesById.ca = fs("ca", "C", "A");
		doc.dependenciesById.ax = fs("ax", "A", "X"); // not in cycle
		const r = computeSchedule(doc);
		if (r.ok) throw new Error("expected cycle");
		const edges = findCycleEdges(doc, r.cycle);
		expect(edges.map((e) => e.dependencyId)).not.toContain("ax");
	});

	it("returns [] for an empty cycle", () => {
		const doc = build(leaf("A"));
		expect(findCycleEdges(doc, [])).toEqual([]);
	});
});

describe("suggestCycleBreakEdge", () => {
	it("returns a dep whose removal restores ok", () => {
		const doc = build(leaf("A"), leaf("B"), leaf("C"));
		doc.dependenciesById.ab = fs("ab", "A", "B");
		doc.dependenciesById.bc = fs("bc", "B", "C");
		doc.dependenciesById.ca = fs("ca", "C", "A");
		const r = computeSchedule(doc);
		if (r.ok) throw new Error("expected cycle");
		const suggestion = suggestCycleBreakEdge(doc, r.cycle);
		expect(suggestion).not.toBeNull();
		// Confirm removing it actually fixes the schedule.
		delete doc.dependenciesById[suggestion?.dependencyId ?? ""];
		expect(computeSchedule(doc).ok).toBe(true);
	});

	it("prefers the edge closest to the end of the cycle path", () => {
		// A→B→C→A — the suggestion should be the last edge in the closing
		// pair (C→A) when removing any of the three would fix it.
		const doc = build(leaf("A"), leaf("B"), leaf("C"));
		doc.dependenciesById.ab = fs("ab", "A", "B");
		doc.dependenciesById.bc = fs("bc", "B", "C");
		doc.dependenciesById.ca = fs("ca", "C", "A");
		const r = computeSchedule(doc);
		if (r.ok) throw new Error("expected cycle");
		const suggestion = suggestCycleBreakEdge(doc, r.cycle);
		expect(suggestion?.dependencyId).toBe("ca");
	});

	it("returns null when removing any single cycle-edge still leaves another cycle", () => {
		// Two disjoint cycles in the same graph: A↔B and C↔D. The CPM walker
		// surfaces just one of them (say A↔B). Removing either ab or ba
		// breaks that cycle but leaves C↔D intact, so no single-edge
		// removal restores ok. Suggestion correctly returns null.
		const doc = build(leaf("A"), leaf("B"), leaf("C"), leaf("D"));
		doc.dependenciesById.ab = fs("ab", "A", "B");
		doc.dependenciesById.ba = fs("ba", "B", "A");
		doc.dependenciesById.cd = fs("cd", "C", "D");
		doc.dependenciesById.dc = fs("dc", "D", "C");
		const r = computeSchedule(doc);
		if (r.ok) throw new Error("expected cycle");
		expect(suggestCycleBreakEdge(doc, r.cycle)).toBeNull();
	});
});

describe("cycleTaskSet / cycleEdgeSet / describeEdge / dropDependencyMutation", () => {
	it("cycleTaskSet collapses the closed path", () => {
		expect([...cycleTaskSet(["A", "B", "C", "A"])].sort()).toEqual([
			"A",
			"B",
			"C",
		]);
	});

	it("cycleEdgeSet matches findCycleEdges", () => {
		const doc = build(leaf("A"), leaf("B"));
		doc.dependenciesById.ab = fs("ab", "A", "B");
		doc.dependenciesById.ba = fs("ba", "B", "A");
		const r = computeSchedule(doc);
		if (r.ok) throw new Error("expected cycle");
		const set = cycleEdgeSet(doc, r.cycle);
		expect(set.has("ab")).toBe(true);
		expect(set.has("ba")).toBe(true);
	});

	it("describeEdge prefers titles, falls back to ids", () => {
		const doc = build(leaf("A", "Alpha"), { ...leaf("B"), title: "" });
		doc.dependenciesById.ab = fs("ab", "A", "B");
		expect(describeEdge(doc, { dependencyId: "ab", from: "A", to: "B" })).toBe(
			"Alpha → B",
		);
	});

	it("dropDependencyMutation removes one dep without touching others", () => {
		const doc = build(leaf("A"), leaf("B"));
		doc.dependenciesById.ab = fs("ab", "A", "B");
		doc.dependenciesById.ba = fs("ba", "B", "A");
		dropDependencyMutation("ab")(doc);
		expect(doc.dependenciesById.ab).toBeUndefined();
		expect(doc.dependenciesById.ba).toBeDefined();
	});
});
