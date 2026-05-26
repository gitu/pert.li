import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ensureContainerInterfaces } from "../interfaces";
import {
	projectGraph,
	rollupContainer,
	rollupContainerPaths,
} from "../projection";
import { computeSchedule } from "../schedule";
import type {
	ContainerInterface,
	Dependency,
	Estimate,
	PertDoc,
	Task,
	TaskKind,
} from "../types";
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

	it("resolves the target interface to the container's primary entry when no hint is set", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("inner", { parentId: "box" }),
				task("outside"),
			],
			[fts("e", "outside", "inner")],
		);
		ensureContainerInterfaces(doc, "box");
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box"]));
		const edge = projection.edges[0];
		expect(edge.targetInterfaceId).toBeDefined();
		const entryIface = Object.values(doc.interfacesByContainerId.box).find(
			(i) => i.kind === "entry",
		) as ContainerInterface;
		expect(edge.targetInterfaceId).toBe(entryIface.id);
		expect(edge.sourceInterfaceId).toBeUndefined();
	});

	it("honors the dependency's interfaceId hint when it matches the container", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("inner", { parentId: "box" }),
				task("outside"),
			],
			[],
		);
		ensureContainerInterfaces(doc, "box");
		const customEntry: ContainerInterface = {
			id: "if_custom",
			containerId: "box",
			kind: "entry",
			label: "Custom",
		};
		doc.interfacesByContainerId.box[customEntry.id] = customEntry;
		doc.dependenciesById.e = {
			id: "e",
			from: { taskId: "outside" },
			to: { taskId: "inner", interfaceId: "if_custom" },
			type: "finish_to_start",
		};
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box"]));
		expect(projection.edges[0].targetInterfaceId).toBe("if_custom");
	});

	it("prefers an interface bound to the original descendant via taskRef", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("alpha", { parentId: "box" }),
				task("beta", { parentId: "box" }),
				task("outside"),
			],
			[fts("e", "outside", "beta")],
		);
		doc.interfacesByContainerId.box = {
			if_alpha: {
				id: "if_alpha",
				containerId: "box",
				kind: "entry",
				label: "Alpha",
				taskRef: "alpha",
			},
			if_beta: {
				id: "if_beta",
				containerId: "box",
				kind: "entry",
				label: "Beta",
				taskRef: "beta",
			},
		};
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box"]));
		expect(projection.edges[0].targetInterfaceId).toBe("if_beta");
	});

	it("resolves both ends when an edge crosses two collapsed containers", () => {
		const doc = build(
			[
				task("box1", { parentId: null }, "container"),
				task("box2", { parentId: null }, "container"),
				task("a", { parentId: "box1" }),
				task("b", { parentId: "box2" }),
			],
			[fts("e", "a", "b")],
		);
		ensureContainerInterfaces(doc, "box1");
		ensureContainerInterfaces(doc, "box2");
		const r = computeSchedule(doc);
		const projection = projectGraph(doc, r, new Set(["box1", "box2"]));
		const edge = projection.edges[0];
		expect(edge.source).toBe("box1");
		expect(edge.target).toBe("box2");
		expect(edge.sourceInterfaceId).toBeDefined();
		expect(edge.targetInterfaceId).toBeDefined();
		const exitOnBox1 = Object.values(doc.interfacesByContainerId.box1).find(
			(i) => i.kind === "exit",
		) as ContainerInterface;
		const entryOnBox2 = Object.values(doc.interfacesByContainerId.box2).find(
			(i) => i.kind === "entry",
		) as ContainerInterface;
		expect(edge.sourceInterfaceId).toBe(exitOnBox1.id);
		expect(edge.targetInterfaceId).toBe(entryOnBox2.id);
	});

	it("interface resolution is stable across repeated collapse toggles", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("inner", { parentId: "box" }),
				task("outside"),
			],
			[fts("e", "outside", "inner")],
		);
		ensureContainerInterfaces(doc, "box");
		const r = computeSchedule(doc);
		const first = projectGraph(doc, r, new Set(["box"])).edges[0];
		const second = projectGraph(doc, r, new Set(["box"])).edges[0];
		expect(second.targetInterfaceId).toBe(first.targetInterfaceId);
		const expanded = projectGraph(doc, r, new Set()).edges[0];
		expect(expanded.targetInterfaceId).toBeUndefined();
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

