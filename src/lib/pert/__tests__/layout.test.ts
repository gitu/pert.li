import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeLayout, fallbackGridLayout, NODE_WIDTH } from "../layout";
import type { Estimate, Group, PertDoc, Task } from "../types";
import { createEmptyPertDoc } from "../types";

const est: Estimate = {
	optimistic: 1,
	mostLikely: 1,
	pessimistic: 1,
	unit: "day",
};

function task(id: string, overrides: Partial<Task> = {}): Task {
	return {
		id,
		kind: "task",
		title: id,
		estimate: est,
		...overrides,
	};
}

function group(id: string, parentGroupId: string | null = null): Group {
	return { id, name: id, parentGroupId, order: 0 };
}

function chain(n: number): PertDoc {
	const doc = createEmptyPertDoc("chain");
	for (let i = 0; i < n; i++) doc.tasksById[`T${i}`] = task(`T${i}`);
	for (let i = 0; i < n - 1; i++) {
		doc.dependenciesById[`E${i}`] = {
			id: `E${i}`,
			from: { taskId: `T${i}` },
			to: { taskId: `T${i + 1}` },
			type: "finish_to_start",
		};
	}
	return doc;
}

describe("computeLayout", () => {
	it("returns an empty map for an empty doc", async () => {
		const result = await computeLayout(createEmptyPertDoc("blank"));
		expect(result).toEqual({});
	});

	it("places a 3-node chain left-to-right with monotonic X", async () => {
		const doc = chain(3);
		const positions = await computeLayout(doc);
		expect(positions.T0.x).toBeLessThan(positions.T1.x);
		expect(positions.T1.x).toBeLessThan(positions.T2.x);
	});

	it("respects persisted positions and returns them verbatim", async () => {
		const doc = chain(3);
		doc.tasksById.T1.layout = { position: { x: 9999, y: -42 } };
		const positions = await computeLayout(doc);
		expect(positions.T1).toEqual({ x: 9999, y: -42 });
	});

	it("returns a position for a top-level group too (hierarchical mode)", async () => {
		const doc = chain(2);
		doc.groupsById.box = group("box");
		const positions = await computeLayout(doc);
		// The group participates in the layout — leaf positions still exist
		// alongside it. ELK chose the group's coordinates.
		expect(positions.box).toBeDefined();
		expect(positions.T0).toBeDefined();
	});
});

