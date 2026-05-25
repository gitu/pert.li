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
