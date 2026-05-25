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

	it("skips container tasks", async () => {
		const doc = chain(2);
		doc.tasksById.box = task("box", { kind: "container" });
		const positions = await computeLayout(doc);
		expect(positions.box).toBeUndefined();
		expect(positions.T0).toBeDefined();
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