describe("computeLayout — hierarchical (groups)", () => {
	function nestedDoc(): PertDoc {
		const doc = createEmptyPertDoc("nested");
		doc.groupsById.outer = group("outer");
		doc.groupsById.inner = group("inner", "outer");
		doc.tasksById.A = task("A", { groupId: "inner" });
		doc.tasksById.B = task("B", { groupId: "inner" });
		doc.tasksById.outsider = task("outsider");
		doc.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "finish_to_start",
		};
		doc.dependenciesById.bo = {
			id: "bo",
			from: { taskId: "B" },
			to: { taskId: "outsider" },
			type: "finish_to_start",
		};
		return doc;
	}

	it("places member tasks inside their group's bounds (forceReflow)", async () => {
		const doc = nestedDoc();
		const positions = await computeLayout(doc, { forceReflow: true });
		const outer = positions.outer;
		const inner = positions.inner;
		const a = positions.A;
		const b = positions.B;
		expect(outer).toBeDefined();
		expect(inner).toBeDefined();
		expect(a).toBeDefined();
		expect(b).toBeDefined();
		// A and B should both sit *inside* the inner group, which is inside the
		// outer group. Sanity-check ordering: outer.x ≤ inner.x ≤ leaf.x.
		expect(outer.x).toBeLessThanOrEqual(inner.x);
		expect(inner.x).toBeLessThanOrEqual(a.x);
		expect(inner.x).toBeLessThanOrEqual(b.x);
		expect(outer.y).toBeLessThanOrEqual(inner.y);
	});

	it("preserves left-to-right ordering for chained leaves inside a group", async () => {
		const doc = nestedDoc();
		const positions = await computeLayout(doc, { forceReflow: true });
		// A → B inside inner.
		expect(positions.A.x).toBeLessThan(positions.B.x);
	});

	it("collapsed groups participate as a single sized node", async () => {
		const doc = nestedDoc();
		const positions = await computeLayout(doc, {
			forceReflow: true,
			collapsed: new Set(["outer"]),
		});
		// Outer is still placed; its descendants either don't appear or share
		// its coordinates (we don't render them either way).
		expect(positions.outer).toBeDefined();
		// Outsider should sit to the right of outer because B→outsider was
		// rerouted to outer→outsider during collapse.
		expect(positions.outsider.x).toBeGreaterThan(positions.outer.x);
	});

	it("a group beyond the depth cap gets no position; its tasks still do", async () => {
		const doc = nestedDoc();
		// Cap at level 1: inner (level 2) folds away — no box, no position — but
		// its member tasks are still laid out (inside outer).
		const positions = await computeLayout(doc, {
			forceReflow: true,
			maxLevel: 1,
		});
		expect(positions.outer).toBeDefined();
		expect(positions.inner).toBeUndefined();
		expect(positions.A).toBeDefined();
		expect(positions.B).toBeDefined();
		expect(positions.outer.x).toBeLessThanOrEqual(positions.A.x);
	});

	it("cap 0 lays the graph out flat — no group positions at all", async () => {
		const doc = nestedDoc();
		const positions = await computeLayout(doc, {
			forceReflow: true,
			maxLevel: 0,
		});
		expect(positions.outer).toBeUndefined();
		expect(positions.inner).toBeUndefined();
		expect(positions.A).toBeDefined();
		expect(positions.B).toBeDefined();
		expect(positions.outsider).toBeDefined();
	});
});

describe("fallbackGridLayout", () => {
	it("uses persisted positions where present, grid otherwise", () => {
		const doc = chain(5);
		doc.tasksById.T2.layout = { position: { x: 700, y: 700 } };
		const result = fallbackGridLayout(doc);
		expect(result.T2).toEqual({ x: 700, y: 700 });
		// Grid positions are non-negative multiples of (NODE_WIDTH + 80).
		expect(result.T0.x).toBe(0);
		expect(result.T0.y).toBe(0);
		expect(result.T1.x).toBe(NODE_WIDTH + 80);
	});

	it("never overlaps two grid-placed nodes", () => {
		const doc = chain(12);
		const positions = fallbackGridLayout(doc);
		const seen = new Set<string>();
		for (const [id, pos] of Object.entries(positions)) {
			const key = `${pos.x}|${pos.y}`;
			expect(seen.has(key), `${id} collides at ${key}`).toBe(false);
			seen.add(key);
		}
	});
});