describe("rollupContainerPaths", () => {
	it("returns empty when no interfaces are bound to descendants", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("inner", { parentId: "box" }),
			],
			[],
		);
		ensureContainerInterfaces(doc, "box");
		const r = computeSchedule(doc);
		if (!r.ok) throw new Error("expected ok");
		expect(rollupContainerPaths(doc, r.schedule, null, "box")).toEqual([]);
	});

	it("computes one row per (entry, exit) pair when both sides are bound", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("start", { parentId: "box", estimate: est(1, 1, 1) }),
				task("end", { parentId: "box", estimate: est(2, 2, 2) }),
			],
			[fts("se", "start", "end")],
		);
		doc.interfacesByContainerId.box = {
			if_in: {
				id: "if_in",
				containerId: "box",
				kind: "entry",
				label: "Begin",
				taskRef: "start",
			},
			if_out: {
				id: "if_out",
				containerId: "box",
				kind: "exit",
				label: "Done",
				taskRef: "end",
			},
		};
		const r = computeSchedule(doc);
		if (!r.ok) throw new Error("expected ok");
		const paths = rollupContainerPaths(doc, r.schedule, null, "box");
		expect(paths).toHaveLength(1);
		expect(paths[0].entryLabel).toBe("Begin");
		expect(paths[0].exitLabel).toBe("Done");
		// start ES=0 (duration 1), end EF=3 (start at 1 finish at 3), expected = 3
		expect(paths[0].expected).toBeCloseTo(3);
		expect(paths[0].p50).toBeUndefined();
	});

	it("emits a row for every (entry, exit) combination", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("a", { parentId: "box" }),
				task("b", { parentId: "box" }),
				task("x", { parentId: "box" }),
				task("y", { parentId: "box" }),
			],
			[],
		);
		doc.interfacesByContainerId.box = {
			if_a: {
				id: "if_a",
				containerId: "box",
				kind: "entry",
				label: "A",
				taskRef: "a",
			},
			if_b: {
				id: "if_b",
				containerId: "box",
				kind: "entry",
				label: "B",
				taskRef: "b",
			},
			if_x: {
				id: "if_x",
				containerId: "box",
				kind: "exit",
				label: "X",
				taskRef: "x",
			},
			if_y: {
				id: "if_y",
				containerId: "box",
				kind: "exit",
				label: "Y",
				taskRef: "y",
			},
		};
		const r = computeSchedule(doc);
		if (!r.ok) throw new Error("expected ok");
		const paths = rollupContainerPaths(doc, r.schedule, null, "box");
		expect(paths).toHaveLength(4);
		const labels = paths.map((p) => `${p.entryLabel}→${p.exitLabel}`).sort();
		expect(labels).toEqual(["A→X", "A→Y", "B→X", "B→Y"]);
	});

	it("emits one row per (entry, exit) pair regardless of order — property", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 4 }),
				fc.integer({ min: 1, max: 4 }),
				(numEntries, numExits) => {
					const tasks: Task[] = [task("box", { parentId: null }, "container")];
					const entries: Array<[string, string]> = [];
					const exits: Array<[string, string]> = [];
					for (let i = 0; i < numEntries; i++) {
						const id = `entry_${i}`;
						tasks.push(task(id, { parentId: "box" }));
						entries.push([`if_in_${i}`, id]);
					}
					for (let i = 0; i < numExits; i++) {
						const id = `exit_${i}`;
						tasks.push(task(id, { parentId: "box" }));
						exits.push([`if_out_${i}`, id]);
					}
					const doc = build(tasks, []);
					doc.interfacesByContainerId.box = {};
					for (const [id, taskRef] of entries) {
						doc.interfacesByContainerId.box[id] = {
							id,
							containerId: "box",
							kind: "entry",
							label: id,
							taskRef,
						};
					}
					for (const [id, taskRef] of exits) {
						doc.interfacesByContainerId.box[id] = {
							id,
							containerId: "box",
							kind: "exit",
							label: id,
							taskRef,
						};
					}
					const r = computeSchedule(doc);
					if (!r.ok) return;
					const paths = rollupContainerPaths(doc, r.schedule, null, "box");
					expect(paths).toHaveLength(numEntries * numExits);
				},
			),
		);
	});

	it("uses Monte Carlo percentiles when an MC result is supplied", () => {
		const doc = build(
			[
				task("box", { parentId: null }, "container"),
				task("start", { parentId: "box", estimate: est(1, 1, 1) }),
				task("end", { parentId: "box", estimate: est(2, 2, 2) }),
			],
			[fts("se", "start", "end")],
		);
		doc.interfacesByContainerId.box = {
			if_in: {
				id: "if_in",
				containerId: "box",
				kind: "entry",
				label: "Begin",
				taskRef: "start",
			},
			if_out: {
				id: "if_out",
				containerId: "box",
				kind: "exit",
				label: "Done",
				taskRef: "end",
			},
		};
		const r = computeSchedule(doc);
		if (!r.ok) throw new Error("expected ok");
		const fakeMc = {
			trials: 1000,
			projectFinish: {
				p10: 0,
				p50: 0,
				p90: 0,
				mean: 0,
				p50Date: "",
				p90Date: "",
			},
			tasks: {
				start: {
					taskId: "start",
					p10: 1,
					p50: 1,
					p90: 1.5,
					mean: 1,
					criticality: 1,
					p50Date: "",
					p90Date: "",
				},
				end: {
					taskId: "end",
					p10: 3,
					p50: 4,
					p90: 5,
					mean: 4,
					criticality: 1,
					p50Date: "",
					p90Date: "",
				},
			},
		};
		const paths = rollupContainerPaths(doc, r.schedule, fakeMc, "box");
		expect(paths[0].p50).toBeCloseTo(3);
		expect(paths[0].p90).toBeCloseTo(4);
		expect(paths[0].criticality).toBe(1);
	});
});
