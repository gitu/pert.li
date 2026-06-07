import { describe, expect, it } from "vitest";
import { type ProjectedNode, projectGraph, rollupGroup } from "../projection";
import { computeSchedule } from "../schedule";
import type { Dependency, Estimate, Group, PertDoc, Task } from "../types";
import { createEmptyPertDoc } from "../types";

const est = (o: number, m: number, p: number): Estimate => ({
	optimistic: o,
	mostLikely: m,
	pessimistic: p,
	unit: "day",
});

function task(id: string, overrides: Partial<Task> = {}): Task {
	return {
		id,
		kind: "task",
		title: id,
		estimate: est(1, 1, 1),
		...overrides,
	};
}

function group(id: string, parentGroupId: string | null = null): Group {
	return { id, name: id, parentGroupId, order: 0 };
}

function fts(id: string, from: string, to: string): Dependency {
	return {
		id,
		from: { taskId: from },
		to: { taskId: to },
		type: "finish_to_start",
	};
}

function build(
	tasks: Task[],
	deps: Dependency[],
	groups: Group[] = [],
): PertDoc {
	const doc = createEmptyPertDoc("proj");
	for (const g of groups) doc.groupsById[g.id] = g;
	for (const t of tasks) doc.tasksById[t.id] = t;
	for (const d of deps) doc.dependenciesById[d.id] = d;
	return doc;
}

function leafIds(nodes: ProjectedNode[]): string[] {
	return nodes
		.filter(
			(n): n is Extract<ProjectedNode, { kind: "leaf" }> => n.kind === "leaf",
		)
		.map((n) => n.task.id)
		.sort();
}

function groupNode(nodes: ProjectedNode[], id: string) {
	return nodes.find(
		(n) =>
			(n.kind === "group-expanded" || n.kind === "group-collapsed") &&
			n.group.id === id,
	);
}

