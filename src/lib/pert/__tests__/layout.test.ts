import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeLayout, fallbackGridLayout, NODE_WIDTH } from "../layout";
import type { Estimate, PertDoc, Task } from "../types";
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
		parentId: null,
		estimate: est,
		...overrides,
	};
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

	it("returns a position for a top-level container too (hierarchical mode)", async () => {
		const doc = chain(2);
		doc.tasksById.box = task("box", { kind: "container" });
		const positions = await computeLayout(doc);
		// Container participates in the layout — leaf positions still exist
		// alongside it. ELK chose the container's coordinates.
		expect(positions.box).toBeDefined();
		expect(positions.T0).toBeDefined();
	});
});

describe("computeLayout — hierarchical (containers)", () => {
	function nestedDoc(): PertDoc {
		const doc = createEmptyPertDoc("nested");
		doc.tasksById.outer = task("outer", { kind: "container" });
		doc.tasksById.inner = task("inner", {
			kind: "container",
			parentId: "outer",
		});
		doc.tasksById.A = task("A", { parentId: "inner" });
		doc.tasksById.B = task("B", { parentId: "inner" });
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

	it("places leaves inside their container's bounds (forceReflow)", async () => {
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
		// A and B should both sit *inside* the inner container, which is
		// inside the outer container. We don't know exact sizes from ELK's
		// computed bounds here, so just sanity-check ordering: outer.x ≤
		// inner.x ≤ leaf.x.
		expect(outer.x).toBeLessThanOrEqual(inner.x);
		expect(inner.x).toBeLessThanOrEqual(a.x);
		expect(inner.x).toBeLessThanOrEqual(b.x);
		expect(outer.y).toBeLessThanOrEqual(inner.y);
	});

	it("preserves left-to-right ordering for chained leaves inside a container", async () => {
		const doc = nestedDoc();
		const positions = await computeLayout(doc, { forceReflow: true });
		// A → B inside inner.
		expect(positions.A.x).toBeLessThan(positions.B.x);
	});

	it("collapsed containers participate as a single sized node", async () => {
		const doc = nestedDoc();
		const positions = await computeLayout(doc, {
			forceReflow: true,
			collapsed: new Set(["outer"]),
		});
		// Outer is still placed; its descendants either don't appear or
		// share its coordinates (we don't render them either way).
		expect(positions.outer).toBeDefined();
		// Outsider should sit to the right of outer because B→outsider was
		// rerouted to outer→outsider during collapse.
		expect(positions.outsider.x).toBeGreaterThan(positions.outer.x);
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

// Orphan handling — a task whose parentId doesn't resolve to an existing
// container (dangling reference from a half-applied AI proposal, parent
// converted to a leaf, parentId cycle) must still be laid out. Before this
// was fixed, orphans got no position at all and their edges referenced nodes
// missing from the ELK graph, which failed the entire hierarchical layout.
describe("layout with broken parent references", () => {
	it("ELK layout places a task whose parentId is dangling", async () => {
		const doc = createEmptyPertDoc("orphans");
		doc.tasksById.box = task("box", { kind: "container" });
		doc.tasksById.inside = task("inside", { parentId: "box" });
		doc.tasksById.orphan = task("orphan", { parentId: "ghost_container" });
		const positions = await computeLayout(doc, { forceReflow: true });
		expect(positions.orphan).toBeDefined();
		expect(positions.inside).toBeDefined();
		expect(positions.box).toBeDefined();
	});

	it("ELK layout survives edges that touch an orphaned task", async () => {
		const doc = createEmptyPertDoc("orphans");
		doc.tasksById.box = task("box", { kind: "container" });
		doc.tasksById.inside = task("inside", { parentId: "box" });
		doc.tasksById.orphan = task("orphan", { parentId: "ghost_container" });
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

	it("ELK layout places tasks whose parent is not a container", async () => {
		const doc = createEmptyPertDoc("orphans");
		doc.tasksById.box = task("box", { kind: "container" });
		doc.tasksById.leafparent = task("leafparent");
		doc.tasksById.child = task("child", { parentId: "leafparent" });
		const positions = await computeLayout(doc, { forceReflow: true });
		expect(positions.child).toBeDefined();
		expect(positions.leafparent).toBeDefined();
	});

	it("ELK layout terminates and places everything when parentIds form a cycle", async () => {
		const doc = createEmptyPertDoc("cycle");
		doc.tasksById.a = task("a", { kind: "container", parentId: "b" });
		doc.tasksById.b = task("b", { kind: "container", parentId: "a" });
		doc.tasksById.t = task("t", { parentId: "a" });
		const positions = await computeLayout(doc, { forceReflow: true });
		expect(positions.a).toBeDefined();
		expect(positions.b).toBeDefined();
		expect(positions.t).toBeDefined();
	});

	it("fallbackGridLayout places orphaned leaves", () => {
		const doc = createEmptyPertDoc("orphans");
		doc.tasksById.box = task("box", { kind: "container" });
		doc.tasksById.orphan = task("orphan", { parentId: "ghost" });
		const positions = fallbackGridLayout(doc);
		expect(positions.orphan).toBeDefined();
	});

	it("fallbackGridLayout terminates on parentId cycles", () => {
		const doc = createEmptyPertDoc("cycle");
		doc.tasksById.a = task("a", { kind: "container", parentId: "b" });
		doc.tasksById.b = task("b", { kind: "container", parentId: "a" });
		doc.tasksById.t = task("t", { parentId: "b" });
		const positions = fallbackGridLayout(doc);
		expect(positions.t).toBeDefined();
	});
});

// Property test (CLAUDE.md rule: src/lib/pert/ logic gets fast-check coverage):
// for ANY parentId wiring — valid, dangling, non-container parents, cycles —
// fallbackGridLayout returns a position for every non-container task.
describe("fallbackGridLayout properties", () => {
	const kindArb = fc.constantFrom<Task["kind"]>("task", "container");

	it("every leaf task gets a position regardless of parentId validity", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						idx: fc.integer({ min: 0, max: 11 }),
						kind: kindArb,
						// Parent picked from a wider id space than the tasks that
						// exist, so dangling references and self/cyclic links occur.
						parentIdx: fc.option(fc.integer({ min: 0, max: 15 }), {
							nil: null,
						}),
					}),
					{ minLength: 1, maxLength: 12 },
				),
				(specs) => {
					const doc = createEmptyPertDoc("prop");
					for (const spec of specs) {
						const id = `t${spec.idx}`;
						doc.tasksById[id] = task(id, {
							kind: spec.kind,
							parentId: spec.parentIdx === null ? null : `t${spec.parentIdx}`,
						});
					}
					const positions = fallbackGridLayout(doc);
					for (const t of Object.values(doc.tasksById)) {
						if (t.kind === "container") continue;
						expect(
							positions[t.id],
							`no position for ${t.id} (parentId=${t.parentId})`,
						).toBeDefined();
					}
				},
			),
		);
	});
});