// Orphan handling — a task whose groupId doesn't resolve to an existing group
// (dangling reference from a half-applied AI proposal, a deleted group, a
// parentGroupId cycle) must still be laid out. Before this was fixed, orphans
// got no position at all and their edges referenced nodes missing from the ELK
// graph, which failed the entire hierarchical layout.
describe("layout with broken group references", () => {
	it("ELK layout places a task whose groupId is dangling", async () => {
		const doc = createEmptyPertDoc("orphans");
		doc.groupsById.box = group("box");
		doc.tasksById.inside = task("inside", { groupId: "box" });
		doc.tasksById.orphan = task("orphan", { groupId: "ghost_group" });
		const positions = await computeLayout(doc, { forceReflow: true });
		expect(positions.orphan).toBeDefined();
		expect(positions.inside).toBeDefined();
		expect(positions.box).toBeDefined();
	});

	it("ELK layout survives edges that touch an orphaned task", async () => {
		const doc = createEmptyPertDoc("orphans");
		doc.groupsById.box = group("box");
		doc.tasksById.inside = task("inside", { groupId: "box" });
		doc.tasksById.orphan = task("orphan", { groupId: "ghost_group" });
		doc.dependenciesById.e = {
			id: "e",
			from: { taskId: "orphan" },
			to: { taskId: "inside" },
			type: "finish_to_start",
		};
		const positions = await computeLayout(doc, { forceReflow: true });
		expect(positions.orphan).toBeDefined();
		expect(positions.inside).toBeDefined();
	});

	it("ELK layout places ungrouped tasks alongside grouped ones", async () => {
		const doc = createEmptyPertDoc("orphans");
		doc.groupsById.box = group("box");
		doc.tasksById.member = task("member", { groupId: "box" });
		doc.tasksById.loose = task("loose");
		const positions = await computeLayout(doc, { forceReflow: true });
		expect(positions.member).toBeDefined();
		expect(positions.loose).toBeDefined();
	});

	it("ELK layout terminates and places everything when parentGroupIds form a cycle", async () => {
		const doc = createEmptyPertDoc("cycle");
		doc.groupsById.a = group("a", "b");
		doc.groupsById.b = group("b", "a");
		doc.tasksById.t = task("t", { groupId: "a" });
		const positions = await computeLayout(doc, { forceReflow: true });
		expect(positions.a).toBeDefined();
		expect(positions.b).toBeDefined();
		expect(positions.t).toBeDefined();
	});

	it("fallbackGridLayout places orphaned leaves", () => {
		const doc = createEmptyPertDoc("orphans");
		doc.groupsById.box = group("box");
		doc.tasksById.orphan = task("orphan", { groupId: "ghost" });
		const positions = fallbackGridLayout(doc);
		expect(positions.orphan).toBeDefined();
	});

	it("fallbackGridLayout terminates on parentGroupId cycles", () => {
		const doc = createEmptyPertDoc("cycle");
		doc.groupsById.a = group("a", "b");
		doc.groupsById.b = group("b", "a");
		doc.tasksById.t = task("t", { groupId: "b" });
		const positions = fallbackGridLayout(doc);
		expect(positions.t).toBeDefined();
	});
});

// Property test (CLAUDE.md rule: src/lib/pert/ logic gets fast-check coverage):
// for ANY groupId wiring — valid, dangling, cyclic group parents —
// fallbackGridLayout returns a position for every task.
describe("fallbackGridLayout properties", () => {
	it("every task gets a position regardless of groupId validity", () => {
		fc.assert(
			fc.property(
				fc.record({
					// A few groups whose parents may dangle or form cycles.
					groups: fc.array(
						fc.record({
							idx: fc.integer({ min: 0, max: 3 }),
							parentIdx: fc.option(fc.integer({ min: 0, max: 5 }), {
								nil: null,
							}),
						}),
						{ maxLength: 4 },
					),
					tasks: fc.array(
						fc.record({
							idx: fc.integer({ min: 0, max: 11 }),
							// Group picked from a wider id space than the groups that
							// exist, so dangling references occur.
							groupIdx: fc.option(fc.integer({ min: 0, max: 6 }), {
								nil: null,
							}),
						}),
						{ minLength: 1, maxLength: 12 },
					),
				}),
				({ groups, tasks }) => {
					const doc = createEmptyPertDoc("prop");
					for (const g of groups) {
						const id = `g${g.idx}`;
						doc.groupsById[id] = group(
							id,
							g.parentIdx === null ? null : `g${g.parentIdx}`,
						);
					}
					for (const t of tasks) {
						const id = `t${t.idx}`;
						doc.tasksById[id] = task(id, {
							groupId: t.groupIdx === null ? null : `g${t.groupIdx}`,
						});
					}
					const positions = fallbackGridLayout(doc);
					for (const t of Object.values(doc.tasksById)) {
						expect(
							positions[t.id],
							`no position for ${t.id} (groupId=${t.groupId})`,
						).toBeDefined();
					}
				},
			),
		);
	});
});
