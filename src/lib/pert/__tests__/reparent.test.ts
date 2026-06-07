import { describe, expect, it } from "vitest";
import {
	buildGroupSnapshot,
	findGroupAtPointInSnapshot,
	groupBoundsFromMembers,
	shiftGroupMembersMutation,
} from "#/lib/pert/reparent";
import {
	createEmptyPertDoc,
	type Group,
	type PertDoc,
	type Task,
} from "#/lib/pert/types";

const est = {
	optimistic: 1,
	mostLikely: 1,
	pessimistic: 1,
	unit: "day" as const,
};

function leaf(
	id: string,
	groupId: string | null = null,
	position: { x: number; y: number } | null = null,
): Task {
	return {
		id,
		kind: "task",
		title: id,
		groupId,
		estimate: est,
		layout: position ? { position } : undefined,
	};
}

function group(id: string, parentGroupId: string | null = null): Group {
	return { id, name: id, parentGroupId, order: 0 };
}

function build(groups: Group[], tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("r");
	for (const g of groups) doc.groupsById[g.id] = g;
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

describe("groupBoundsFromMembers", () => {
	it("computes bounding box around member tasks (with padding)", () => {
		const doc = build(
			[group("box")],
			[leaf("A", "box", { x: 0, y: 0 }), leaf("B", "box", { x: 400, y: 200 })],
		);
		const b = groupBoundsFromMembers(doc, "box");
		expect(b).not.toBeNull();
		// minX = 0 - padX (36), minY = 0 - padTop (44).
		expect(b?.x).toBe(-36);
		expect(b?.y).toBe(-44);
		// width >= max(maxX - minX + 2*padX, MIN_WIDTH=440)
		// = max(400 + 200 + 72, 440) = 672.
		expect(b?.width).toBe(672);
	});

	it("returns minimum size when there are no positioned members", () => {
		const doc = build([group("box")], []);
		const b = groupBoundsFromMembers(doc, "box");
		expect(b).toEqual({ x: 0, y: 0, width: 440, height: 280 });
	});

	it("returns null for a missing group id", () => {
		const doc = build([], [leaf("A")]);
		expect(groupBoundsFromMembers(doc, "nope")).toBeNull();
	});

	it("includes tasks of descendant groups in the bounds", () => {
		const doc = build(
			[group("outer"), group("inner", "outer")],
			[leaf("A", "inner", { x: 100, y: 100 })],
		);
		// outer has no direct members, but inner (a descendant) does.
		const b = groupBoundsFromMembers(doc, "outer");
		expect(b?.x).toBe(100 - 36);
		expect(b?.y).toBe(100 - 44);
	});
});

describe("buildGroupSnapshot + findGroupAtPointInSnapshot", () => {
	it("finds the deepest group whose bounds include the point", () => {
		const doc = build(
			[group("outer"), group("inner", "outer")],
			[
				leaf("A", "inner", { x: 100, y: 100 }),
				leaf("B", "inner", { x: 300, y: 200 }),
			],
		);
		const snap = buildGroupSnapshot(doc, new Set());
		expect(findGroupAtPointInSnapshot(snap, { x: 200, y: 150 })).toBe("inner");
		expect(findGroupAtPointInSnapshot(snap, { x: -1000, y: -1000 })).toBe(null);
	});

	it("honors the collapsed set (skips collapsed groups)", () => {
		const doc = build(
			[group("outer"), group("inner", "outer")],
			[
				leaf("A", "inner", { x: 100, y: 100 }),
				leaf("B", "inner", { x: 300, y: 200 }),
			],
		);
		const snap = buildGroupSnapshot(doc, new Set(["inner"]));
		expect(findGroupAtPointInSnapshot(snap, { x: 200, y: 150 })).toBe("outer");
	});

	it("honors excludeIds (drag-out: leaf removed from its group's bounds)", () => {
		// A single leaf inside its group: with the leaf excluded the group falls
		// back to MIN size around its own position (default 0,0). A far point
		// should miss the shrunk fallback box.
		const doc = build([group("box")], [leaf("A", "box", { x: 100, y: 100 })]);
		const snap = buildGroupSnapshot(doc, new Set(), new Set(["A"]));
		expect(findGroupAtPointInSnapshot(snap, { x: 1000, y: 1000 })).toBe(null);
	});

	it("sorts deepest-first so the linear scan returns the deepest hit", () => {
		const doc = build(
			[group("outer"), group("inner", "outer")],
			[
				leaf("A", "inner", { x: 100, y: 100 }),
				leaf("B", "inner", { x: 300, y: 200 }),
			],
		);
		const snap = buildGroupSnapshot(doc, new Set());
		expect(snap[0]?.id).toBe("inner");
		expect(snap[1]?.id).toBe("outer");
	});
});

describe("shiftGroupMembersMutation", () => {
	it("shifts every member task (including descendant groups) by (dx, dy)", () => {
		const doc = build(
			[group("box"), group("inner", "box")],
			[
				leaf("A", "inner", { x: 100, y: 100 }),
				leaf("B", "box", { x: 200, y: 50 }),
			],
		);
		shiftGroupMembersMutation("box", 30, -10)(doc);
		expect(doc.tasksById.A.layout?.position).toEqual({ x: 130, y: 90 });
		expect(doc.tasksById.B.layout?.position).toEqual({ x: 230, y: 40 });
	});

	it("leaves groups (which have no member position) untouched", () => {
		const doc = build(
			[group("box"), group("inner", "box")],
			[leaf("A", "inner", { x: 0, y: 0 })],
		);
		shiftGroupMembersMutation("box", 10, 10)(doc);
		expect(doc.groupsById.inner.layout).toBeUndefined();
		expect(doc.tasksById.A.layout?.position).toEqual({ x: 10, y: 10 });
	});
});
