import { describe, expect, it } from "vitest";
import {
	buildContainerSnapshot,
	canReparent,
	containerBoundsFromDescendants,
	findContainerAtPoint,
	findContainerAtPointInSnapshot,
	reparentMutation,
	shiftDescendantsMutation,
} from "#/lib/pert/reparent";
import { createEmptyPertDoc, type PertDoc, type Task } from "#/lib/pert/types";

const est = {
	optimistic: 1,
	mostLikely: 1,
	pessimistic: 1,
	unit: "day" as const,
};

function leaf(
	id: string,
	parentId: string | null = null,
	position: { x: number; y: number } | null = null,
): Task {
	return {
		id,
		kind: "task",
		title: id,
		parentId,
		estimate: est,
		layout: position ? { position } : undefined,
	};
}

function container(id: string, parentId: string | null = null): Task {
	return { id, kind: "container", title: id, parentId };
}

function build(...tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("r");
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

describe("containerBoundsFromDescendants", () => {
	it("computes bounding box around descendant leaves (with padding)", () => {
		const doc = build(
			container("box"),
			leaf("A", "box", { x: 0, y: 0 }),
			leaf("B", "box", { x: 400, y: 200 }),
		);
		const b = containerBoundsFromDescendants(doc, "box");
		expect(b).not.toBeNull();
		// minX = 0 - padX (36), minY = 0 - padTop (44).
		expect(b?.x).toBe(-36);
		expect(b?.y).toBe(-44);
		// width >= max(maxX - minX + 2*padX, MIN_WIDTH=440)
		// = max(400 + 200 + 72, 440) = 672.
		expect(b?.width).toBe(672);
	});

	it("returns minimum size when there are no positioned descendants", () => {
		const doc = build(container("box"));
		const b = containerBoundsFromDescendants(doc, "box");
		expect(b).toEqual({ x: 0, y: 0, width: 440, height: 280 });
	});

	it("returns null for a non-container id", () => {
		const doc = build(leaf("A"));
		expect(containerBoundsFromDescendants(doc, "A")).toBeNull();
	});
});

describe("findContainerAtPoint", () => {
	it("finds the container whose bounds include the point", () => {
		const doc = build(
			container("box"),
			leaf("A", "box", { x: 100, y: 100 }),
			leaf("B", "box", { x: 400, y: 200 }),
		);
		expect(findContainerAtPoint(doc, { x: 150, y: 150 }, new Set())).toBe(
			"box",
		);
	});

	it("returns null when the point is outside every container", () => {
		const doc = build(container("box"), leaf("A", "box", { x: 100, y: 100 }));
		expect(findContainerAtPoint(doc, { x: -1000, y: -1000 }, new Set())).toBe(
			null,
		);
	});

	it("prefers the deepest (most nested) container when bounds overlap", () => {
		const doc = build(
			container("outer"),
			container("inner", "outer"),
			leaf("A", "inner", { x: 100, y: 100 }),
			leaf("B", "inner", { x: 300, y: 200 }),
		);
		// Both outer and inner contain (200, 150); inner is deeper.
		expect(findContainerAtPoint(doc, { x: 200, y: 150 }, new Set())).toBe(
			"inner",
		);
	});

	it("skips collapsed containers", () => {
		const doc = build(
			container("outer"),
			container("inner", "outer"),
			leaf("A", "inner", { x: 100, y: 100 }),
			leaf("B", "inner", { x: 300, y: 200 }),
		);
		// Inner is collapsed → outer wins for the same point.
		expect(
			findContainerAtPoint(doc, { x: 200, y: 150 }, new Set(["inner"])),
		).toBe("outer");
	});
});

describe("buildContainerSnapshot + findContainerAtPointInSnapshot", () => {
	it("matches findContainerAtPoint for the nested case (deepest wins)", () => {
		const doc = build(
			container("outer"),
			container("inner", "outer"),
			leaf("A", "inner", { x: 100, y: 100 }),
			leaf("B", "inner", { x: 300, y: 200 }),
		);
		const snap = buildContainerSnapshot(doc, new Set());
		expect(findContainerAtPointInSnapshot(snap, { x: 200, y: 150 })).toBe(
			"inner",
		);
		expect(findContainerAtPointInSnapshot(snap, { x: -1000, y: -1000 })).toBe(
			null,
		);
	});

	it("honors the collapsed set (skips collapsed containers)", () => {
		const doc = build(
			container("outer"),
			container("inner", "outer"),
			leaf("A", "inner", { x: 100, y: 100 }),
			leaf("B", "inner", { x: 300, y: 200 }),
		);
		const snap = buildContainerSnapshot(doc, new Set(["inner"]));
		expect(findContainerAtPointInSnapshot(snap, { x: 200, y: 150 })).toBe(
			"outer",
		);
	});

	it("honors excludeIds (drag-out: leaf removed from its parent's bounds)", () => {
		// A single leaf inside its container: with the leaf excluded the
		// container falls back to MIN size around its own position (default
		// 0,0). A point far away should miss.
		const doc = build(container("box"), leaf("A", "box", { x: 100, y: 100 }));
		const snap = buildContainerSnapshot(doc, new Set(), new Set(["A"]));
		// Point (150, 150) was inside before exclusion, should now miss the
		// shrunk fallback box at (0,0)..(440,280).
		expect(findContainerAtPointInSnapshot(snap, { x: 1000, y: 1000 })).toBe(
			null,
		);
	});

	it("sorts deepest-first so the linear scan returns the deepest hit", () => {
		const doc = build(
			container("outer"),
			container("inner", "outer"),
			leaf("A", "inner", { x: 100, y: 100 }),
			leaf("B", "inner", { x: 300, y: 200 }),
		);
		const snap = buildContainerSnapshot(doc, new Set());
		expect(snap[0]?.id).toBe("inner");
		expect(snap[1]?.id).toBe("outer");
	});
});

describe("canReparent", () => {
	const doc = build(
		container("root"),
		container("child", "root"),
		leaf("A"),
		leaf("B", "root"),
	);

	it("allows moving a root task into a container", () => {
		expect(canReparent(doc, "A", "root")).toBe(true);
	});

	it("allows promoting to root (null)", () => {
		expect(canReparent(doc, "B", null)).toBe(true);
	});

	it("forbids re-parenting onto current parent (no-op)", () => {
		expect(canReparent(doc, "B", "root")).toBe(false);
	});

	it("forbids dropping into self or a non-container", () => {
		expect(canReparent(doc, "root", "root")).toBe(false);
		expect(canReparent(doc, "A", "B")).toBe(false);
	});

	it("forbids dropping a container into one of its descendants", () => {
		expect(canReparent(doc, "root", "child")).toBe(false);
	});
});

describe("reparentMutation", () => {
	it("sets parentId on the matching task", () => {
		const doc = build(container("box"), leaf("A"));
		reparentMutation("A", "box")(doc);
		expect(doc.tasksById.A.parentId).toBe("box");
	});

	it("no-ops on a missing task id", () => {
		const doc = build(container("box"));
		reparentMutation("missing", "box")(doc);
		expect(doc.tasksById.missing).toBeUndefined();
	});
});

describe("shiftDescendantsMutation", () => {
	it("shifts every leaf descendant by (dx, dy)", () => {
		const doc = build(
			container("box"),
			container("inner", "box"),
			leaf("A", "inner", { x: 100, y: 100 }),
			leaf("B", "box", { x: 200, y: 50 }),
		);
		shiftDescendantsMutation("box", 30, -10)(doc);
		expect(doc.tasksById.A.layout?.position).toEqual({ x: 130, y: 90 });
		expect(doc.tasksById.B.layout?.position).toEqual({ x: 230, y: 40 });
	});

	it("ignores container descendants (they have no stored position)", () => {
		const doc = build(
			container("box"),
			container("inner", "box"),
			leaf("A", "inner", { x: 0, y: 0 }),
		);
		shiftDescendantsMutation("box", 10, 10)(doc);
		expect(doc.tasksById.inner.layout).toBeUndefined();
		expect(doc.tasksById.A.layout?.position).toEqual({ x: 10, y: 10 });
	});
});