describe("projectGraph — collapse semantics", () => {
	it("hides members of a collapsed group and renders it as group-collapsed", () => {
		const doc = build(
			[
				task("a", { groupId: "box" }),
				task("b", { groupId: "box" }),
				task("outside"),
			],
			[],
			[group("box")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box"]));
		expect(leafIds(projection.nodes)).toEqual(["outside"]);
		expect(groupNode(projection.nodes, "box")?.kind).toBe("group-collapsed");
	});

	it("expanded groups render their member tasks alongside the group box", () => {
		const doc = build(
			[task("a", { groupId: "box" }), task("outside")],
			[],
			[group("box")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set());
		expect(leafIds(projection.nodes)).toEqual(["a", "outside"]);
		expect(groupNode(projection.nodes, "box")?.kind).toBe("group-expanded");
	});

	it("reroutes edges crossing into a collapsed group to the group itself", () => {
		const doc = build(
			[task("inner", { groupId: "box" }), task("outside")],
			[fts("e", "outside", "inner")],
			[group("box")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box"]));
		expect(projection.edges).toHaveLength(1);
		const edge = projection.edges[0];
		expect(edge.source).toBe("outside");
		expect(edge.target).toBe("box");
		expect(edge.rerouted).toBe(true);
	});

	it("reroutes both ends when an edge crosses two collapsed groups", () => {
		const doc = build(
			[task("a", { groupId: "box1" }), task("b", { groupId: "box2" })],
			[fts("e", "a", "b")],
			[group("box1"), group("box2")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box1", "box2"]));
		const edge = projection.edges[0];
		expect(edge.source).toBe("box1");
		expect(edge.target).toBe("box2");
		expect(edge.rerouted).toBe(true);
	});

	it("hides edges that are fully inside a collapsed group", () => {
		const doc = build(
			[task("a", { groupId: "box" }), task("b", { groupId: "box" })],
			[fts("ab", "a", "b")],
			[group("box")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box"]));
		expect(projection.edges).toEqual([]);
	});

	it("marks an unrerouted edge as critical when both ends are critical", () => {
		const doc = build([task("A"), task("B")], [fts("ab", "A", "B")]);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set());
		expect(projection.edges).toHaveLength(1);
		expect(projection.edges[0].critical).toBe(true);
	});

	it("folds a nested group's box into a collapsed ancestor", () => {
		const doc = build(
			[task("a", { groupId: "inner" })],
			[],
			[group("outer"), group("inner", "outer")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["outer"]));
		// Only the collapsed outer box is emitted; inner is folded inside it.
		expect(groupNode(projection.nodes, "outer")?.kind).toBe("group-collapsed");
		expect(groupNode(projection.nodes, "inner")).toBeUndefined();
		expect(leafIds(projection.nodes)).toEqual([]);
	});
});

describe("rollupGroup", () => {
	it("sums expected duration and tracks min slack across members (deep)", () => {
		const doc = build(
			[
				task("a", { groupId: "box", estimate: est(1, 2, 3) }),
				task("b", { groupId: "box", estimate: est(2, 4, 6) }),
				task("c"),
			],
			[fts("ac", "a", "c")],
			[group("box")],
		);
		const r = computeSchedule(doc);
		if (!r.ok) throw new Error("expected ok");
		const rollup = rollupGroup(doc, r.schedule, "box");
		expect(rollup.descendantCount).toBe(2);
		expect(rollup.scheduledCount).toBe(2);
		// a expected = (1 + 8 + 3)/6 = 2; b = (2 + 16 + 6)/6 = 4
		expect(rollup.expected).toBeCloseTo(6);
		expect(rollup.minSlack).not.toBeNull();
		expect(rollup.minSlack).toBeLessThanOrEqual(0);
		expect(rollup.criticalCount).toBeGreaterThanOrEqual(1);
	});

	it("counts members of descendant groups too", () => {
		const doc = build(
			[
				task("a", { groupId: "outer", estimate: est(1, 1, 1) }),
				task("b", { groupId: "inner", estimate: est(1, 1, 1) }),
			],
			[],
			[group("outer"), group("inner", "outer")],
		);
		const r = computeSchedule(doc);
		if (!r.ok) throw new Error("expected ok");
		const rollup = rollupGroup(doc, r.schedule, "outer");
		expect(rollup.descendantCount).toBe(2);
	});

	it("returns zeroes and minSlack=null when the group has no member tasks", () => {
		const doc = build([], [], [group("empty")]);
		const r = computeSchedule(doc);
		if (!r.ok) throw new Error("expected ok");
		const rollup = rollupGroup(doc, r.schedule, "empty");
		expect(rollup).toMatchObject({
			descendantCount: 0,
			scheduledCount: 0,
			expected: 0,
			minSlack: null,
			criticalCount: 0,
			hasCritical: false,
		});
	});

	it("rollup recomputes after a member estimate changes", () => {
		const doc = build(
			[task("inner", { groupId: "box", estimate: est(1, 1, 1) })],
			[],
			[group("box")],
		);
		const r1 = computeSchedule(doc);
		if (!r1.ok) throw new Error("expected ok");
		const before = rollupGroup(doc, r1.schedule, "box");
		expect(before.expected).toBeCloseTo(1);

		const inner = doc.tasksById.inner;
		if (!inner.estimate) throw new Error("expected estimate");
		inner.estimate.mostLikely = 10;
		const r2 = computeSchedule(doc);
		if (!r2.ok) throw new Error("expected ok");
		const after = rollupGroup(doc, r2.schedule, "box");
		// expected = (1 + 40 + 1)/6 = 42/6 = 7
		expect(after.expected).toBeCloseTo(7);
	});
});

describe("projectGraph — grouping depth cap", () => {
	it("emits no box for groups beyond the cap; their tasks render as leaves", () => {
		const doc = build(
			[
				task("a", { groupId: "L1" }),
				task("b", { groupId: "L2" }),
				task("c", { groupId: "L3" }),
			],
			[],
			[group("L1"), group("L2", "L1"), group("L3", "L2")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(), 2);
		// L1 + L2 draw boxes; L3 does not.
		expect(groupNode(projection.nodes, "L1")?.kind).toBe("group-expanded");
		expect(groupNode(projection.nodes, "L2")?.kind).toBe("group-expanded");
		expect(groupNode(projection.nodes, "L3")).toBeUndefined();
		// Every task still renders as a leaf (c folds visually into L2's box).
		expect(leafIds(projection.nodes)).toEqual(["a", "b", "c"]);
	});

	it("cap 0 (grouping off) emits no boxes at all; all tasks are leaves", () => {
		const doc = build(
			[task("a", { groupId: "L1" }), task("b", { groupId: "L2" })],
			[],
			[group("L1"), group("L2", "L1")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(), 0);
		expect(groupNode(projection.nodes, "L1")).toBeUndefined();
		expect(groupNode(projection.nodes, "L2")).toBeUndefined();
		expect(leafIds(projection.nodes)).toEqual(["a", "b"]);
	});

	it("default (no cap) renders every nesting level as a box", () => {
		const doc = build(
			[task("c", { groupId: "L3" })],
			[],
			[group("L1"), group("L2", "L1"), group("L3", "L2")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set());
		expect(groupNode(projection.nodes, "L1")?.kind).toBe("group-expanded");
		expect(groupNode(projection.nodes, "L2")?.kind).toBe("group-expanded");
		expect(groupNode(projection.nodes, "L3")?.kind).toBe("group-expanded");
	});

	it("ignores collapse for a group folded away by the cap (no vanished tasks)", () => {
		// Collapse L3 (valid when grouping=All), then view with cap=2 so L3 is
		// folded. L3's task must still render as a leaf (folded loose into L2),
		// never silently disappear.
		const doc = build(
			[task("c", { groupId: "L3" }), task("b", { groupId: "L2" })],
			[],
			[group("L1"), group("L2", "L1"), group("L3", "L2")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["L3"]), 2);
		expect(leafIds(projection.nodes)).toEqual(["b", "c"]);
		expect(groupNode(projection.nodes, "L3")).toBeUndefined();
	});

	it("ignores all collapse when grouping is off (cap 0)", () => {
		const doc = build([task("a", { groupId: "box" })], [], [group("box")]);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box"]), 0);
		// No box, and the member is still a visible leaf.
		expect(groupNode(projection.nodes, "box")).toBeUndefined();
		expect(leafIds(projection.nodes)).toEqual(["a"]);
	});
});
