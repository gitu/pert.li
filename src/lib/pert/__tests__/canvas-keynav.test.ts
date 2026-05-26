import { describe, expect, it } from "vitest";
import { findNeighborTaskId } from "#/lib/pert/canvas-keynav";
import { createEmptyPertDoc, type PertDoc, type Task } from "#/lib/pert/types";

function leaf(
	id: string,
	x: number,
	y: number,
	kind: Task["kind"] = "task",
): Task {
	const base: Task = {
		id,
		kind,
		title: id,
		parentId: null,
		layout: { position: { x, y } },
	};
	if (kind === "task") {
		base.estimate = {
			optimistic: 1,
			mostLikely: 1,
			pessimistic: 1,
			unit: "day",
		};
	}
	return base;
}

function build(...tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("nav");
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

function dep(id: string, from: string, to: string) {
	return {
		id,
		from: { taskId: from },
		to: { taskId: to },
		type: "finish_to_start" as const,
	};
}

describe("findNeighborTaskId", () => {
	it("returns null when the selected task does not exist", () => {
		const doc = build(leaf("a", 0, 0));
		expect(findNeighborTaskId(doc, "missing", "left")).toBeNull();
	});

	it("returns null when there are no dependencies in the requested direction", () => {
		const doc = build(leaf("a", 0, 0), leaf("b", 300, 0));
		expect(findNeighborTaskId(doc, "a", "left")).toBeNull();
		expect(findNeighborTaskId(doc, "a", "right")).toBeNull();
		expect(findNeighborTaskId(doc, "a", "up")).toBeNull();
		expect(findNeighborTaskId(doc, "a", "down")).toBeNull();
	});

	it("walks Right to the single successor", () => {
		const doc = build(leaf("a", 0, 0), leaf("b", 300, 0));
		doc.dependenciesById.d1 = dep("d1", "a", "b");
		expect(findNeighborTaskId(doc, "a", "right")).toBe("b");
		expect(findNeighborTaskId(doc, "b", "left")).toBe("a");
	});

	it("prefers the successor closest in y when there are multiple branches", () => {
		const doc = build(
			leaf("a", 0, 100),
			leaf("up", 300, 0),
			leaf("near", 300, 110),
			leaf("far", 300, 400),
		);
		doc.dependenciesById.d1 = dep("d1", "a", "up");
		doc.dependenciesById.d2 = dep("d2", "a", "near");
		doc.dependenciesById.d3 = dep("d3", "a", "far");
		expect(findNeighborTaskId(doc, "a", "right")).toBe("near");
	});

	it("treats containers as invalid landing targets", () => {
		const doc = build(
			leaf("a", 0, 0),
			leaf("c", 300, 0, "container"),
			leaf("b", 300, 50),
		);
		doc.dependenciesById.d1 = dep("d1", "a", "c");
		doc.dependenciesById.d2 = dep("d2", "a", "b");
		expect(findNeighborTaskId(doc, "a", "right")).toBe("b");
	});

	it("Down finds a sibling that shares a predecessor and sits below", () => {
		const doc = build(
			leaf("root", 0, 100),
			leaf("a", 300, 100),
			leaf("b", 300, 200),
			leaf("c", 300, 300),
		);
		doc.dependenciesById["r-a"] = dep("r-a", "root", "a");
		doc.dependenciesById["r-b"] = dep("r-b", "root", "b");
		doc.dependenciesById["r-c"] = dep("r-c", "root", "c");
		expect(findNeighborTaskId(doc, "a", "down")).toBe("b");
		expect(findNeighborTaskId(doc, "b", "down")).toBe("c");
		expect(findNeighborTaskId(doc, "c", "down")).toBeNull();
	});

	it("Up mirrors Down and respects strict y-above", () => {
		const doc = build(
			leaf("root", 0, 100),
			leaf("a", 300, 100),
			leaf("b", 300, 200),
			leaf("c", 300, 300),
		);
		doc.dependenciesById["r-a"] = dep("r-a", "root", "a");
		doc.dependenciesById["r-b"] = dep("r-b", "root", "b");
		doc.dependenciesById["r-c"] = dep("r-c", "root", "c");
		expect(findNeighborTaskId(doc, "c", "up")).toBe("b");
		expect(findNeighborTaskId(doc, "b", "up")).toBe("a");
		expect(findNeighborTaskId(doc, "a", "up")).toBeNull();
	});

	it("falls back to shared-successor siblings when no shared predecessor exists", () => {
		// `a` and `b` both feed into `join` — no shared predecessor, but they
		// are siblings on the converging side.
		const doc = build(
			leaf("a", 0, 100),
			leaf("b", 0, 200),
			leaf("join", 300, 150),
		);
		doc.dependenciesById["a-j"] = dep("a-j", "a", "join");
		doc.dependenciesById["b-j"] = dep("b-j", "b", "join");
		expect(findNeighborTaskId(doc, "a", "down")).toBe("b");
		expect(findNeighborTaskId(doc, "b", "up")).toBe("a");
	});
});
