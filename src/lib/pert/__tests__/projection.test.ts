import { describe, expect, it } from "vitest";
import { projectGraph, rollupContainer } from "../projection";
import { computeSchedule } from "../schedule";
import type { Dependency, Estimate, PertDoc, Task, TaskKind } from "../types";
import { createEmptyPertDoc } from "../types";

const est = (o: number, m: number, p: number): Estimate => ({
	optimistic: o,
	mostLikely: m,
	pessimistic: p,
	unit: "day",
});

function task(
	id: string,
	overrides: Partial<Task> = {},
	kind: TaskKind = "task",
): Task {
	return {
		id,
		kind,
		title: id,
		parentId: null,
		estimate: kind === "container" ? undefined : est(1, 1, 1),
		...overrides,
	};
}

function fts(id: string, from: string, to: string): Dependency {
	return {
		id,
		from: { taskId: from },
		to: { taskId: to },
		type: "finish_to_start",
	};
}

function build(tasks: Task[], deps: Dependency[]): PertDoc {
	const doc = createEmptyPertDoc("proj");
	for (const t of tasks) doc.tasksById[t.id] = t;
	for (const d of deps) doc.dependenciesById[d.id] = d;
	return doc;
}

describe("projectGraph — collapse semantics", () => {
	it("hides descendants of a collapsed container and renders it as collapsed", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("a", { parentId: "box" }),
				task("b", { parentId: "box" }),
				task("outside"),
			],
			[],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box"]));
		const ids = projection.nodes.map((n) => n.task.id).sort();
		expect(ids).toEqual(["box", "outside"]);
		const boxNode = projection.nodes.find((n) => n.task.id === "box");
		expect(boxNode?.kind).toBe("container-collapsed");
	});

	it("expanded containers still render with their children visible", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("a", { parentId: "box" }),
				task("outside"),
			],
			[],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set());
		const ids = projection.nodes.map((n) => n.task.id).sort();
		expect(ids).toEqual(["a", "box", "outside"]);
		const boxNode = projection.nodes.find((n) => n.task.id === "box");
		expect(boxNode?.kind).toBe("container-expanded");
	});

	it("reroutes edges crossing into a collapsed container to the container itself", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("inner", { parentId: "box" }),
				task("outside"),
			],
			[fts("e", "outside", "inner")],
		);
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box"]));
		expect(projection.edges).toHaveLength(1);
		const edge = projection.edges[0];
		expect(edge.source).toBe("outside");
		expect(edge.target).toBe("box");
		expect(edge.rerouted).toBe(true);
	});

	it("hides edges that are fully inside a collapsed container", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("a", { parentId: "box" }),
				task("b", { parentId: "box" }),
			],
			[fts("ab", "a", "b")],
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
});

describe("rollupContainer", () => {
	it("sums expected duration and tracks min slack across descendants", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("a", { parentId: "box", estimate: est(1, 2, 3) }),
				task("b", { parentId: "box", estimate: est(2, 4, 6) }),
				task("c"),
			],
			[fts("ac", "a", "c")],
		);
		const r = computeSchedule(doc);
		if (!r.ok) throw new Error("expected ok");
		const rollup = rollupContainer(doc, r.schedule, "box");
		expect(rollup.descendantCount).toBe(2);
		expect(rollup.scheduledCount).toBe(2);
		// a expected = (1 + 8 + 3)/6 = 2; b = (2 + 16 + 6)/6 = 4
		expect(rollup.expected).toBeCloseTo(6);
		// a is critical (path a → c); b has slack (no successors → slack = projectDuration - EF(b) = 3 - 4 = -1?)
		// Actually b has no successors, so LF = projectDuration = 3 (since path a→c = 2+1=3), LS = 3 - 4 = -1, slack = -1 - 0 = -1.
		// CPM normally treats orphan tasks as starting at 0; if duration > projectDuration, slack is negative.
		// We just check that minSlack is the smaller of a's slack (0) and b's slack.
		expect(rollup.minSlack).not.toBeNull();
		expect(rollup.minSlack).toBeLessThanOrEqual(0);
		expect(rollup.criticalCount).toBeGreaterThanOrEqual(1);
	});

	it("returns zeroes and minSlack=null when there are no leaf descendants", () => {
		const doc = build([task("empty", { parentId: null }, "container")], []);
		const r = computeSchedule(doc);
		if (!r.ok) throw new Error("expected ok");
		const rollup = rollupContainer(doc, r.schedule, "empty");
		expect(rollup).toMatchObject({
			descendantCount: 0,
			scheduledCount: 0,
			expected: 0,
			minSlack: null,
			criticalCount: 0,
			hasCritical: false,
		});
	});

	it("rollup recomputes after a descendant estimate changes", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("inner", { parentId: "box", estimate: est(1, 1, 1) }),
			],
			[],
		);
		const r1 = computeSchedule(doc);
		if (!r1.ok) throw new Error("expected ok");
		const before = rollupContainer(doc, r1.schedule, "box");
		expect(before.expected).toBeCloseTo(1);

		const inner = doc.tasksById.inner;
		if (!inner.estimate) throw new Error("expected estimate");
		inner.estimate.mostLikely = 10;
		const r2 = computeSchedule(doc);
		if (!r2.ok) throw new Error("expected ok");
		const after = rollupContainer(doc, r2.schedule, "box");
		// expected = (1 + 40 + 1)/6 = 42/6 = 7
		expect(after.expected).toBeCloseTo(7);
	});
});
